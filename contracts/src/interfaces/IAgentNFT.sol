// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAgentNFT — Stratum's view of the ERC-7857 surface we depend on.
/// @notice Spec: docs/02-smart-contracts.md §3, docs/03-sealed-inference.md.
/// @dev We forge-import the reference impl from `0gfoundation/0g-agent-nft`
///      at integration time. This interface is the contract our code uses.
interface IAgentNFT {
    event UsageAuthorized(uint256 indexed tokenId, address indexed user, uint64 expiresAt);
    event UsageRevoked(uint256 indexed tokenId, address indexed user);
    event MetadataUpdated(uint256 indexed tokenId, string newURI);

    function mint(
        address to,
        bytes32 metadataHash,
        string calldata metadataURI,
        bytes calldata sealedKey,
        bytes calldata teeAttestation
    ) external returns (uint256 tokenId);

    function iTransfer(uint256 tokenId, address to, bytes calldata transferValidityProof) external;

    function iClone(uint256 tokenId, bytes calldata transferValidityProof)
        external
        returns (uint256 newTokenId);

    function authorizeUsage(uint256 tokenId, address user, uint64 expiresAt) external;

    function revokeUsage(uint256 tokenId, address user) external;

    function isAuthorized(uint256 tokenId, address user) external view returns (bool);

    function ownerOf(uint256 tokenId) external view returns (address);

    function expectedMeasurement(uint256 tokenId) external view returns (bytes32);
}
