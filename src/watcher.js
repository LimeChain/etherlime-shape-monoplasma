const MonoplasmaState = require("./state")
const { replayEvent, mergeEventLists } = require("./utils/events")
const { throwIfSetButNotContract } = require("./utils/checkArguments")

const TokenJson = require("../build/ERC20Mintable.json")
const MonoplasmaJson = require("../build/Monoplasma.json")
const etherlime = require('etherlime');
const ethers = require('ethers');

/**
 * MonoplasmaWatcher hooks to the root chain contract and keeps a local copy of the Monoplasma state up to date
 * Can be inherited to implement Operator and Validator functionality
 */
module.exports = class MonoplasmaWatcher {

    constructor(provider, joinPartChannel, startState, store, logFunc, errorFunc) {
        this.provider = provider
        this.channel = joinPartChannel
        this.state = Object.assign({}, startState)
        this.store = store
        this.log = logFunc || (() => {})
        this.error = errorFunc || console.error
        this.explorerUrl = this.state.explorerUrl
        this.filters = {}
        this.eventLogIndex = +new Date()
    }

    async start() {
        await throwIfSetButNotContract(this.provider, this.state.contractAddress, "startState contractAddress")

        this.log("Initializing Monoplasma state...")
        // double-check state from contracts as a sanity check (TODO: alert if there were wrong in startState?)
        // this.contract = await etherlime.ContractAt(MonoplasmaJson, this.state.contractAddress)
        this.contract = await this.provider.wrapDeployedContract(MonoplasmaJson, this.state.contractAddress)

        this.state.tokenAddress = await this.contract.token();
      
        this.token = this.provider.wrapDeployedContract(TokenJson, this.state.tokenAddress)
        this.state.blockFreezeSeconds = (await this.contract.blockFreezeSeconds()).toString();

        const lastBlock = this.state.lastPublishedBlock && await this.store.loadBlock(this.state.lastPublishedBlock)
        const savedMembers = lastBlock ? lastBlock.members : []
        this.plasma = new MonoplasmaState(this.state.blockFreezeSeconds, savedMembers, this.store, this.state.operatorAddress)

        // TODO: playback from joinPartChannel not implemented =>
        //   playback will actually fail if there are joins or parts from the channel in the middle (during downtime)
        //   the failing will probably be quite quickly noticed though, so at least validators would simply restart
        //   if the operator fails though...
        const latestBlock = await this.provider.provider.getBlockNumber();
        const playbackStartingBlock = this.state.lastBlockNumber + 1 || 0
        if (playbackStartingBlock <= latestBlock) {
            this.log("Playing back events from Ethereum and Channel...")
            await this.playback(playbackStartingBlock, latestBlock)
            this.state.lastBlockNumber = latestBlock
        }

        this.log("Listening to Ethereum events...")
      
        this.tokenFilter = 'Transfer';

        this.log("Listening to joins/parts from the Channel...")
        this.channel.listen()
        this.channel.on("join", addressList => {
            const blockNumber = this.state.lastBlockNumber + 1
            const addedMembers = this.plasma.addMembers(addressList)
            this.log(`Added or activated ${addedMembers.length} new member(s) before block ${blockNumber}`)
            return this.store.saveEvents(blockNumber, {
                blockNumber,
                transactionIndex: -1,              // make sure join/part happens BEFORE real Ethereum tx
                logIndex: this.eventLogIndex++,    // ... but still is internally ordered
                event: "Join",
                addressList: addedMembers,
            }).catch(this.error)
        })
        this.channel.on("part", addressList => {
            const blockNumber = this.state.lastBlockNumber + 1
            const removedMembers = this.plasma.removeMembers(addressList)
            this.log(`De-activated ${removedMembers.length} member(s) before block ${blockNumber}`)
            return this.store.saveEvents(blockNumber, {
                blockNumber,
                transactionIndex: -1,              // make sure join/part happens BEFORE real Ethereum tx
                logIndex: this.eventLogIndex++,    // ... but still is internally ordered
                event: "Part",
                addressList: removedMembers,
            }).catch(this.error)
        })

        await this.store.saveState(this.state)
    }

    async stop() {
        this.tokenFilter.unsubscribe()
        this.channel.close()
    }

    async playback(fromBlock, toBlock) {
        await this.playbackOn(this.plasma, fromBlock, toBlock)
    }

    async playbackOn(plasma, fromBlock, toBlock) {
        // TODO: include joinPartHistory in playback
        // TODO interim solution: take members from a recent block
        this.log(`Playing back blocks ${fromBlock}...${toBlock}`)
        const joinPartEvents = await this.store.loadEvents(fromBlock, toBlock + 1)       // +1 to catch events after the very latest block, see join/part listening above

        const blockCreatedFilter = {
            address: this.state.contractAddress,
            fromBlock: fromBlock,
            toBlock: toBlock,
            topics: [this.contract.interface.events.BlockCreated.topic]
          };
        const blockCreateEvents = await this.provider.provider.getLogs(blockCreatedFilter);
        for (let blockEvent in blockCreateEvents) {
            blockCreateEvents[blockEvent].event = 'BlockCreated';
            const result = this.contract.interface.events.BlockCreated.decode(blockCreateEvents[blockEvent].data);
            blockCreateEvents[blockEvent].args = result;
        }

        
        let transferEvents = [];
        let rawTransferEvents = [];

        let abi = [ "event Transfer(address indexed from, address indexed to, uint256 value)" ];
        let iface = new ethers.utils.Interface(abi);

        let transferEventFilter = {
            address: this.state.tokenAddress,
            fromBlock: fromBlock,
            toBlock: toBlock
        };

        rawTransferEvents = await this.provider.provider.getLogs(transferEventFilter);
        for (let transferEvent in rawTransferEvents) {
            rawTransferEvents[transferEvent].args = iface.parseLog(rawTransferEvents[transferEvent]) ? iface.parseLog(rawTransferEvents[transferEvent]).values : null;
            rawTransferEvents[transferEvent].event = 'Transfer';
        }
       
        transferEvents = rawTransferEvents.filter(event => (event.args !== null) && (event.args.to === this.state.contractAddress))

        const ethereumEvents = mergeEventLists(blockCreateEvents, transferEvents)
        const allEvents = mergeEventLists(ethereumEvents, joinPartEvents)

        for (const event of allEvents) {
            await replayEvent(plasma, event)
        }
    }

    async getContractTokenBalance() {
        const balance = await this.token.contract.balanceOf(this.state.contractAddress);
        return balance
    }
}
