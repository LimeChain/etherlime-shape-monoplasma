// @flow

/* eslint-disable react/no-unused-state */
/* eslint-disable new-cap */
/* eslint-disable no-console */
/* eslint-disable newline-per-chained-call */

import React, { Component, type Node, Fragment } from 'react'

import HomeComponent from '../../components/Home'
import Context, { type Props as ContextProps } from '../../contexts/Home'
import WalletContext, { type Props as WalletContextProps } from '../../contexts/Wallet'
import { type Block } from '../../components/Home/Blocks'

import tokenAbi from '../../utils/tokenAbi'
import monoplasmaAbi from '../../utils/monoplasmaAbi'
import { ethers as ethers } from 'ethers';

// TODO: move to where network is checked. This actually should depend on chosen network.
const etherscanUrl = 'http://rinkeby.infura.io'

const MINT_TOKEN_AMOUNT = ethers.utils.parseEther('1000000');

type Props = WalletContextProps & {}

type State = ContextProps & {
    serverConnectionError: boolean,
    latestBlockNumber: number,
    community: any,
    member: any,
}

const toFixed18 = (num: number) => ethers.utils.bigNumberify(10).pow(ethers.utils.bigNumberify(18)).mul(ethers.utils.bigNumberify(num));

// TODO: disable alert for demo  (;
const handleError = (error) => {
    console.error(error)
    window.alert(error.message) // eslint-disable-line no-alert
}

function sleep(ms: number) {
    return new Promise((done) => {
        setTimeout(done, ms)
    })
}

class Home extends Component<Props, State> {
    unmounted: boolean = false

    state = {
        account: [
            ['Total earnings', ethers.utils.bigNumberify(0)],
            ['Earnings frozen', ethers.utils.bigNumberify(0)],
            ['Total withdrawn', ethers.utils.bigNumberify(0)],
            ['Total earnings recorded', ethers.utils.bigNumberify(0)],
            ['Earnings available', ethers.utils.bigNumberify(0)],
        ],
        revenuePool: [
            ['Members', ethers.utils.bigNumberify(0)],
            ['Total earnings', ethers.utils.bigNumberify(0)],
            ['Earnings frozen', ethers.utils.bigNumberify(0)],
            ['Contract balance', ethers.utils.bigNumberify(0)],
            ['Total earnings recorded', ethers.utils.bigNumberify(0)],
            ['Earnings available', ethers.utils.bigNumberify(0)],
            null,
            ['Total withdrawn', ethers.utils.bigNumberify(0)],
        ],
        serverConnectionError: false,
        blocks: [1, 2, 3, 4, 5],
        member: null,
        config: null,
        latestBlockNumber: 0,
        onViewClick: this.onViewClick.bind(this),
        onKickClick: this.onKickClick.bind(this),
        onWithdrawClick: this.onWithdrawClick.bind(this),
        onAddRevenueClick: this.onAddRevenueClick.bind(this),
        onAddUsersClick: this.onAddUsersClick.bind(this),
        onMintClick: this.onMintClick.bind(this),
        onStealClick: this.onStealClick.bind(this),
        onForcePublishClick: this.onForcePublishClick.bind(this),
        community: null,
    }

    componentDidMount() {
        // TODO: retry on error (server not up yet?)
        fetch('/data/state.json')
            .then((resp) => resp.json())
            .then((config) => {
                this.setState({
                    config,
                })
            }, () => {
                console.log(':boom:')
            })

        fetch('http://localhost:8080/api/blocks?n=5')
            .then((resp) => resp.json())
            .then((blockList) => {
                let latestBlockNumber = 0
                blockList.forEach((block) => {
                    this.addBlockToList(block)
                    latestBlockNumber = block.blockNumber > latestBlockNumber ? block.blockNumber : latestBlockNumber
                })
                this.setState({
                    latestBlockNumber,
                })
            })

        const self = this
        function pollBlocks() {
            if (self.unmounted) { return }

            self.updateCommunity().then(async () => {
                const { member } = self.state
                if (member) {
                    return await self.updateUser(member.address)
                }
                return null
            }).then(() => {
                self.setState({
                    serverConnectionError: false,
                })
                setTimeout(pollBlocks, 1000)
            }).catch((error) => {
                console.error(error)
                self.setState({
                    serverConnectionError: true,
                })
                setTimeout(pollBlocks, 5000)
            })
        }
        setTimeout(pollBlocks, 1000)
    }

    componentWillUnmount() {
        this.unmounted = true
    }

    async onViewClick(address: string) {
        console.log('View ', address, this)
        await this.updateUser(address).catch(handleError)
    }

    onKickClick(address: string) {
        console.log('Kick', address, this)
        fetch(`http://localhost:8080/admin/members/${address}`, {
            method: 'DELETE',
        }).then((res) => {
            console.log(`Kick response status code: ${JSON.stringify(res.status)}`)
            return this.updateCommunity()
        }).catch(handleError)
    }

