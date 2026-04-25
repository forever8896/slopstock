// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StratumResolver
/// @notice ENS CCIP-Read (EIP-3668) resolver for `*.stratum.eth`.
/// @dev Stub. Lives on Sepolia. Delegates resolution to the off-chain gateway worker
///      and verifies a signature on the response. Spec: docs/05-ens-identity.md §3.1.
contract StratumResolver {
    error OffchainLookup(
        address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData
    );

    string public gatewayURL;
    address public gatewaySigner;

    constructor(string memory _url, address _signer) {
        gatewayURL = _url;
        gatewaySigner = _signer;
    }

    // TODO: resolve(name, data) — revert with OffchainLookup; client fetches from gatewayURL.
    // TODO: resolveWithProof(response, extraData) — verify signature; return result.
    // TODO: setGatewayURL/setGatewaySigner — only owner (admin-bounded for v1).
}
