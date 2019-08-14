const TokenJson = require("../../build/DemoToken.json");

module.exports = async function deployDemoToken(deployer, tokenName, tokenSymbol, sendOptions, privateKey, log) {
    log("Deploying a dummy token contract...")
    // const deployer = new etherlime.EtherlimeGanacheDeployer();
    // deployer.setPrivateKey(privateKey)
    deployer.setDefaultOverrides(sendOptions)
    const result = await deployer.deploy(TokenJson, {}, tokenName || "Demo token", tokenSymbol || "\ud83e\udd84");
    log(`Deployed at : ${result.contractAddress}`);
    return result.contractAddress;
}
