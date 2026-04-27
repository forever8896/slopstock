// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { StratumAgentNFT } from "../src/nft/StratumAgentNFT.sol";
import { TestnetUSDC } from "../src/mocks/TestnetUSDC.sol";
import { Marketplace } from "../src/market/Marketplace.sol";
import { Fractionalizer } from "../src/shares/Fractionalizer.sol";
import { AgentRegistry } from "../src/registry/AgentRegistry.sol";

/// @title DeployStratum — deploys the 0G-side singletons.
/// @dev Run:
///   forge script script/DeployStratum.s.sol \
///     --rpc-url $ZG_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast
///
/// On success, writes deployments/zg-galileo.json with all addresses.
contract DeployStratum is Script {
    function run() external {
        uint256 chainId = block.chainid;
        address deployer = msg.sender;
        console.log("=== Stratum 0G-side deploy ===");
        console.log("chain id:    ", chainId);
        console.log("deployer:    ", deployer);

        vm.startBroadcast();

        StratumAgentNFT agentNft = new StratumAgentNFT(deployer);
        TestnetUSDC usdc = new TestnetUSDC();
        Marketplace marketplace = new Marketplace(address(agentNft), address(usdc));
        Fractionalizer fractionalizer = new Fractionalizer(address(agentNft));
        AgentRegistry registry = new AgentRegistry(address(agentNft));

        vm.stopBroadcast();

        console.log("agentNft:      ", address(agentNft));
        console.log("usdc:          ", address(usdc));
        console.log("marketplace:   ", address(marketplace));
        console.log("fractionalizer:", address(fractionalizer));
        console.log("agentRegistry: ", address(registry));

        _writeArtifact(
            chainId,
            deployer,
            address(agentNft),
            address(usdc),
            address(marketplace),
            address(fractionalizer),
            address(registry)
        );
    }

    function _writeArtifact(
        uint256 chainId,
        address deployer,
        address agentNft,
        address usdc,
        address marketplace,
        address fractionalizer,
        address registry
    ) internal {
        string memory key = "stratum-zg-deploy";
        vm.serializeUint(key, "chainId", chainId);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "agentNft", agentNft);
        vm.serializeAddress(key, "usdc", usdc);
        vm.serializeAddress(key, "marketplace", marketplace);
        vm.serializeAddress(key, "fractionalizer", fractionalizer);
        string memory json = vm.serializeAddress(key, "agentRegistry", registry);

        string memory path = string.concat("./deployments/zg-galileo.json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
