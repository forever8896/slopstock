// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev Test-only ERC-721 with a public mint. Stands in for the agent iNFT in tests
///      that don't exercise 7857-specific behavior (sealed transfer, authorizeUsage).
contract MockERC721 is ERC721 {
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) { }

    function mint(address to, uint256 tokenId) external {
        _safeMint(to, tokenId);
    }
}
