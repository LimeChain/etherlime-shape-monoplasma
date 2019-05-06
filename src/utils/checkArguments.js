const ethers = require('ethers');

/** Validate contract addresses from user input */
async function throwIfSetButNotContract(provider, address, context) {
    if (!address) { return }
    return throwIfNotContract(provider, address, context)
}

/** Validate contract addresses from user input */
async function throwIfNotContract(provider, address, context) {
    if (!ethers.utils.getAddress(address)) {
        throw new Error(`${context || "Error"}: Bad Ethereum address ${address}`)
    }
    if (await provider.provider.getCode(address) === "0x") {
        throw new Error(`${context || "Error"}: No contract at ${address}`)
    }
}

function isAddress(address) {
    try {
        ethers.utils.getAddress(address);
    } catch (e) { return false; }
    return true;
}

module.exports = {
    throwIfNotContract,
    throwIfSetButNotContract,
    isAddress
}
