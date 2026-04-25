// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Marketplace } from "../../src/market/Marketplace.sol";
import { MockAgentNFT } from "../mocks/MockAgentNFT.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract MarketplaceTest is Test {
    MockAgentNFT internal nft;
    MockERC20 internal usdc;
    Marketplace internal market;

    address internal seller = address(0x5E11E7);
    address internal bidderA = address(0xB1DA);
    address internal bidderB = address(0xB1DB);
    bytes internal validProof = hex"deadbeef";
    bytes internal pubkey = hex"abcdef0123456789";

    uint256 internal constant TOKEN_ID = 42;

    function setUp() public {
        // Park time at a non-zero baseline so `block.timestamp - 1` is safe.
        vm.warp(1_000_000);

        nft = new MockAgentNFT();
        usdc = new MockERC20("USD Coin", "USDC", 6);
        market = new Marketplace(address(nft), address(usdc));

        nft.mint(seller, TOKEN_ID);

        usdc.mint(bidderA, 1_000_000e6);
        usdc.mint(bidderB, 1_000_000e6);
        vm.prank(bidderA);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(bidderB);
        usdc.approve(address(market), type(uint256).max);
    }

    function _expiry(uint256 secondsAhead) internal view returns (uint64) {
        return uint64(block.timestamp + secondsAhead);
    }

    function test_PostBidEscrows() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        assertEq(usdc.balanceOf(address(market)), 50_000e6);
        assertEq(usdc.balanceOf(bidderA), 950_000e6);

        Marketplace.Bid memory b = market.getBid(TOKEN_ID);
        assertEq(b.bidder, bidderA);
        assertEq(b.price, 50_000e6);
        assertEq(b.expiresAt, _expiry(7 days));
        assertEq(b.bidderPubkey, pubkey);
    }

    function test_HigherBidRefundsPrior() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        vm.prank(bidderB);
        market.postBid(TOKEN_ID, 60_000e6, pubkey, _expiry(7 days));

        // bidderA fully refunded; bidderB now holds the active bid.
        assertEq(usdc.balanceOf(bidderA), 1_000_000e6);
        assertEq(usdc.balanceOf(bidderB), 940_000e6);
        assertEq(usdc.balanceOf(address(market)), 60_000e6);

        Marketplace.Bid memory b = market.getBid(TOKEN_ID);
        assertEq(b.bidder, bidderB);
        assertEq(b.price, 60_000e6);
    }

    function test_LowerBidReverts() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        vm.prank(bidderB);
        vm.expectRevert(Marketplace.PriceTooLow.selector);
        market.postBid(TOKEN_ID, 40_000e6, pubkey, _expiry(7 days));
    }

    function test_EqualBidReverts() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        vm.prank(bidderB);
        vm.expectRevert(Marketplace.PriceTooLow.selector);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));
    }

    function test_ZeroPriceReverts() public {
        vm.prank(bidderA);
        vm.expectRevert(Marketplace.PriceTooLow.selector);
        market.postBid(TOKEN_ID, 0, pubkey, _expiry(7 days));
    }

    function test_PastExpiryReverts() public {
        vm.prank(bidderA);
        vm.expectRevert(Marketplace.InvalidExpiry.selector);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, uint64(block.timestamp - 1));
    }

    function test_AcceptHappyPath() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        vm.prank(seller);
        market.accept(TOKEN_ID, validProof);

        // NFT moved.
        assertEq(nft.ownerOf(TOKEN_ID), bidderA);
        // Seller received escrow; market balance is zero.
        assertEq(usdc.balanceOf(seller), 50_000e6);
        assertEq(usdc.balanceOf(address(market)), 0);
        // Bid cleared.
        Marketplace.Bid memory b = market.getBid(TOKEN_ID);
        assertEq(b.bidder, address(0));
        assertEq(b.price, 0);
    }

    function test_AcceptByNonOwnerReverts() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        vm.prank(bidderB);
        vm.expectRevert(Marketplace.NotOwner.selector);
        market.accept(TOKEN_ID, validProof);
    }

    function test_AcceptEmptyProofReverts() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        vm.prank(seller);
        vm.expectRevert(Marketplace.EmptyProof.selector);
        market.accept(TOKEN_ID, "");
    }

    function test_AcceptExpiredReverts() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(1 days));

        vm.warp(block.timestamp + 2 days);
        vm.prank(seller);
        vm.expectRevert(Marketplace.BidExpired.selector);
        market.accept(TOKEN_ID, validProof);
    }

    function test_AcceptNoBidReverts() public {
        vm.prank(seller);
        vm.expectRevert(Marketplace.NoBid.selector);
        market.accept(TOKEN_ID, validProof);
    }

    function test_CancelExpiredRefunds() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(1 days));

        vm.warp(block.timestamp + 2 days);

        // Anyone may call.
        market.cancelExpired(TOKEN_ID);

        assertEq(usdc.balanceOf(bidderA), 1_000_000e6);
        Marketplace.Bid memory b = market.getBid(TOKEN_ID);
        assertEq(b.bidder, address(0));
    }

    function test_CancelBeforeExpiryReverts() public {
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(7 days));

        vm.expectRevert(Marketplace.BidNotExpired.selector);
        market.cancelExpired(TOKEN_ID);
    }

    function test_CancelNoBidReverts() public {
        vm.expectRevert(Marketplace.NoBid.selector);
        market.cancelExpired(TOKEN_ID);
    }

    function test_RebidAfterCancel() public {
        // First bid expires and is cancelled.
        vm.prank(bidderA);
        market.postBid(TOKEN_ID, 50_000e6, pubkey, _expiry(1 days));
        vm.warp(block.timestamp + 2 days);
        market.cancelExpired(TOKEN_ID);

        // Lower bid is now allowed (no prior).
        vm.prank(bidderB);
        market.postBid(TOKEN_ID, 30_000e6, pubkey, _expiry(7 days));

        Marketplace.Bid memory b = market.getBid(TOKEN_ID);
        assertEq(b.bidder, bidderB);
        assertEq(b.price, 30_000e6);
    }
}
