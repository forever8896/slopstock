// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Fractionalizer } from "../../src/shares/Fractionalizer.sol";
import { ShareToken } from "../../src/shares/ShareToken.sol";
import { MockERC721 } from "../mocks/MockERC721.sol";

contract FractionalizerTest is Test {
    MockERC721 internal nft;
    Fractionalizer internal fx;

    address internal operator = address(0x0FF1CE);
    address internal recipient = address(0xBEEF);
    uint256 internal constant TOKEN_ID = 42;

    function setUp() public {
        vm.roll(100);
        nft = new MockERC721("Stratum Agent", "AGENT");
        fx = new Fractionalizer(address(nft));

        nft.mint(operator, TOKEN_ID);
        vm.prank(operator);
        nft.setApprovalForAll(address(fx), true);
    }

    function test_FractionalizeLocksNftAndMintsShares() public {
        vm.prank(operator);
        address shareTokenAddr = fx.fractionalize(TOKEN_ID, "Auditor Shares", "AUDIT", recipient);

        assertEq(nft.ownerOf(TOKEN_ID), address(fx));

        ShareToken s = ShareToken(shareTokenAddr);
        assertEq(s.totalSupply(), 1_000_000 ether);
        assertEq(s.balanceOf(recipient), 1_000_000 ether);

        (address sa, address creator, bool active) = fx.vaults(TOKEN_ID);
        assertEq(sa, shareTokenAddr);
        assertEq(creator, operator);
        assertTrue(active);
    }

    function test_RevertsWhenNotOwner() public {
        address bystander = address(0x1234);
        vm.prank(bystander);
        vm.expectRevert(Fractionalizer.NotOwner.selector);
        fx.fractionalize(TOKEN_ID, "X", "X", recipient);
    }

    function test_RevertsWhenAlreadyFractionalized() public {
        vm.prank(operator);
        fx.fractionalize(TOKEN_ID, "X", "X", recipient);

        vm.prank(operator);
        vm.expectRevert(Fractionalizer.AlreadyFractionalized.selector);
        fx.fractionalize(TOKEN_ID, "Y", "Y", recipient);
    }

    function test_RedeemRequires100PercentHolder() public {
        vm.prank(operator);
        address shareTokenAddr = fx.fractionalize(TOKEN_ID, "X", "X", recipient);
        ShareToken s = ShareToken(shareTokenAddr);

        // Ship some shares away → holder is no longer 100%.
        vm.prank(recipient);
        s.transfer(address(0xDEAD), 1 ether);

        vm.prank(recipient);
        s.approve(address(fx), 1_000_000 ether);
        vm.prank(recipient);
        vm.expectRevert(Fractionalizer.NotFullHolder.selector);
        fx.redeem(TOKEN_ID);
    }

    function test_RedeemBurnsAllSharesAndReleasesNft() public {
        vm.prank(operator);
        address shareTokenAddr = fx.fractionalize(TOKEN_ID, "X", "X", recipient);
        ShareToken s = ShareToken(shareTokenAddr);

        vm.prank(recipient);
        s.approve(address(fx), 1_000_000 ether);

        vm.prank(recipient);
        fx.redeem(TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), recipient);
        assertEq(s.totalSupply(), 0);
        ( , , bool active) = fx.vaults(TOKEN_ID);
        assertFalse(active);
    }

    function test_RedeemRevertsWhenNotFractionalized() public {
        vm.prank(operator);
        vm.expectRevert(Fractionalizer.NotFractionalized.selector);
        fx.redeem(TOKEN_ID);
    }
}
