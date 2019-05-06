// adapted from https://github.com/OpenZeppelin/openzeppelin-solidity/blob/v1.12.0/test/ownership/Claimable.test.js

const etherlime = require('etherlime');
const Ownable = require('../../build/Ownable.json');

describe('Ownable', async () => {
    let ownable;
    const owner = accounts[0]
    before(async () => {
        deployer = new etherlime.EtherlimeGanacheDeployer();
        ownable = await deployer.deploy(Ownable);
    });

    it("should have an owner", async function () {
        const _owner = await ownable.owner();
        assert.strictEqual(owner.signer.address, _owner, 'Initial contract owner does not match');
    });

    it("changes pendingOwner after transfer", async function () {
        const newOwner = accounts[1]
        await ownable.transferOwnership(newOwner.signer.address)
        const pendingOwner = await ownable.pendingOwner()
        assert.strictEqual(newOwner.signer.address, pendingOwner, 'New contract owner does not match');
    });

    it("should prevent to claimOwnership from no pendingOwner", async function () {
        const noPendingOwner = accounts[2];
        await assert.revert(ownable.from(noPendingOwner).claimOwnership(), 'onlyPendingOwner');
    });

    it("should prevent non-owners from transfering", async function () {
        const other = accounts[2]
        const owner = await ownable.owner();

        assert(owner !== other)
        assert.notStrictEqual(other.signer.address, owner, 'Owner and other account match!');
        await assert.revert(ownable.from(other).transferOwnership(other.signer.address), 'onlyOwner');
    });

    describe("after initiating a transfer", function () {
        let newOwner

        beforeEach(async function () {
            newOwner = accounts[1]
            await ownable.transferOwnership(newOwner.signer.address)
        })

        it("changes allow pending owner to claim ownership", async function () {
            await ownable.from(newOwner).claimOwnership();
            const owner = await ownable.owner();
            assert.strictEqual(newOwner.signer.address, owner, 'New contract owner does not match');
        })
    });
});

// contract("Ownable", function (accounts) {
//     let ownable

//     beforeEach(async function () {
//         ownable = await Ownable.new()
//     })

//     it("should have an owner", async function () {
//         const owner = await ownable.owner()
//         assert(owner !== 0)
//     })

//     it("changes pendingOwner after transfer", async function () {
//         const newOwner = accounts[1]
//         await ownable.transferOwnership(newOwner)
//         const pendingOwner = await ownable.pendingOwner()

//         assert(pendingOwner === newOwner)
//     })

//     it("should prevent to claimOwnership from no pendingOwner", async function () {
//         assertFails(ownable.claimOwnership({ from: accounts[2] }))
//     })

//     it("should prevent non-owners from transfering", async function () {
//         const other = accounts[2]
//         const owner = await ownable.owner.call()

//         assert(owner !== other)
//         assertFails(ownable.transferOwnership(other, { from: other }))
//     })

//     describe("after initiating a transfer", function () {
//         let newOwner

//         beforeEach(async function () {
//             newOwner = accounts[1]
//             await ownable.transferOwnership(newOwner)
//         })

//         it("changes allow pending owner to claim ownership", async function () {
//             await ownable.claimOwnership({ from: newOwner })
//             const owner = await ownable.owner()

//             assert(owner === newOwner)
//         })
//     })
// })