
// BalanceVerifier cannot be instantiated so "minimal viable implementation" Airdrop is used instead

const MonoplasmaMember = require("../../src/member")
const MonoplasmaState = require("../../src/state")
const MerkleTree = require("../../src/merkletree")

const ERC20Mintable = require('../../build/ERC20Mintable.json');
const Airdrop = require('../../build/Airdrop.json');

const etherlime = require('etherlime');
const ethers = require('ethers');

describe('BalanceVerifier', async () => {
    let token
    let airdrop
    const recipient = accounts[1]
    const anotherRecipient = accounts[2]
    const admin = accounts[9]
    const plasma = new MonoplasmaState(0, [], { saveBlock: () => { } })


    before(async () => {
        deployer = new etherlime.EtherlimeGanacheDeployer(admin.secretKey);
        token = await deployer.deploy(ERC20Mintable);
        airdrop = await deployer.deploy(Airdrop, false, token.contract.address);
        await token.from(admin).mint(airdrop.contract.address, 1000000);

        // these should be performed by the watcher
        plasma.addMember(recipient.signer.address)
        plasma.addMember(anotherRecipient.signer.address)
        plasma.addRevenue(1000)
    });

    async function publishBlock(rootHash) {
        const root = rootHash || plasma.getRootHash()
        const blockNumber = await deployer.provider.getBlockNumber();
        const resp = await airdrop.from(admin).commit(blockNumber, root, "ipfs lol")
        const iface = new ethers.utils.Interface(Airdrop.abi);
        const event = iface.parseTransaction(resp);
        return event.args;
    }

    describe("commit & blockHash", () => {
        it("correctly publishes and retrieves a block hash", async () => {
            const rootHash = "0x1234000000000000000000000000000000000000000000000000000000000000";
            const blockNumber = 123;
            const blockNumberBN = ethers.utils.bigNumberify(blockNumber);

            const resp = await airdrop.from(admin).commit(blockNumber, rootHash, "ipfs lol")
            const iface = new ethers.utils.Interface(Airdrop.abi);
            const block = iface.parseTransaction(resp);

            const returnedBlockNumber = block.args[0];
            const returnedBlockHash = block.args[1];

            assert(returnedBlockNumber.eq(blockNumberBN));
            assert.strictEqual(returnedBlockHash, rootHash);
            assert.strictEqual(await airdrop.blockHash(blockNumber), rootHash);
        });
        it("won't let operator overwrite a root hash (with same block number)", async () => {
            await airdrop.from(admin).commit(124, "0x1234000000000000000000000000000000000000000000000000000000000000", "ipfs lol")
            await airdrop.from(admin).commit(125, "0x2345000000000000000000000000000000000000000000000000000000000000", "ipfs lol")
            await assert.revert(airdrop.from(admin).commit(125, "0x3456000000000000000000000000000000000000000000000000000000000000", "ipfs lol"))
        });
    });

    describe("prove & proofIsCorrect & calculateRootHash", () => {
        // see test/merklepath.js
        it("correctly validate a proof", async () => {
            plasma.addRevenue(1000)
            const memberObj = plasma.getMember(anotherRecipient.signer.address);
            const member = MonoplasmaMember.fromObject(memberObj);
            const memberEarnings = member.earnings.toNumber();
            const memberEarningsBN = ethers.utils.bigNumberify(memberEarnings);
            const rootHash = plasma.tree.getRootHash();
            const proof = plasma.getProof(anotherRecipient.signer.address);
            const block = await publishBlock(rootHash);

            const blockNumber = block[0].toNumber();
            const blockHash = block[1];
            const zeroTokenBalance = ethers.utils.bigNumberify(0);


            // check that block was published correctly
            assert.strictEqual(blockHash, rootHash);

            // check that contract calculates root correctly
            const hash = "0x" + MerkleTree.hash(member.toHashableString()).toString("hex");
            assert.strictEqual(await airdrop.calculateRootHash(hash, proof), rootHash);

            // check that contract checks proof correctly
            assert(await airdrop.proofIsCorrect(blockNumber, member.address, memberEarnings, proof));

            // check that contract proves earnings correctly (freeze period)
            const tokenBalanceBeforeProof = await token.balanceOf(member.address);
            assert(tokenBalanceBeforeProof.eq(zeroTokenBalance));
            await airdrop.from(admin).prove(blockNumber, member.address, memberEarnings, proof)
            const tokenBalanceAfterProof = await token.balanceOf(member.address);
            assert(tokenBalanceAfterProof.eq(memberEarningsBN));
        });
    });

});
