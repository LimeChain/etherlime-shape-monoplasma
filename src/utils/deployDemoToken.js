const TokenJson = require("../../build/DemoToken.json");
const etherlime = require('etherlime');

module.exports = async function deployDemoToken(provider,tokenName, tokenSymbol, sendOptions, privateKey, log) {
    log("Deploying a dummy token contract...")
    // const deployer = new etherlime.EtherlimeGanacheDeployer();
    // deployer.setPrivateKey(privateKey)
    provider.setDefaultOverrides(sendOptions)
    const result = await provider.deploy(TokenJson, {}, tokenName || "Demo token", tokenSymbol || "\ud83e\udd84");
    return result.contractAddress;
}
