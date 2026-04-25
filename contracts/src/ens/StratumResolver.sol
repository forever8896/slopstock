// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev ENSIP-10 extended resolver — clients may invoke any subselector through
///      the unified `resolve(name, data)` surface.
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

/// @title StratumResolver
/// @notice ENS CCIP-Read (EIP-3668) resolver for `*.stratum.eth`.
/// @dev Lives on Sepolia / L1 mainnet. Resolution is delegated to an off-chain
///      gateway worker which signs each response with `gatewaySigner`. The client
///      side of EIP-3668:
///        1. calls `resolve(name, data)` — reverts with `OffchainLookup`,
///        2. POSTs `callData` to one of the gateway URLs,
///        3. calls `resolveWithProof(response, extraData)` to verify + unwrap.
///
///      The gateway response is `abi.encode(bytes result, uint64 expires, bytes sig)`,
///      where `sig` is an ECDSA signature over
///      `keccak256(extraData || result || expires)` produced with `gatewaySigner`'s
///      key. We use the raw digest (no EIP-191 prefix); the gateway's signing path
///      must match.
contract StratumResolver is IExtendedResolver, Ownable {
    using ECDSA for bytes32;

    /// @dev EIP-3668 control-flow primitive: clients catch this revert, fetch from
    ///      `urls`, and re-call `callbackFunction` on `sender` with the response.
    error OffchainLookup(
        address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData
    );

    error InvalidSignature();
    error ResponseExpired();
    error EmptyGatewayUrl();

    string public gatewayUrl;
    address public gatewaySigner;

    event GatewayUrlUpdated(string newUrl);
    event GatewaySignerUpdated(address indexed newSigner);

    constructor(string memory _gatewayUrl, address _gatewaySigner, address _owner) Ownable(_owner) {
        if (bytes(_gatewayUrl).length == 0) revert EmptyGatewayUrl();
        gatewayUrl = _gatewayUrl;
        gatewaySigner = _gatewaySigner;
    }

    function setGatewayUrl(string calldata newUrl) external onlyOwner {
        if (bytes(newUrl).length == 0) revert EmptyGatewayUrl();
        gatewayUrl = newUrl;
        emit GatewayUrlUpdated(newUrl);
    }

    function setGatewaySigner(address newSigner) external onlyOwner {
        gatewaySigner = newSigner;
        emit GatewaySignerUpdated(newSigner);
    }

    /// @inheritdoc IExtendedResolver
    /// @dev Always reverts with `OffchainLookup`. Marked `view` per ENSIP-10 so
    ///      clients can call it through `eth_call`.
    function resolve(bytes calldata name, bytes calldata data) external view override returns (bytes memory) {
        string[] memory urls = new string[](1);
        urls[0] = gatewayUrl;

        // The gateway is invoked with the same selector (`resolve`) so a single
        // POST handler works for every record type.
        bytes memory callData = abi.encodeWithSelector(IExtendedResolver.resolve.selector, name, data);

        revert OffchainLookup(
            address(this), urls, callData, this.resolveWithProof.selector, abi.encode(name, data)
        );
    }

    /// @notice Verifies the gateway-signed response and returns the result bytes.
    /// @dev `response` is `abi.encode(bytes result, uint64 expires, bytes sig)`.
    ///      The signed digest binds `extraData` (the original `(name, data)` pair)
    ///      so a leaked signature can't be replayed against a different query.
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(response, (bytes, uint64, bytes));

        if (block.timestamp >= expires) revert ResponseExpired();

        bytes32 digest = keccak256(abi.encodePacked(extraData, result, expires));
        address recovered = ECDSA.recover(digest, sig);
        if (recovered != gatewaySigner) revert InvalidSignature();

        return result;
    }
}
