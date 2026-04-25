// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { AgentRegistry } from "../../src/registry/AgentRegistry.sol";
import { MockAgentNFT } from "../mocks/MockAgentNFT.sol";

contract AgentRegistryTest is Test {
    MockAgentNFT internal nft;
    AgentRegistry internal registry;

    address internal operator = address(0x0FF1CE);
    address internal otherOwner = address(0x0BAD);

    address internal shareToken = address(0x5A6E);
    address internal vault = address(0xBAA1);
    bytes32 internal ensNameHash = keccak256(abi.encodePacked("auditor.stratum.eth"));

    uint256 internal constant TOKEN_ID = 42;

    function setUp() public {
        vm.warp(1_000_000);
        nft = new MockAgentNFT();
        registry = new AgentRegistry(address(nft));
        nft.mint(operator, TOKEN_ID);
    }

    function test_RegisterStoresInfoAndEmits() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit AgentRegistry.Registered(TOKEN_ID, shareToken, vault, ensNameHash, operator);

        vm.prank(operator);
        registry.register(TOKEN_ID, shareToken, vault, ensNameHash);

        AgentRegistry.AgentInfo memory got = registry.info(TOKEN_ID);
        assertEq(got.shareToken, shareToken);
        assertEq(got.vaultBase, vault);
        assertEq(got.ensNameHash, ensNameHash);
        assertEq(got.operator, operator);
        assertEq(got.createdAt, uint64(block.timestamp));
        assertTrue(registry.isRegistered(TOKEN_ID));
    }

    function test_RegisterByNonOwnerReverts() public {
        vm.prank(otherOwner);
        vm.expectRevert(AgentRegistry.NotOwner.selector);
        registry.register(TOKEN_ID, shareToken, vault, ensNameHash);
    }

    function test_RegisterTwiceReverts() public {
        vm.prank(operator);
        registry.register(TOKEN_ID, shareToken, vault, ensNameHash);

        vm.prank(operator);
        vm.expectRevert(AgentRegistry.AlreadyRegistered.selector);
        registry.register(TOKEN_ID, shareToken, vault, ensNameHash);
    }

    function test_RegisterWithZeroShareTokenReverts() public {
        vm.prank(operator);
        vm.expectRevert(AgentRegistry.InvalidConfig.selector);
        registry.register(TOKEN_ID, address(0), vault, ensNameHash);
    }

    function test_RegisterAllowsZeroVaultAndEns() public {
        // The cross-chain vault and ENS name might not be set at mint time;
        // shareToken is the only mandatory field.
        vm.prank(operator);
        registry.register(TOKEN_ID, shareToken, address(0), bytes32(0));

        AgentRegistry.AgentInfo memory got = registry.info(TOKEN_ID);
        assertEq(got.shareToken, shareToken);
        assertEq(got.vaultBase, address(0));
        assertEq(got.ensNameHash, bytes32(0));
    }

    function test_DeployRevertsWithZeroNft() public {
        vm.expectRevert(AgentRegistry.InvalidConfig.selector);
        new AgentRegistry(address(0));
    }

    function test_InfoReturnsZeroForUnregistered() public view {
        AgentRegistry.AgentInfo memory got = registry.info(999);
        assertEq(got.shareToken, address(0));
        assertEq(got.operator, address(0));
        assertFalse(registry.isRegistered(999));
    }

    function test_EntryImmutableAfterTransfer() public {
        vm.prank(operator);
        registry.register(TOKEN_ID, shareToken, vault, ensNameHash);

        // After acquisition (simulated by an iTransfer), the registry's `operator`
        // field stays as the original minter — by design.
        nft.iTransfer(TOKEN_ID, otherOwner, hex"01");

        AgentRegistry.AgentInfo memory got = registry.info(TOKEN_ID);
        assertEq(got.operator, operator);
        assertEq(got.shareToken, shareToken);
    }
}
