// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { ShareToken } from "../src/shares/ShareToken.sol";
import { RevenueVault } from "../src/revenue/RevenueVault.sol";
import { IPOSale } from "../src/ipo/IPOSale.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployBase — deploys the per-agent Base-side bundle (ShareToken + RevenueVault + IPOSale).
/// @dev Parameterized via env vars so the operator wizard / hero-mint script can drive it.
///
/// Required env vars:
///   AGENT_NFT_0G       — iNFT contract on 0G Chain (cross-chain pointer, not called)
///   AGENT_TOKEN_ID     — uint256 of the freshly-minted iNFT
///   AGENT_TICKER       — short symbol (e.g. "AUDIT")
///   AGENT_NAME         — long name (e.g. "Auditor Shares")
///   USDC_BASE          — Circle testnet USDC on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
///   IPO_PRICE          — per-share price in USDC's smallest units (e.g. 1_000_000 = $1.00)
///   IPO_MAX_SHARES     — shares offered in this round (in 18-decimal share units, e.g. 300_000 ether)
///   IPO_STARTS_AT      — unix timestamp
///   IPO_ENDS_AT        — unix timestamp
///
/// Optional env vars:
///   AGENT_TREASURY     — beneficiary; defaults to deployer
///
/// Run:
///   forge script script/DeployBase.s.sol \
///     --rpc-url $BASE_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast
///
/// On success, writes deployments/base-sepolia-{TICKER}.json.
contract DeployBase is Script {
    function run() external {
        address agentNft0g = vm.envAddress("AGENT_NFT_0G");
        uint256 tokenId = vm.envUint("AGENT_TOKEN_ID");
        string memory ticker = vm.envString("AGENT_TICKER");
        string memory agentName = vm.envString("AGENT_NAME");
        address usdc = vm.envAddress("USDC_BASE");
        uint256 ipoPrice = vm.envUint("IPO_PRICE");
        uint256 ipoMaxShares = vm.envUint("IPO_MAX_SHARES");
        uint64 startsAt = uint64(vm.envUint("IPO_STARTS_AT"));
        uint64 endsAt = uint64(vm.envUint("IPO_ENDS_AT"));
        address treasury = vm.envOr("AGENT_TREASURY", msg.sender);

        console.log("=== Stratum Base-side deploy ===");
        console.log("chain id: ", block.chainid);
        console.log("ticker:   ", ticker);
        console.log("agentNft0g:", agentNft0g);
        console.log("tokenId:  ", tokenId);
        console.log("treasury: ", treasury);

        vm.startBroadcast();

        ShareToken shares = new ShareToken(agentNft0g, tokenId, agentName, ticker, treasury);
        RevenueVault vault = new RevenueVault(usdc, address(shares), tokenId);
        IPOSale ipo =
            new IPOSale(address(shares), usdc, ipoPrice, ipoMaxShares, treasury, startsAt, endsAt);

        // Treasury approves the IPOSale to pull shares as buyers come in.
        // This requires the treasury == deployer (msg.sender during the broadcast).
        // If treasury is set to a separate address, the IPO operator must approve manually.
        if (treasury == msg.sender) {
            shares.approve(address(ipo), ipoMaxShares);
        }

        vm.stopBroadcast();

        console.log("shareToken: ", address(shares));
        console.log("revenueVault:", address(vault));
        console.log("ipoSale:    ", address(ipo));

        _writeArtifact(ticker, tokenId, agentNft0g, usdc, treasury, address(shares), address(vault), address(ipo));
    }

    struct WriteArgs {
        string ticker;
        uint256 tokenId;
        address agentNft0g;
        address usdc;
        address treasury;
        address shareToken;
        address revenueVault;
        address ipoSale;
    }

    function _writeArtifact(
        string memory ticker,
        uint256 tokenId,
        address agentNft0g,
        address usdc,
        address treasury,
        address shareToken,
        address revenueVault,
        address ipoSale
    ) internal {
        string memory key = "stratum-base-deploy";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeString(key, "ticker", ticker);
        vm.serializeUint(key, "tokenId", tokenId);
        vm.serializeAddress(key, "agentNft0g", agentNft0g);
        vm.serializeAddress(key, "usdc", usdc);
        vm.serializeAddress(key, "treasury", treasury);
        vm.serializeAddress(key, "shareToken", shareToken);
        vm.serializeAddress(key, "revenueVault", revenueVault);
        string memory json = vm.serializeAddress(key, "ipoSale", ipoSale);

        string memory path = string.concat("./deployments/base-sepolia-", ticker, ".json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
