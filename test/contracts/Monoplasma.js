const MonoplasmaState = require("../../src/state")
const RootChainContract = require('../../build/Monoplasma.json');
const ERC20Mintable = require('../../build/ERC20Mintable.json');
const etherlime = require('etherlime');
const ethers = require('ethers');

describe('Monoplasma', async () => {
    let token
    let rootchain
    const producer = accounts[1]
    const anotherProducer = accounts[2]
    const admin = accounts[9]
    const blockFreezePeriodSeconds = 1000
    const plasma = new MonoplasmaState(0, [], { saveBlock: () => { } })

    before(async () => {
        deployer = new etherlime.EtherlimeGanacheDeployer(admin.secretKey);
        token = await deployer.deploy(ERC20Mintable);
        rootchain = await deployer.deploy(RootChainContract, false, token.contract.address, blockFreezePeriodSeconds);
        await token.from(admin).mint(rootchain.contract.address, 1000000);

        // these would be performed by the MonoplasmaWatcher
        plasma.addMember(producer.signer.address)
        plasma.addMember(anotherProducer.signer.address)
        plasma.addRevenue(1000)
    });

    async function publishBlock(rootHash) {
        const root = rootHash || plasma.getRootHash()
        const blockNumber = await deployer.provider.getBlockNumber();
        const resp = await rootchain.from(admin).commit(blockNumber, root, "ipfs lol")
        const iface = new ethers.utils.Interface(RootChainContract.abi);
        const event = iface.parseTransaction(resp);
        return event.args;
    }

    describe("commit & blockHash", () => {
        it("correctly saves and retrieves a block timestamp", async () => {
            const blockNumber = 123;
            const root = "0x1234000000000000000000000000000000000000000000000000000000000000"
            const resp = await rootchain.from(admin).commit(blockNumber, root, "ipfs lol")
            const iface = new ethers.utils.Interface(RootChainContract.abi);
            const event = iface.parseTransaction(resp);
            const timestamp = (await deployer.provider.getBlock(event.hash)).timestamp;
            const blockTimestamp = await rootchain.blockTimestamp(blockNumber);
            const blockNumberBN = ethers.utils.bigNumberify(blockNumber);

            assert(event.args[0].eq(blockNumberBN));
            assert.strictEqual(event.args[1], root);
            assert.strictEqual(await rootchain.blockHash(blockNumber), root);
            assert(blockTimestamp.eq(timestamp));
        })
    });

    describe("Admin", () => {
        it("can publish blocks", async () => {
            const block = await publishBlock()
            assert.strictEqual(await rootchain.blockHash(block[0]), block[1])
        })
    });

    describe("Member", () => {
        it("can withdraw earnings", async () => {
            const zeroTokenBalance = ethers.utils.bigNumberify(0);
            plasma.addRevenue(1000)
            const block = await publishBlock()
            // await increaseTime(blockFreezePeriodSeconds + 1)
            utils.timeTravel(deployer.provider, blockFreezePeriodSeconds + 1);
            const proof = plasma.getProof(producer.signer.address)
            const { earnings } = plasma.getMember(producer.signer.address);
            const tokenBalance = await token.balanceOf(producer.signer.address);

            assert(tokenBalance.eq(zeroTokenBalance));
            await rootchain.from(producer).withdrawAll(block[0], earnings, proof)

            const tokenBalanceAfterWithdraw = await token.balanceOf(producer.signer.address);
            assert(tokenBalanceAfterWithdraw.eq(earnings))
        })
        it("can not withdraw earnings before freeze period is over", async () => {
            plasma.addRevenue(1000);
            const block = await publishBlock();
            const proof = plasma.getProof(producer.signer.address);
            await assert.revert(rootchain.from(producer).withdrawAll(block[0], 500, proof))
        });
        it("can not withdraw wrong amount", async () => {
            plasma.addRevenue(1000)
            const block = await publishBlock()
            // await increaseTime(blockFreezePeriodSeconds + 1)
            utils.timeTravel(deployer.provider, blockFreezePeriodSeconds + 1);
            const proof = plasma.getProof(producer.signer.address)
            await assert.revert(rootchain.withdrawAll(block[0], 50000, proof))
        })
        it("can not withdraw with bad proof", async () => {
            plasma.addRevenue(1000)
            const block = await publishBlock()
            // await increaseTime(blockFreezePeriodSeconds + 1)
            utils.timeTravel(deployer.provider, blockFreezePeriodSeconds + 1);
            await assert.revert(rootchain.from(producer).withdrawAll(block[0], 500, [
                "0x3e6ef21b9ffee12d86b9ac8713adaba889b551c5b1fbd3daf6c37f62d7f162bc",
                "0x3f2ed4f13f5c1f5274cf624eb1d079a15c3666c97c5403e6e8cf9cea146a8608",
            ]));
        });
    });

});