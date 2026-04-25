// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { StratumResolver } from "../src/ens/StratumResolver.sol";

/// @title DeployResolver — deploys the ENS CCIP-Read resolver to Sepolia.
contract DeployResolver is Script {
    function run() external {
        string memory gatewayURL = vm.envString("ENS_GATEWAY_URL");
        address gatewaySigner = vm.envAddress("ENS_GATEWAY_SIGNER_ADDR");

        vm.startBroadcast();
        StratumResolver resolver = new StratumResolver(gatewayURL, gatewaySigner);
        vm.stopBroadcast();

        // TODO: write addr to deployments/sepolia.json
        // Then attach this resolver to stratum.eth via ENS registry tx.
        resolver; // suppress unused var warning until logging is added
    }
}
