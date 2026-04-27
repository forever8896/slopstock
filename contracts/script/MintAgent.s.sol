// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { StratumAgentNFT } from "../src/nft/StratumAgentNFT.sol";

/// @title MintAgent — mints a Stratum iNFT on 0G Chain.
/// @dev Reads ticker + metadata from env, calls StratumAgentNFT.mint(), and
///      writes the resulting tokenId to deployments/agent-{TICKER}-mint.json so
///      the orchestrator script can pick it up before the Base-side deploy.
///
/// Required env:
///   AGENT_NFT_0G    — deployed StratumAgentNFT address
///   AGENT_TICKER    — short symbol (e.g. "AUDIT")
///   AGENT_ENS_NAME  — e.g. "auditor.stratum.eth"
///   AGENT_METADATA_URI — URI for off-chain metadata blob
contract MintAgent is Script {
    function run() external {
        address agentNftAddr = vm.envAddress("AGENT_NFT_0G");
        string memory ticker = vm.envString("AGENT_TICKER");
        string memory ensNameStr = vm.envString("AGENT_ENS_NAME");
        string memory metadataURI = vm.envString("AGENT_METADATA_URI");

        // Testnet placeholders. Real ERC-7857: metadataHash hashes the encrypted
        // weights blob, sealedKey wraps the model key under the TEE's pubkey,
        // teeAttestation is a TDX/SGX quote. Here we hash known seeds so the
        // values are deterministic and the operator's verifier can reproduce them.
        bytes32 metadataHash = keccak256(abi.encodePacked("stratum-testnet:", ticker, ":", metadataURI));
        bytes memory sealedKey = abi.encodePacked("stratum-testnet-sealed-key:", ticker);
        bytes memory teeAttestation = abi.encodePacked("stratum-testnet-tee-attestation:", ticker);

        console.log("=== Stratum mint agent ===");
        console.log("agentNft:", agentNftAddr);
        console.log("ticker:  ", ticker);
        console.log("ens:     ", ensNameStr);
        console.log("uri:     ", metadataURI);

        StratumAgentNFT nft = StratumAgentNFT(agentNftAddr);

        vm.startBroadcast();
        uint256 tokenId = nft.mint(msg.sender, metadataHash, metadataURI, sealedKey, teeAttestation);
        vm.stopBroadcast();

        console.log("minted tokenId:", tokenId);

        string memory key = "stratum-mint";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "owner", msg.sender);
        vm.serializeAddress(key, "agentNft", agentNftAddr);
        vm.serializeString(key, "ticker", ticker);
        vm.serializeString(key, "ensName", ensNameStr);
        vm.serializeString(key, "metadataURI", metadataURI);
        string memory json = vm.serializeUint(key, "tokenId", tokenId);

        string memory path = string.concat("./deployments/agent-", ticker, "-mint.json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
