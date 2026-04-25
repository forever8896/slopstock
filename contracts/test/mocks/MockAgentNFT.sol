// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev Test-only iNFT that mimics the parts of ERC-7857 the Marketplace relies on:
///      - `ownerOf` (inherited from ERC721)
///      - `iTransfer(tokenId, to, proof)` — verifies a non-empty proof and moves
///        the token. Bypasses ERC-721's approval check, matching the spec where
///        the TEE re-encryption proof itself is the authorization.
///      - `mint(to, tokenId)` test helper.
///
///      Does NOT implement the IAgentNFT interface explicitly — Solidity dispatches
///      by selector at the call site, so the Marketplace's IAgentNFT cast still
///      finds the right functions. Keeps the mock minimal and avoids stubbing
///      every method on the interface.
contract MockAgentNFT is ERC721 {
    constructor() ERC721("Stratum Agent (mock)", "AGENT") { }

    function mint(address to, uint256 tokenId) external {
        _safeMint(to, tokenId);
    }

    /// @dev Simulate ERC-7857's iTransfer: a non-empty proof authorizes the move.
    function iTransfer(uint256 tokenId, address to, bytes calldata transferValidityProof) external {
        require(transferValidityProof.length > 0, "MockAgentNFT: empty proof");
        address owner = ownerOf(tokenId);
        _transfer(owner, to, tokenId);
    }
}