    async onWithdrawClick(address: string) {
        console.log('Withdraw', address, this)
        const { config } = this.state
        const { accountAddress, ethersWeb3Provider } = this.props
        if (!config) {
            console.warn('Missing config. Has not loaded yet?')
            return
        }

        const signer = ethersWeb3Provider.getSigner(accountAddress);
        const monoplasma = new ethers.Contract(config.contractAddress, monoplasmaAbi, signer);

        try {
            const result = await this.updateUser(address);
            const { withdrawableBlockNumber, withdrawableEarnings, proof } = result;
            if (!withdrawableBlockNumber) {
                throw new Error('No blocks to withdraw from!')
            }
            const tx = await monoplasma.withdrawAllFor(address, withdrawableBlockNumber, withdrawableEarnings, proof);
            console.log(`withdrawAll transaction successful: ${JSON.stringify(tx)}`)
            await this.updateUser(address)
            this.updateCommunity()
        } catch (e) {
            handleError(e);
        }
    }

    async onAddRevenueClick(amount: number) {
        console.log('Add revenue', amount, this)
        const { config, member } = this.state
        const { accountAddress, ethersWeb3Provider } = this.props
        const amountToWei = ethers.utils.parseEther(amount.toString());

        if (!config) {
            console.warn('Missing config. Has not loaded yet?')
            return
        }

        const signer = ethersWeb3Provider.getSigner(accountAddress);
        const token = new ethers.Contract(config.tokenAddress, tokenAbi, signer);
        try {
            const tx = await token.transfer(config.contractAddress, amountToWei);
            console.log(`add revenue / transfer transaction successful: ${JSON.stringify(tx)}`)
            if (member) {
                await this.updateUser(member.address)
            }
            this.updateCommunity()
        } catch (e) {
            this.handleError(e);
        }
    }

    onForcePublishClick() {
        console.log('Force publish', this)
        fetch('http://localhost:8080/demo/publishBlock').then((resp) => resp.json()).then((receipt) => {
            console.log(`Block publish successful: ${JSON.stringify(receipt)}`)
        }).catch(handleError)
    }

