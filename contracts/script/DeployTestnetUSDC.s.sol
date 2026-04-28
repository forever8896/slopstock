// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { TestnetUSDC } from "../src/mocks/TestnetUSDC.sol";

/// @title DeployTestnetUSDC — deploy a permissionless-mint USDC stand-in on
///        any chain that lacks Circle's testnet USDC (or where its faucet
///        is too constrained for an automated demo).
contract DeployTestnetUSDC is Script {
    function run() external {
        vm.startBroadcast();
        TestnetUSDC usdc = new TestnetUSDC();
        vm.stopBroadcast();
        console.log("usdc:", address(usdc));
    }
}
