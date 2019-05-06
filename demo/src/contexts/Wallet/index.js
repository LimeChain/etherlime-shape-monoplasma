// @flow

import { createContext } from 'react'

export type Props = {
    accountAddress: ?string,
    ethersWeb3Provider: any
}

export default createContext<Props>({
    accountAddress: null,
    ethersWeb3Provider: null
})
