// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice Maps tokenId → (shareToken, vault address on Base, ENS namehash, operator).
/// @dev Stub. Lives on 0G Chain. Spec: docs/02-smart-contracts.md §9.
contract AgentRegistry {
    struct AgentInfo {
        address shareToken;
        address vaultBase;
        bytes32 ensNameHash;
        address operator;
        uint64 createdAt;
    }

    mapping(uint256 => AgentInfo) public info;

    event Registered(uint256 indexed tokenId, address shareToken, address vaultBase, bytes32 ensNameHash);

    // TODO: register(tokenId, shareToken, vaultBase, ensNameHash) — only iNFT owner at mint time.
}
