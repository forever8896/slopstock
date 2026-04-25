// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { RevenueVault } from "../../src/revenue/RevenueVault.sol";
import { ShareToken } from "../../src/shares/ShareToken.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract RevenueVaultTest is Test {
    MockERC20 internal usdc;
    ShareToken internal shares;
    RevenueVault internal vault;

    address internal nft = address(0xA6E7);
    uint256 internal constant TOKEN_ID = 1;

    address internal operator = address(0x0FF1CE);     // 70% holder
    address internal alice = address(0xA11CE);          // 20% holder
    address internal bob = address(0xB0B);              // 10% holder

    uint256 internal constant TOTAL = 1_000_000 ether;

    function setUp() public {
        vm.roll(100);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        // Mint all shares to operator initially; redistribute to investors.
        shares = new ShareToken(nft, TOKEN_ID, "Auditor Shares", "AUDIT", operator);

        vault = new RevenueVault(address(usdc), address(shares), TOKEN_ID);

        // Distribute: operator keeps 70%, alice gets 20%, bob gets 10%.
        vm.startPrank(operator);
        shares.transfer(alice, 200_000 ether);
        shares.transfer(bob, 100_000 ether);
        vm.stopPrank();

        // Roll past these transfers so they're committed before any snap.
        vm.roll(101);
    }

    function _fund(uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(vault), amount);
        vault.fund(amount);
    }

    function test_FundIncreasesBalance() public {
        _fund(100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
    }

    function test_FundEmitsReceivedEvent() public {
        usdc.mint(address(this), 100e6);
        usdc.approve(address(vault), 100e6);

        // ERC20.Transfer fires first inside safeTransferFrom; RevenueVault.Received
        // is the second log. Walk recorded logs and assert on the second one.
        vm.recordLogs();
        vault.fund(100e6);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        bytes32 sig = keccak256("Received(uint256,address)");
        bool found;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter == address(vault) && entries[i].topics[0] == sig) {
                assertEq(entries[i].topics[1], bytes32(uint256(uint160(address(this)))));
                assertEq(abi.decode(entries[i].data, (uint256)), 100e6);
                found = true;
                break;
            }
        }
        assertTrue(found, "Received event not emitted");
    }

    function test_SnapRevertsOnEmptyVault() public {
        vm.expectRevert(RevenueVault.NoBalance.selector);
        vault.snap();
    }

    function test_SnapRecordsBalanceAndPastTimepoint() public {
        _fund(100e6);
        vm.roll(110);

        uint256 sid = vault.snap();
        assertEq(sid, 0);
        assertEq(vault.snapshotCount(), 1);

        (uint256 timepoint, uint256 bal, ) = vault.snapshotAt(0);
        assertEq(timepoint, 109);     // block.number - 1
        assertEq(bal, 100e6);
    }

    function test_ProRataDistribution_70_20_10() public {
        _fund(100e6);                  // 100 USDC (6 decimals)
        vm.roll(110);
        vault.snap();

        uint256 sid = 0;

        // Pull pattern: each holder claims.
        vm.prank(operator);
        vault.claim(sid);
        vm.prank(alice);
        vault.claim(sid);
        vm.prank(bob);
        vault.claim(sid);

        assertEq(usdc.balanceOf(operator), 70e6);
        assertEq(usdc.balanceOf(alice), 20e6);
        assertEq(usdc.balanceOf(bob), 10e6);

        // No dust left for nice round percentages.
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_DistributeToPushesToHolder() public {
        _fund(100e6);
        vm.roll(110);
        uint256 sid = vault.snap();

        // KeeperHub-style push.
        vault.distributeTo(sid, operator);
        vault.distributeTo(sid, alice);
        vault.distributeTo(sid, bob);

        assertEq(usdc.balanceOf(operator), 70e6);
        assertEq(usdc.balanceOf(alice), 20e6);
        assertEq(usdc.balanceOf(bob), 10e6);
    }

    function test_DoubleClaimReverts() public {
        _fund(100e6);
        vm.roll(110);
        uint256 sid = vault.snap();

        vm.prank(operator);
        vault.claim(sid);

        vm.prank(operator);
        vm.expectRevert(RevenueVault.AlreadyClaimed.selector);
        vault.claim(sid);
    }

    function test_PullAndPushAreMutuallyExclusive() public {
        _fund(100e6);
        vm.roll(110);
        uint256 sid = vault.snap();

        vm.prank(operator);
        vault.claim(sid);

        vm.expectRevert(RevenueVault.AlreadyClaimed.selector);
        vault.distributeTo(sid, operator);
    }

    function test_HolderWhoSoldBeforeSnapGetsNothing() public {
        // Operator sells everything to alice BEFORE snap. So at snap time,
        // operator holds 0%, alice holds 90%, bob holds 10%.
        vm.prank(operator);
        shares.transfer(alice, 700_000 ether);

        vm.roll(105);
        _fund(100e6);
        vm.roll(110);
        uint256 sid = vault.snap();

        assertEq(vault.pendingFor(sid, operator), 0);
        assertEq(vault.pendingFor(sid, alice), 90e6);
        assertEq(vault.pendingFor(sid, bob), 10e6);
    }

    function test_HolderWhoBoughtAfterSnapGetsNothing() public {
        _fund(100e6);
        vm.roll(110);
        uint256 sid = vault.snap();

        // After snap: operator sells 100% to a newcomer.
        vm.roll(111);
        address newcomer = address(0xCAFE);
        vm.prank(operator);
        shares.transfer(newcomer, 700_000 ether);

        // Newcomer's claim is 0; operator still owed 70% based on snapshot timepoint.
        assertEq(vault.pendingFor(sid, newcomer), 0);
        assertEq(vault.pendingFor(sid, operator), 70e6);
    }

    function test_TwoSnapshotsIndependent() public {
        _fund(100e6);
        vm.roll(110);
        uint256 sid0 = vault.snap();

        // More revenue arrives.
        usdc.mint(address(vault), 50e6);
        vm.roll(120);
        uint256 sid1 = vault.snap();

        // Snapshot 1's balance is the cumulative *current* balance (100 + 50 = 150),
        // because nothing has been distributed yet. Each holder can claim from each.
        assertEq(vault.pendingFor(sid0, alice), 20e6);
        assertEq(vault.pendingFor(sid1, alice), 30e6);   // 20% of 150

        vm.prank(alice);
        vault.claim(sid0);
        vm.prank(alice);
        vault.claim(sid1);
        assertEq(usdc.balanceOf(alice), 50e6);
    }

    function test_PendingForRevertsOnInvalidSnapshot() public {
        vm.expectRevert(RevenueVault.InvalidSnapshot.selector);
        vault.pendingFor(0, operator);
    }
}
