// @flow

/* eslint-disable react/no-unused-state */

import React, { type Node, Component } from 'react'
import Context, { type Props as ContextProps } from '../../contexts/Wallet'
import { ethers as ethers } from 'ethers';

const { ethereum, web3 } = typeof window !== 'undefined' ? window : {}
const provider = ethereum || (web3 && web3.currentProvider)

type etProps = {
    children: Node,
}

type State = ContextProps & {}

class Wallet extends Component<Props, State> {
    constructor(props: Props) {
        super(props)

        if (provider) {

            this.ethersWeb3Provider = new ethers.providers.Web3Provider(provider);
        }

        this.state = {
            accountAddress: null,
            ethersWeb3Provider: this.ethersWeb3Provider
        }
    }

    async componentDidMount() {
        this.getAccountAddress().then((accountAddress) => {
            if (!this.unmounted) {
                this.setState({
                    accountAddress,
                })
            }
        })

        if (ethereum) {
            ethereum.on('accountsChanged', this.onAccountChange)
        }
    }

    componentWillUnmount() {
        this.unmounted = true
        if (ethereum) {
            ethereum.off('accountsChanged', this.onAccountChange)
        }
    }

    onAccountChange = (accounts: Array<string>) => {
        if (!this.unmounted) {
            this.setState({
                accountAddress: accounts[0] || null,
            })
        }
    }

    async getAccountAddress(): Promise<?string> {
        if (ethereum) {
            try {
                await ethereum.enable()
                console.log('ethereum.selectedAddress', ethereum.selectedAddress)
                return ethereum.selectedAddress
            } catch (e) {
                /* catcher */
            }
        } else if (web3) {
            try {
                const accounts = await this.eth.accounts()
                console.log('web3', accounts[0]);
                return accounts[0] || null
            } catch (e) {
                /* catcher */
            }
        }

        return null
    }


    ethersWeb3Provider: any

    unmounted: boolean

    render() {
        const { children } = this.props

        return (
            <Context.Provider value={this.state}>
                {children}
            </Context.Provider>
        )
    }
}

export default Wallet
