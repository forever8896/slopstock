// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StratumAgentNFT } from "../../src/nft/StratumAgentNFT.sol";

contract StratumAgentNFTTest is Test {
    StratumAgentNFT internal nft;

    address internal admin = address(0xA11CE);
    address internal operator = address(0x0FF1CE);
    address internal alice = address(0xA11);
    address internal bob = address(0xB0B);

    function setUp() public {
        nft = new StratumAgentNFT(admin);
    }

    // ─── mint ───────────────────────────────────────────────────────

    function test_Mint_AssignsTokenIdAndStoresMetadata() public {
        bytes32 metadataHash = keccak256("metadata");
        bytes memory sealedKey = "sealed-key";
        bytes memory att = "tee-attestation-blob";

        vm.prank(admin);
        uint256 tokenId = nft.mint(alice, metadataHash, "ipfs://x/y.json", sealedKey, att);

        assertEq(tokenId, 1);
        assertEq(nft.ownerOf(tokenId), alice);

        StratumAgentNFT.AgentMetadata memory m = nft.metadata(tokenId);
        assertEq(m.metadataHash, metadataHash);
        assertEq(m.metadataURI, "ipfs://x/y.json");
        assertEq(keccak256(m.sealedKey), keccak256(sealedKey));
        assertEq(nft.expectedMeasurement(tokenId), keccak256(att));
    }

    function test_Mint_RevertsOnZeroRecipient() public {
        vm.expectRevert();
        nft.mint(address(0), bytes32(0), "", "", "");
    }

    // ─── iTransfer ──────────────────────────────────────────────────

    function test_ITransfer_BumpsVersionAndMoves() public {
        uint256 id = _mintTo(alice);

        vm.prank(alice);
        nft.iTransfer(id, bob, hex"deadbeef");

        assertEq(nft.ownerOf(id), bob);
        assertEq(nft.usageVersion(id), 1);
    }

    function test_ITransfer_RevertsOnEmptyProof() public {
        uint256 id = _mintTo(alice);
        vm.prank(alice);
        vm.expectRevert(StratumAgentNFT.EmptyProof.selector);
        nft.iTransfer(id, bob, "");
    }

    function test_ITransfer_RevertsForNonOwner() public {
        uint256 id = _mintTo(alice);
        vm.prank(bob);
        vm.expectRevert(StratumAgentNFT.NotOwnerOrApproved.selector);
        nft.iTransfer(id, bob, hex"01");
    }

    // ─── authorizeUsage / revokeUsage ───────────────────────────────

    function test_AuthorizeUsage_OwnerCanGrant() public {
        uint256 id = _mintTo(alice);
        uint64 expires = uint64(block.timestamp + 1 days);

        vm.prank(alice);
        nft.authorizeUsage(id, bob, expires);

        assertTrue(nft.isAuthorized(id, bob));
    }

    function test_AuthorizeUsage_ApprovedForAllCanGrant() public {
        uint256 id = _mintTo(alice);

        // Owner alice approves operator for ALL tokens.
        vm.prank(alice);
        nft.setApprovalForAll(operator, true);

        // Operator (not the owner) can now grant on alice's behalf.
        uint64 expires = uint64(block.timestamp + 1 days);
        vm.prank(operator);
        nft.authorizeUsage(id, bob, expires);

        assertTrue(nft.isAuthorized(id, bob));
    }

    function test_AuthorizeUsage_PerTokenApprovedCanGrant() public {
        uint256 id = _mintTo(alice);

        vm.prank(alice);
        nft.approve(operator, id);

        uint64 expires = uint64(block.timestamp + 1 days);
        vm.prank(operator);
        nft.authorizeUsage(id, bob, expires);

        assertTrue(nft.isAuthorized(id, bob));
    }

    function test_AuthorizeUsage_RevertsForUnapproved() public {
        uint256 id = _mintTo(alice);
        vm.prank(operator); // not approved
        vm.expectRevert(StratumAgentNFT.NotOwnerOrApproved.selector);
        nft.authorizeUsage(id, bob, uint64(block.timestamp + 1 days));
    }

    function test_RevokeUsage_ApprovedForAllCanRevoke() public {
        uint256 id = _mintTo(alice);

        vm.startPrank(alice);
        nft.authorizeUsage(id, bob, uint64(block.timestamp + 1 days));
        nft.setApprovalForAll(operator, true);
        vm.stopPrank();

        vm.prank(operator);
        nft.revokeUsage(id, bob);

        assertFalse(nft.isAuthorized(id, bob));
    }

    // ─── grant lifecycle: clears on iTransfer ───────────────────────

    function test_ITransfer_ClearsOutstandingGrants() public {
        uint256 id = _mintTo(alice);

        vm.startPrank(alice);
        nft.authorizeUsage(id, bob, uint64(block.timestamp + 1 days));
        assertTrue(nft.isAuthorized(id, bob));
        nft.iTransfer(id, address(0xCC), hex"01");
        vm.stopPrank();

        assertFalse(nft.isAuthorized(id, bob));
    }

    function test_AuthorizeUsage_ExpiresOverTime() public {
        uint256 id = _mintTo(alice);
        uint64 expires = uint64(block.timestamp + 100);

        vm.prank(alice);
        nft.authorizeUsage(id, bob, expires);
        assertTrue(nft.isAuthorized(id, bob));

        vm.warp(block.timestamp + 200);
        assertFalse(nft.isAuthorized(id, bob));
    }

    // ─── helpers ────────────────────────────────────────────────────

    function _mintTo(address to) internal returns (uint256) {
        vm.prank(admin);
        return nft.mint(to, keccak256("m"), "ipfs://x", "sealed", "att");
    }
}