    onAddUsersClick(addresses: Array<string>) {
        console.log('Add users', addresses, this)
        const userList = addresses.filter(ethers.utils.getAddress);
        fetch('http://localhost:8080/admin/members', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userList),
        }).then((resp) => resp.json()).then((res) => {
            console.log(`Add users response: ${JSON.stringify(res)}`)
            return this.updateCommunity()
        }).catch(handleError)
    }

    async onMintClick() {
        console.log('Mint tokens', this)
        const { config } = this.state
        const { accountAddress, ethersWeb3Provider } = this.props

        if (!config) {
            console.warn('Missing config. Has not loaded yet?')
            return
        }

        const signer = ethersWeb3Provider.getSigner(accountAddress);
        const token = new ethers.Contract(config.tokenAddress, tokenAbi, signer);

        try {
            const tx = await token.mint(accountAddress, MINT_TOKEN_AMOUNT);
            console.log(`mint transaction pending: ${etherscanUrl}/tx/${tx.txHash}`)
            console.log(`mint transaction successful: ${JSON.stringify(tx)}`)
        } catch (e) {
            handleError(e)
        }
    }

    async onStealClick() {
        const { accountAddress, ethersWeb3Provider } = this.props
        const { config } = this.state
        console.log('Steal tokens')

        if (!config) {
            console.warn('Missing config. Has not loaded yet?')
            return
        }

        if (!accountAddress) {
            console.warn('Missing account address.')
            return
        }

        // const monoplasma = new eth.contract(monoplasmaAbi).at(config.contractAddress)
        const signer = ethersWeb3Provider.getSigner(accountAddress);
        const monoplasma = new ethers.Contract(config.contractAddress, monoplasmaAbi, signer);


        let stealInstructions
        try {
            const request = await fetch(`http://localhost:8080/demo/stealAllTokens?targetAddress=${accountAddress}`);
            stealInstructions = await request.json();
            console.log(`Steal request successful: ${JSON.stringify(stealInstructions)}. Waiting for block to unfreeze...`);
            await sleep(Number.parseInt(config.blockFreezeSeconds || '0', 10) * 1000);
            const { blockNumber, tokens, proof } = stealInstructions;
            const result = await monoplasma.withdrawAll(blockNumber, tokens, proof);
            window.alert('Successfully stole all tokens, check your balances  :)')
        } catch (e) {
            handleError(e)
        }
    }

    addBlockToList = (block: ?Block) => {
        const { blocks } = this.state

        if (this.unmounted || !block || !block.blockNumber) { return }

        if (blocks.find((b) => typeof b !== 'number' && block && b.blockNumber === block.blockNumber)) {
            console.log(`Trying to re-add block #${block.blockNumber}`)
            return
        }
        console.log(`Adding ${JSON.stringify(block)} to list`)

        // add new block to front, take 5 newest
        const newBlocks = [block, ...blocks].slice(0, 5)
        this.setState({
            blocks: newBlocks,
        })
    }

    async updateUser(address: string) {
        if (!ethers.utils.getAddress(address)) {
            throw new Error(`Bad address: ${address}`)
        }
        const { ethersWeb3Provider, accountAddress } = this.props
        const { config } = this.state

        if (!config) {
            throw new Error('Config hasn\'t been loaded from server, try refreshing the page')
        }

        // TODO: move contract instances into the state
        const signer = ethersWeb3Provider.getSigner(accountAddress);
        const monoplasma = new ethers.Contract(config.contractAddress, monoplasmaAbi, signer);

        let withdrawnBN
        withdrawnBN = await monoplasma.withdrawn(address);
        const request = await fetch(`http://localhost:8080/api/members/${address}`);
        const response = await request.json();
        const recordedBN = ethers.utils.bigNumberify(response.withdrawableEarnings || 0)
        const withdrawableBN = recordedBN.sub(withdrawnBN)
        this.setState({
            response,
            account: [
                ['Total earnings', ethers.utils.bigNumberify(response.earnings || 0)],
                ['Earnings frozen', ethers.utils.bigNumberify(response.frozenEarnings || 0)],
                ['Total withdrawn', withdrawnBN],
                ['Total earnings recorded', recordedBN],
                ['Earnings available', withdrawableBN],
            ],
        })
        return response
    }

    async updateCommunity() {
        const { config, latestBlockNumber } = this.state
        const { accountAddress, ethersWeb3Provider } = this.props;

        if (!config) {
            throw new Error('Config hasn\'t been loaded from server, try refreshing the page')
        }
        if (!accountAddress) {
            return;
        }

        const signer = ethersWeb3Provider.getSigner(accountAddress);
        const monoplasma = new ethers.Contract(config.contractAddress, monoplasmaAbi, signer);
        const token = new ethers.Contract(config.tokenAddress, tokenAbi, signer);


        // TODO: move contract instances into the state
        // const monoplasma = new eth.contract(monoplasmaAbi).at(config.contractAddress)
        // const token = new eth.contract(tokenAbi).at(config.tokenAddress)

        let contractBalance
        let totalWithdrawn

        contractBalance = await token.balanceOf(config.contractAddress);
        totalWithdrawn = await monoplasma.totalWithdrawn();
        const request = await fetch('http://localhost:8080/api/status');
        const response = await request.json();
        if (!response.latestBlock) {
            console.error(`Community status: ${JSON.stringify(response)}`)
            return response
        }

        const recorded = ethers.utils.bigNumberify(response.latestBlock.totalEarnings || 0)
        const totalEarningsInLatestWithdrawable = ethers.utils.bigNumberify(response.latestWithdrawableBlock.totalEarnings || 0)
        const earningsAvailable = totalEarningsInLatestWithdrawable.sub(ethers.utils.bigNumberify(totalWithdrawn))
        this.setState({
            response,
            revenuePool: [
                ['Members', toFixed18(response.memberCount.active)],
                ['Total earnings', ethers.utils.bigNumberify(response.totalEarnings)],
                ['Earnings frozen', ethers.utils.bigNumberify(recorded.sub(totalEarningsInLatestWithdrawable))],
                ['Contract balance', ethers.utils.bigNumberify(contractBalance)],
                ['Total earnings recorded', ethers.utils.bigNumberify(recorded)],
                ['Earnings available', earningsAvailable],
                null,
                ['Total withdrawn', ethers.utils.bigNumberify(totalWithdrawn)],
            ],
        })
        const bnum = response.latestBlock.blockNumber
        if (bnum && bnum !== latestBlockNumber) {
            this.setState({
                latestBlockNumber: bnum,
            })
            this.addBlockToList(response.latestBlock)
        }
        return response
    }

    notification(): Node {
        const { ethersWeb3Provider, accountAddress } = this.props
        const { serverConnectionError } = this.state

        if (!ethersWeb3Provider) {
            return (
                <Fragment>
                    <span>No wallet detected. please install </span>
                    <a href="https://metamask.io/" target="_blank" rel="noopener noreferrer">MetaMask</a>
                </Fragment>
            )
        }

        if (!accountAddress) {
            return 'Please unlock your wallet to continue'
        }

        if (serverConnectionError) {
            return 'Error connecting to server...'
        }

        return null
    }

    render() {
        return (
            <Context.Provider value={this.state}>
                <HomeComponent
                    notification={this.notification()}
                />
            </Context.Provider>
        )
    }
}

export default (props: {}) => (
    <WalletContext.Consumer>
        {(context) => (
            <Home {...context} {...props} />
        )}
    </WalletContext.Consumer>
)
