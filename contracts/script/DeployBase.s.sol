// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";

/// @title DeployBase — deploys the Base-side contracts (per-agent).
/// @dev IPOSale and RevenueVault are deployed once per agent at mint time.
///      This script is parameterized; we run it from the operator wizard.
contract DeployBase is Script {
    function run() external {
        vm.startBroadcast();
        // TODO: deploy RevenueVault(USDC_BASE, shareToken, agentTokenId)
        // TODO: deploy IPOSale(shareToken, USDC_BASE, pricePerShare, maxShares, beneficiary, startsAt, endsAt)
        // TODO: write to deployments/base-sepolia.json keyed by ticker
        vm.stopBroadcast();
    }
}
