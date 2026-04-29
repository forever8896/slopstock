// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

interface IWETH9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function mint(address to, uint256 amount) external; // TestnetUSDC has this
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/// @notice Bootstrap a Uniswap V3 WETH/TestnetUSDC pool on Base Sepolia and
///         mint a wide-range LP position. After this script:
///           - pool exists at fee tier 0.3% (3000)
///           - sqrtPriceX96 set so 1 WETH ≈ 2500 USDC
///           - position spans -201060 ↔ -195060 (~±35% around current price)
///         Subscribers paying with ETH route through this pool via SwapRouter02.
contract SetupUniswapPool is Script {
    address constant NPM = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0xd44e0C3a9Fa12E5c00C1714b51F4d8607962e603; // TestnetUSDC

    // sqrtPriceX96 for 1 WETH = 2500 USDC (token0=WETH, token1=USDC).
    uint160 constant SQRT_PRICE_X96 = 3961408125713217069514752;
    uint24 constant FEE = 3000;
    int24 constant TICK_LOWER = -201060;
    int24 constant TICK_UPPER = -195060;

    function run() external {
        uint256 ethAmount = 0.02 ether;
        uint256 usdcAmount = 50_000_000; // 50 USDC (6 decimals)

        vm.startBroadcast();

        // 1. Wrap some ETH into WETH so the position can hold both sides.
        IWETH9(WETH).deposit{value: ethAmount}();
        console.log("WETH balance:", IWETH9(WETH).balanceOf(msg.sender));

        // 2. Mint TestnetUSDC into deployer (permissionless on this contract).
        IERC20(USDC).mint(msg.sender, usdcAmount);
        console.log("USDC balance:", IERC20(USDC).balanceOf(msg.sender));

        // 3. Create + initialize pool. Idempotent: if pool exists at given fee
        //    and an existing sqrtPriceX96, this just returns the pool.
        address pool = INonfungiblePositionManager(NPM).createAndInitializePoolIfNecessary(
            WETH < USDC ? WETH : USDC,
            WETH < USDC ? USDC : WETH,
            FEE,
            SQRT_PRICE_X96
        );
        console.log("pool:", pool);

        // 4. Approve NPM to pull both tokens.
        IWETH9(WETH).approve(NPM, ethAmount);
        IERC20(USDC).approve(NPM, usdcAmount);

        // 5. Mint the position. Token order matters — token0 is the lower address.
        bool wethIsToken0 = WETH < USDC;
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: wethIsToken0 ? WETH : USDC,
            token1: wethIsToken0 ? USDC : WETH,
            fee: FEE,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: wethIsToken0 ? ethAmount : usdcAmount,
            amount1Desired: wethIsToken0 ? usdcAmount : ethAmount,
            amount0Min: 0,
            amount1Min: 0,
            recipient: msg.sender,
            deadline: block.timestamp + 600
        });
        (uint256 tokenId, uint128 liquidity, uint256 a0, uint256 a1) =
            INonfungiblePositionManager(NPM).mint(params);
        console.log("LP tokenId:", tokenId);
        console.log("liquidity:", liquidity);
        console.log("amount0 used:", a0);
        console.log("amount1 used:", a1);

        vm.stopBroadcast();
    }
}
