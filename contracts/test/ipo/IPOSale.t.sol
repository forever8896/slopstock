// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IPOSale } from "../../src/ipo/IPOSale.sol";
import { ShareToken } from "../../src/shares/ShareToken.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract IPOSaleTest is Test {
    ShareToken internal shares;
    MockERC20 internal usdc;
    IPOSale internal sale;

    address internal nft = address(0xA6E7);
    address internal treasury = address(0x7EA);
    address internal buyer = address(0xB7E);
    uint256 internal constant TOKEN_ID = 1;

    uint256 internal constant PRICE = 1_000_000;          // $1.00 per share (USDC 6 decimals)
    uint256 internal constant MAX_SHARES = 300_000 ether; // 30% of 1M supply
    uint64 internal constant START = 1_000_000;
    uint64 internal constant END = 1_000_000 + 7 days;

    function setUp() public {
        // Park time before the sale window so opening-condition tests pass deterministically.
        vm.warp(START - 1 hours);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        shares = new ShareToken(nft, TOKEN_ID, "Auditor Shares", "AUDIT", treasury);
        sale = new IPOSale(address(shares), address(usdc), PRICE, MAX_SHARES, treasury, START, END);

        // Treasury approves the IPO to pull from its share balance.
        vm.prank(treasury);
        shares.approve(address(sale), MAX_SHARES);

        // Fund + approve buyer for plenty of USDC.
        usdc.mint(buyer, 1_000_000e6);
        vm.prank(buyer);
        usdc.approve(address(sale), type(uint256).max);
    }

    function test_BuyDuringWindowMovesSharesAndPayment() public {
        vm.warp(START + 1 hours);

        vm.prank(buyer);
        sale.buy(100 ether);

        assertEq(shares.balanceOf(buyer), 100 ether);
        assertEq(shares.balanceOf(treasury), 1_000_000 ether - 100 ether);
        assertEq(usdc.balanceOf(treasury), 100 * PRICE);
        assertEq(usdc.balanceOf(buyer), 1_000_000e6 - 100 * PRICE);
        assertEq(sale.sold(), 100 ether);
    }

    function test_BuyBeforeStartReverts() public {
        // setUp leaves us at START - 1 hour.
        vm.prank(buyer);
        vm.expectRevert(IPOSale.NotOpen.selector);
        sale.buy(100 ether);
    }

    function test_BuyAfterEndReverts() public {
        vm.warp(END);
        vm.prank(buyer);
        vm.expectRevert(IPOSale.NotOpen.selector);
        sale.buy(100 ether);
    }

    function test_BuyZeroAmountReverts() public {
        vm.warp(START + 1 hours);
        vm.prank(buyer);
        vm.expectRevert(IPOSale.ZeroAmount.selector);
        sale.buy(0);
    }

    function test_BuyMoreThanAvailableReverts() public {
        vm.warp(START + 1 hours);
        vm.prank(buyer);
        vm.expectRevert(IPOSale.SoldOut.selector);
        sale.buy(MAX_SHARES + 1);
    }

    function test_BuyExactlyAvailableSucceeds() public {
        vm.warp(START + 1 hours);
        usdc.mint(buyer, MAX_SHARES * PRICE / 1 ether); // top up
        vm.prank(buyer);
        sale.buy(MAX_SHARES);
        assertEq(sale.available(), 0);
    }

    function test_AvailableDecrements() public {
        assertEq(sale.available(), MAX_SHARES);

        vm.warp(START + 1 hours);
        vm.prank(buyer);
        sale.buy(100 ether);

        assertEq(sale.available(), MAX_SHARES - 100 ether);
    }

    function test_MultipleBuysAccumulate() public {
        vm.warp(START + 1 hours);
        vm.prank(buyer);
        sale.buy(100 ether);
        vm.prank(buyer);
        sale.buy(50 ether);

        assertEq(sale.sold(), 150 ether);
        assertEq(shares.balanceOf(buyer), 150 ether);
        assertEq(usdc.balanceOf(treasury), 150 * PRICE);
    }

    function test_IsOpenLifecycle() public {
        assertFalse(sale.isOpen());        // before start
        vm.warp(START);
        assertTrue(sale.isOpen());         // at start
        vm.warp(END - 1);
        assertTrue(sale.isOpen());         // last second
        vm.warp(END);
        assertFalse(sale.isOpen());        // at end (exclusive)
    }

    function test_DeployRevertsWithZeroPrice() public {
        vm.expectRevert(IPOSale.InvalidConfig.selector);
        new IPOSale(address(shares), address(usdc), 0, MAX_SHARES, treasury, START, END);
    }

    function test_DeployRevertsWithBadWindow() public {
        vm.expectRevert(IPOSale.InvalidConfig.selector);
        new IPOSale(address(shares), address(usdc), PRICE, MAX_SHARES, treasury, END, START);
    }

    function test_DeployRevertsWithZeroAddress() public {
        vm.expectRevert(IPOSale.InvalidConfig.selector);
        new IPOSale(address(0), address(usdc), PRICE, MAX_SHARES, treasury, START, END);
    }
}
