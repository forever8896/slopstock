// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ShareToken } from "../../src/shares/ShareToken.sol";

contract ShareTokenTest is Test {
    ShareToken internal shares;
    address internal recipient = address(0xBEEF);

    function setUp() public {
        shares = new ShareToken(address(0xA6E7), 1, "Auditor Shares", "AUDIT", recipient);
    }

    function test_TotalSupplyMintedToRecipient() public view {
        assertEq(shares.totalSupply(), 1_000_000 * 1e18);
        assertEq(shares.balanceOf(recipient), 1_000_000 * 1e18);
    }

    function test_AgentLink() public view {
        assertEq(shares.agentNft(), address(0xA6E7));
        assertEq(shares.agentTokenId(), 1);
    }
}
