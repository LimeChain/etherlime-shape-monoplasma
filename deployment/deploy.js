const etherlime = require('etherlime-lib');
const LimeFactory = require('../build/LimeFactory.json');


const deploy = async (network, secret) => {

	const deployer = new etherlime.EtherlimeGanacheDeployer();
	const result = await deployer.deploy(LimeFactory);

};

module.exports = {
	deploy
};