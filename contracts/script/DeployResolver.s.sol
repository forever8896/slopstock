// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { StratumResolver } from "../src/ens/StratumResolver.sol";

/// @title DeployResolver — deploys the ENS CCIP-Read resolver to Sepolia.
/// @dev After this lands, attach the resolver to `stratum.eth` via the ENS
///      registry's `setResolver(node, address)` (separate tx).
contract DeployResolver is Script {
    function run() external {
        string memory gatewayUrl = vm.envString("ENS_GATEWAY_URL");
        address gatewaySigner = vm.envAddress("ENS_GATEWAY_SIGNER_ADDR");
        address owner = vm.envOr("RESOLVER_OWNER", msg.sender);

        vm.startBroadcast();
        new StratumResolver(gatewayUrl, gatewaySigner, owner);
        vm.stopBroadcast();

        // TODO: write deployed addr to deployments/sepolia.json
    }
}
