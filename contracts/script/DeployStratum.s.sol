// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";

/// @title DeployStratum — deploys the 0G-Chain side of Stratum.
/// @dev Singletons: AgentNFT (forked 7857), Fractionalizer, Marketplace, AgentRegistry.
contract DeployStratum is Script {
    function run() external {
        vm.startBroadcast();
        // TODO: deploy AgentNFT (forked impl) → addr1
        // TODO: deploy Fractionalizer(addr1) → addr2
        // TODO: deploy Marketplace(addr1, USDC_0G, teeOracleAddr) → addr3
        // TODO: deploy AgentRegistry() → addr4
        // TODO: write addresses to deployments/zg-galileo.json
        vm.stopBroadcast();
    }
}
