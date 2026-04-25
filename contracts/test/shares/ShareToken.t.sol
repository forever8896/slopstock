// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ShareToken } from "../../src/shares/ShareToken.sol";

contract ShareTokenTest is Test {
    ShareToken internal shares;

    address internal constant AGENT_NFT = address(0xA6E7);
    uint256 internal constant TOKEN_ID = 1;
    address internal recipient = address(0xBEEF);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        // Roll forward so block.number > 0 for ERC20Votes lookups in later tests.
        vm.roll(100);
        shares = new ShareToken(AGENT_NFT, TOKEN_ID, "Auditor Shares", "AUDIT", recipient);
    }

    function test_TotalSupplyMintedToRecipient() public view {
        assertEq(shares.totalSupply(), 1_000_000 ether);
        assertEq(shares.balanceOf(recipient), 1_000_000 ether);
    }

    function test_AgentLink() public view {
        assertEq(shares.agentNft(), AGENT_NFT);
        assertEq(shares.agentTokenId(), TOKEN_ID);
    }

    function test_RecipientAutoDelegatedOnMint() public view {
        // Auto-delegate-to-self should fire inside the constructor's _mint.
        assertEq(shares.delegates(recipient), recipient);
        assertEq(shares.getVotes(recipient), 1_000_000 ether);
    }

    function test_AutoDelegateOnTransfer() public {
        vm.prank(recipient);
        shares.transfer(alice, 100_000 ether);

        // Sender keeps self-delegate (was set at mint).
        assertEq(shares.delegates(recipient), recipient);
        // Recipient is auto-delegated on first receive.
        assertEq(shares.delegates(alice), alice);

        assertEq(shares.getVotes(recipient), 900_000 ether);
        assertEq(shares.getVotes(alice), 100_000 ether);
    }

    function test_HistoricalLookupsAfterTransfers() public {
        // setUp deployed at block 100 → mint checkpoint is at block 100.
        uint256 mintBlock = block.number;

        vm.roll(101);
        vm.prank(recipient);
        shares.transfer(alice, 200_000 ether);

        vm.roll(102);
        vm.prank(recipient);
        shares.transfer(bob, 100_000 ether);

        vm.roll(103);

        // Historical lookups reflect state as of each block.
        assertEq(shares.getPastVotes(recipient, mintBlock), 1_000_000 ether);
        assertEq(shares.getPastVotes(alice, mintBlock), 0);
        assertEq(shares.getPastVotes(recipient, 101), 800_000 ether);
        assertEq(shares.getPastVotes(alice, 101), 200_000 ether);
        assertEq(shares.getPastVotes(recipient, 102), 700_000 ether);
        assertEq(shares.getPastVotes(bob, 102), 100_000 ether);

        assertEq(shares.getPastTotalSupply(mintBlock), 1_000_000 ether);
        assertEq(shares.getPastTotalSupply(101), 1_000_000 ether);
    }

    function test_BurnableLowersTotalSupply() public {
        vm.roll(101);
        vm.prank(recipient);
        shares.burn(1_000 ether);
        assertEq(shares.totalSupply(), 999_000 ether);
        assertEq(shares.balanceOf(recipient), 999_000 ether);
    }

    function test_BurnFromRequiresAllowance() public {
        vm.roll(101);
        vm.prank(recipient);
        shares.approve(alice, 5_000 ether);

        vm.prank(alice);
        shares.burnFrom(recipient, 5_000 ether);
        assertEq(shares.totalSupply(), 1_000_000 ether - 5_000 ether);
    }
}
