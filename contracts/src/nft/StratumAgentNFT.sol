// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IAgentNFT } from "../interfaces/IAgentNFT.sol";

/// @title StratumAgentNFT
/// @notice Testnet ERC-7857 implementation. ERC-721 + per-token sealed metadata,
///         per-user usage authorizations that auto-clear on transfer, and an
///         `iTransfer` entry point that the Marketplace calls during acquisition.
///
/// @dev TODO(7857-fork): The TEE re-encryption proof check inside `iTransfer` is
///      a placeholder — it requires the proof to be non-empty and trusts upstream
///      verification. The full ERC-7857 implementation (which parses TDX/SGX
///      quotes and rotates the sealed key inside the TEE) lands when we fork
///      `0gfoundation/0g-agent-nft`. For testnet, the contract still produces
///      the correct on-chain effects: ownership transfer + invalidation of all
///      `authorizeUsage` grants for the token (via the version-counter trick).
contract StratumAgentNFT is ERC721, Ownable, IAgentNFT {
    struct AgentMetadata {
        bytes32 metadataHash;
        string metadataURI;
        bytes sealedKey;
        bytes32 expectedMeasurement;
    }

    uint256 private _nextId;

    mapping(uint256 => AgentMetadata) private _meta;

    /// @dev tokenId → counter incremented on every successful transfer. Combined
    ///      with `_grantedAtVersion` below, this lets us cheaply invalidate all
    ///      outstanding `authorizeUsage` grants in O(1) on transfer.
    mapping(uint256 => uint64) public usageVersion;

    /// @dev tokenId → user → version at which the grant was issued. A grant is
    ///      considered live only when `_grantedAtVersion[tokenId][user] == usageVersion[tokenId]`.
    mapping(uint256 => mapping(address => uint64)) private _grantedAtVersion;

    /// @dev tokenId → user → expiry timestamp. Combined with the version check.
    mapping(uint256 => mapping(address => uint64)) private _grantExpiresAt;

    /// @notice Stratum-specific cross-chain pointers, set once per token.
    mapping(uint256 => address) public shareToken;
    mapping(uint256 => address) public revenueVault;
    mapping(uint256 => string) public ensName;

    error EmptyProof();
    error NotOwnerOrApproved();
    error InvalidConfig();
    error MappingsAlreadySet();

    constructor(address initialOwner) ERC721("Stratum Agent", "AGENT") Ownable(initialOwner) { }

    // ─── ERC-7857 surface ─────────────────────────────────────────────────

    /// @inheritdoc IAgentNFT
    function mint(
        address to,
        bytes32 metadataHash,
        string calldata metadataURI,
        bytes calldata sealedKey,
        bytes calldata teeAttestation
    ) external returns (uint256 tokenId) {
        if (to == address(0)) revert InvalidConfig();

        unchecked {
            tokenId = ++_nextId;
        }

        // expectedMeasurement is derived from the TEE attestation. Real ERC-7857
        // parses the quote structure; for testnet we use keccak256 of the blob —
        // the operator's attestation verifier (off-chain) reproduces the same hash.
        bytes32 measurement = keccak256(teeAttestation);

        _meta[tokenId] = AgentMetadata({
            metadataHash: metadataHash,
            metadataURI: metadataURI,
            sealedKey: sealedKey,
            expectedMeasurement: measurement
        });

        _safeMint(to, tokenId);
        emit MetadataUpdated(tokenId, metadataURI);
    }

    /// @inheritdoc IAgentNFT
    /// @dev TODO(7857-fork): real impl verifies the TEE re-encryption proof on-chain.
    ///      Here we require a non-empty proof and trust the operator side to have
    ///      verified the quote before submitting. Effects (transfer + grant clearing)
    ///      are real.
    function iTransfer(uint256 tokenId, address to, bytes calldata transferValidityProof) external {
        if (transferValidityProof.length == 0) revert EmptyProof();
        address owner = _ownerOf(tokenId);
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender) && getApproved(tokenId) != msg.sender) {
            revert NotOwnerOrApproved();
        }

        // The bump invalidates every outstanding grant for this token.
        unchecked {
            usageVersion[tokenId]++;
        }

        // _update with auth=address(0) skips the standard ERC-721 approval check —
        // we already authorized via the proof + ownership/approval.
        _update(to, tokenId, address(0));
    }

    /// @inheritdoc IAgentNFT
    /// @dev iClone (sealed-key duplication) requires the same TEE machinery as iTransfer
    ///      and isn't on the hackathon critical path. Reverts deliberately.
    function iClone(uint256, bytes calldata) external pure returns (uint256) {
        revert("StratumAgentNFT: iClone not implemented on testnet");
    }

    /// @inheritdoc IAgentNFT
    /// @dev Owner or any approved operator (per ERC-721 approval semantics) may
    ///      grant usage. This lets a delegated operator key — e.g. the Stratum
    ///      operator node — issue subscriber grants after validating an x402
    ///      payment, without exposing the iNFT owner's keys to the box.
    function authorizeUsage(uint256 tokenId, address user, uint64 expiresAt) external {
        _checkApprovedOrOwner(tokenId);
        _grantedAtVersion[tokenId][user] = usageVersion[tokenId];
        _grantExpiresAt[tokenId][user] = expiresAt;
        emit UsageAuthorized(tokenId, user, expiresAt);
    }

    /// @inheritdoc IAgentNFT
    function revokeUsage(uint256 tokenId, address user) external {
        _checkApprovedOrOwner(tokenId);
        delete _grantedAtVersion[tokenId][user];
        delete _grantExpiresAt[tokenId][user];
        emit UsageRevoked(tokenId, user);
    }

    /// @dev msg.sender must be the owner of `tokenId`, an account
    ///      `setApprovalForAll`'d by the owner, or the per-token approved address.
    function _checkApprovedOrOwner(uint256 tokenId) internal view {
        address owner = _ownerOf(tokenId);
        if (
            msg.sender != owner
                && !isApprovedForAll(owner, msg.sender)
                && getApproved(tokenId) != msg.sender
        ) {
            revert NotOwnerOrApproved();
        }
    }

    /// @inheritdoc IAgentNFT
    function isAuthorized(uint256 tokenId, address user) external view returns (bool) {
        if (_grantedAtVersion[tokenId][user] != usageVersion[tokenId]) return false;
        return _grantExpiresAt[tokenId][user] > block.timestamp;
    }

    /// @inheritdoc IAgentNFT
    function expectedMeasurement(uint256 tokenId) external view returns (bytes32) {
        return _meta[tokenId].expectedMeasurement;
    }

    // ─── Stratum extensions ───────────────────────────────────────────────

    /// @notice Pin the cross-chain pointers for a token. One-shot; only the current
    ///         owner may call. Used by the operator wizard right after mint, before
    ///         AgentRegistry.register().
    function setMappings(
        uint256 tokenId,
        address _shareToken,
        address _revenueVault,
        string calldata _ensName
    ) external {
        if (_ownerOf(tokenId) != msg.sender) revert NotOwnerOrApproved();
        if (shareToken[tokenId] != address(0)) revert MappingsAlreadySet();
        shareToken[tokenId] = _shareToken;
        revenueVault[tokenId] = _revenueVault;
        ensName[tokenId] = _ensName;
    }

    function metadata(uint256 tokenId) external view returns (AgentMetadata memory) {
        return _meta[tokenId];
    }

    // ─── Resolve ownerOf collision (ERC721 + IAgentNFT) ───────────────────

    function ownerOf(uint256 tokenId) public view override(ERC721, IAgentNFT) returns (address) {
        return super.ownerOf(tokenId);
    }
}
