const MonoplasmaMember = require("./member")
const MerkleTree = require("./merkletree")
const BN = require("bn.js")
const now = require("./utils/now")
const { isAddress } = require('./utils/checkArguments');

/**
 * Monoplasma state object
 *
 * Contains the logic of revenue distribution as well as current balances of/and participants
 */
module.exports = class MonoplasmaState {
    /**
     * @param {number} blockFreezeSeconds
     * @param {Array} initialMembers objects: [ { address, earnings }, { address, earnings }, ... ]
     * @param {Object} store offering persistance for blocks
     * @param {string} defaultReceiverAddress where revenues go if there are no members
     */
    constructor(blockFreezeSeconds, initialMembers, store, defaultReceiverAddress) {
        if (!Array.isArray(initialMembers)) {
            initialMembers = []
        }
        /** @property {fileStore} store persistence for published blocks */
        this.store = store
        /** @property {number} blockFreezeSeconds after which blocks become withdrawable */
        this.blockFreezeSeconds = blockFreezeSeconds
        /** @property {number} totalEarnings by all members together; should equal balanceOf(contract) + contract.totalWithdrawn */
        this.totalEarnings = initialMembers.reduce((sum, m) => sum.iadd(new BN(m.earnings)), new BN(0))

        /** @property {Array<Block>} latestBlocks that have been stored. Kept to figure out  */
        this.latestBlocks = []

        /** @property {Array<MonoplasmaMember>} members */
        this.members = initialMembers.map(m => new MonoplasmaMember(undefined, m.address, m.earnings))
        /** @property {MerkleTree} tree The MerkleTree for calculating the hashes */
        this.tree = new MerkleTree(this.members)

        this.indexOf = {}
        this.members.forEach((m, i) => { this.indexOf[m.address] = i })

        // add default address in case revenue is received with no members
        const defaultAddress = isAddress(defaultReceiverAddress) ? defaultReceiverAddress : "0x0000000000000000000000000000000000000000"
        const wasNew = this.addMember(defaultAddress, "default")
        const i = this.indexOf[defaultAddress]
        this.defaultMember = this.members[i]

        // don't enable defaultMember to participate into profit-sharing (unless it was also in initialMembers)
        if (wasNew) {
            this.defaultMember.setActive(false)
        }
    }

    // ///////////////////////////////////
    //      MEMBER API
    // ///////////////////////////////////

    getMembers() {
        return this.members
            .filter(m => m.isActive())
            .map(m => m.toObject())
    }

    getMemberCount() {
        // "default member" shouldn't show up in member count unless separately added
        const total = this.members.length - (this.defaultMember.isActive() ? 0 : 1)
        const active = this.members.filter(m => m.isActive()).length
        return {
            total,
            active,
            inactive: total - active,
        }
    }

    getTotalRevenue() {
        return this.totalEarnings.toString(10)
    }

    getLatestBlock() {
        if (this.latestBlocks.length < 1) { return null }
        const block = this.latestBlocks[0]
        return block
    }

    getLatestWithdrawableBlock() {
        if (this.latestBlocks.length < 1) { return null }
        const nowTimestamp = now()
        const i = this.latestBlocks.findIndex(b => nowTimestamp - b.timestamp > this.blockFreezeSeconds, this)
        if (i === -1) { return null }         // all blocks still frozen
        this.latestBlocks.length = i + 1    // throw away older than latest withdrawable
        const block = this.latestBlocks[i]
        return block
    }

    /**
     * Retrieve snapshot written in {this.storeBlock}
     * @param {number} blockNumber
     */
    async getBlock(blockNumber) {
        const cachedBlock = this.latestBlocks.find(b => b.blockNumber === blockNumber)
        if (cachedBlock) {
            return cachedBlock
        }
        if (!await this.store.blockExists(blockNumber)) { throw new Error(`Block #${blockNumber} not found in published blocks`) }
        const block = await this.store.loadBlock(blockNumber)
        return block
    }

    async listBlockNumbers(maxNumberLatest) {
        return this.store.listBlockNumbers(maxNumberLatest)
    }

    /**
     * Get member's current status (without valid withdrawal proof because it hasn't been recorded)
     * @param {string} address
     */
    getMember(address) {
        const i = this.indexOf[address]
        if (i === undefined) { return null }
        const m = this.members[i]
        if (!m) { throw new Error(`Bad index ${i}`) }   // TODO: change to return null in production
        const obj = m.toObject()
        obj.active = m.isActive()
        obj.proof = this.getProof(address)
        return obj
    }

    /**
     * Get member's info with withdrawal proof at given block
     * @param {string} address
     * @param {number} blockNumber at which (published) block
     */
    async getMemberAt(address, blockNumber) {
        const block = await this.getBlock(blockNumber)
        const member = block.members.find(m => m.address === address)   // TODO: DANGER: O(n^2) potential here! If members were sorted (or indexOF retained), this would be faster
        const members = block.members.map(m => MonoplasmaMember.fromObject(m))
        const tree = new MerkleTree(members)
        member.proof = tree.getPath(address)
        return member
    }

    /**
     * Get hypothetical proof of earnings from current status
     * @param {string} address with earnings to be verified
     * @returns {Array} of bytes32 hashes ["0x123...", "0xabc..."]
     */
    getProof(address) {
        const path = this.tree.getPath(address)
        return path
    }

    /**
     * Get proof of earnings for withdrawal ("payslip") from specific (published) block
     * @param {string} address with earnings to be verified
     * @param {number} blockNumber at which (published) block
     * @returns {Array} of bytes32 hashes ["0x123...", "0xabc..."]
     */
    async getProofAt(address, blockNumber) {
        const block = await this.getBlock(blockNumber)
        const members = block.members.map(m => MonoplasmaMember.fromObject(m))
        const tree = new MerkleTree(members)
        const path = tree.getPath(address)
        return path
    }

    getRootHash() {
        return this.tree.getRootHash()
    }

    async getRootHashAt(blockNumber) {
        if (!this.store.blockExists(blockNumber)) { throw new Error(`Block #${blockNumber} not found in published blocks`) }
        const block = await this.store.loadBlock(blockNumber)
        const members = block.map(m => MonoplasmaMember.fromObject(m))
        const tree = new MerkleTree(members)
        const rootHash = tree.getRootHash()
        return rootHash
    }

    // ///////////////////////////////////
    //      ADMIN API
    // ///////////////////////////////////

    /**
     * @param {number} amount of tokens that was added to the Community revenues
     */
    addRevenue(amount) {
        const activeMembers = this.members.filter(m => m.isActive())
        const activeCount = activeMembers.length
        if (activeCount === 0) {
            console.warn(`No active members in community! Allocating ${amount} to default account ${this.defaultMember.address}`)
            amount = amount.toString();
            this.defaultMember.addRevenue(amount)
        } else {
            amount = amount.toString();
            const amountBN = new BN(amount)
            const share = amountBN.divn(activeCount)
            activeMembers.forEach(m => m.addRevenue(share))
            this.totalEarnings.iadd(amountBN)
        }
        this.tree.update(this.members)
    }

    /**
     * Add an active recipient into Community, or re-activate existing one (previously removed)
     * @param {string} address of the new member
     * @param {string} name of the new member
     * @returns {boolean} if the added member was new (previously unseen)
     */
    addMember(address, name) {
        const i = this.indexOf[address]
        const isNewAddress = i === undefined
        if (isNewAddress) {
            const m = new MonoplasmaMember(name, address)
            const newI = this.members.push(m) - 1
            this.indexOf[address] = newI
        } else {
            const m = this.members[i]
            if (!m) { throw new Error(`Bad index ${i}`) }   // TODO: remove in production; this means updating indexOf has been botched
            m.setActive(true)
        }
        // tree.update(members)     // no need for update since no revenue allocated
        return isNewAddress
    }

    /**
     * De-activate a member, it will not receive revenues until re-activated
     * @param {string} address
     * @returns {boolean} if the de-activated member was previously active (and existing)
     */
    removeMember(address) {
        let wasActive = false
        const i = this.indexOf[address]
        if (i !== undefined) {
            const m = this.members[i]
            if (!m) { throw new Error(`Bad index ${i}`) }   // TODO: remove in production; this means updating indexOf has been botched
            wasActive = m.isActive()
            m.setActive(false)
        }
        // tree.update(members)     // no need for update since no revenue allocated
        return wasActive
    }

    /**
     * Monoplasma member to be added
     * @typedef {Object<string, string>} IncomingMember
     * @property {string} address Ethereum address of the Community member
     * @property {string} name Human-readable string representation
     */
    /**
     * Add active recipients into Community, or re-activate existing ones (previously removed)
     * @param {Array<IncomingMember|string>} members
     * @returns {Array<IncomingMember|string>} members that were actually added
     */
    addMembers(members) {
        const added = []
        members.forEach(member => {
            const m = typeof member === "string" ? { address: member } : member
            const wasNew = this.addMember(m.address, m.name)
            if (wasNew) { added.push(member) }
        })
        return added
    }

    /**
     * De-activate members: they will not receive revenues until re-activated
     * @param {Array<string>} addresses
     * @returns {Array<string>} addresses of members that were actually removed
     */
    removeMembers(addresses) {
        const removed = []
        addresses.forEach(address => {
            const wasActive = this.removeMember(address)
            if (wasActive) { removed.push(address) }
        })
        return removed
    }

    /**
     * Snapshot the Monoplasma state for later use (getMemberAt, getProofAt)
     * @param {number} blockNumber root-chain block number after which this block state is valid
     */
    async storeBlock(blockNumber) {
        const members = this.members.map(m => m.toObject())
        const timestamp = now()
        const totalEarnings = this.getTotalRevenue()
        const latestBlock = {
            blockNumber,
            members,
            timestamp,
            totalEarnings,
        }
        this.latestBlocks.unshift(latestBlock)  // = insert to beginning
        await this.store.saveBlock(latestBlock)
        return latestBlock
    }

    /**
     * Return a read-only "member API" that can only query this object
     */
    getMemberApi() {
        return {
            getMembers: this.getMembers.bind(this),
            getMember: this.getMember.bind(this),
            getMemberCount: this.getMemberCount.bind(this),
            getTotalRevenue: this.getTotalRevenue.bind(this),
            getProof: this.getProof.bind(this),
            getProofAt: this.getProofAt.bind(this),
            getRootHash: this.getRootHash.bind(this),
            getBlock: this.getBlock.bind(this),
            getLatestBlock: this.getLatestBlock.bind(this),
            getLatestWithdrawableBlock: this.getLatestWithdrawableBlock.bind(this),
            listBlockNumbers: this.listBlockNumbers.bind(this),
        }
    }
}
