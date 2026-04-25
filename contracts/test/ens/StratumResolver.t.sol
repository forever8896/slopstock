// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StratumResolver, IExtendedResolver } from "../../src/ens/StratumResolver.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract StratumResolverTest is Test {
    StratumResolver internal resolver;

    uint256 internal constant SIGNER_PK = 0xA11CE;
    address internal signer;
    address internal owner = address(0x07E);
    address internal stranger = address(0xBAD);
    string internal constant GATEWAY = "https://gateway.stratum.app/api/ens/resolve";

    function setUp() public {
        vm.warp(1_000_000);
        signer = vm.addr(SIGNER_PK);
        resolver = new StratumResolver(GATEWAY, signer, owner);
    }

    /// @dev Re-build a gateway-signed response payload over the given query.
    function _signResponse(bytes memory result, uint64 expires, bytes memory extraData, uint256 pk)
        internal
        pure
        returns (bytes memory response)
    {
        bytes32 digest = keccak256(abi.encodePacked(extraData, result, expires));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        response = abi.encode(result, expires, sig);
    }

    // ─── Constructor / config ──────────────────────────────────────────────

    function test_DeploySetsFields() public view {
        assertEq(resolver.gatewayUrl(), GATEWAY);
        assertEq(resolver.gatewaySigner(), signer);
        assertEq(resolver.owner(), owner);
    }

    function test_DeployRevertsOnEmptyUrl() public {
        vm.expectRevert(StratumResolver.EmptyGatewayUrl.selector);
        new StratumResolver("", signer, owner);
    }

    function test_SetGatewayUrl_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        resolver.setGatewayUrl("https://other.example/");
    }

    function test_SetGatewayUrl_EmitsAndUpdates() public {
        vm.prank(owner);
        resolver.setGatewayUrl("https://other.example/");
        assertEq(resolver.gatewayUrl(), "https://other.example/");
    }

    function test_SetGatewaySigner_OnlyOwner() public {
        address fresh = vm.addr(0xBEE7);
        vm.prank(owner);
        resolver.setGatewaySigner(fresh);
        assertEq(resolver.gatewaySigner(), fresh);
    }

    // ─── resolve() — always reverts with OffchainLookup ────────────────────

    function test_ResolveRevertsWithOffchainLookup() public {
        bytes memory name = bytes("\x07auditor\x07stratum\x03eth\x00");
        bytes memory data = hex"3b3b57de00000000000000000000000000000000000000000000000000000000deadbeef";

        bytes memory expectedCallData = abi.encodeWithSelector(IExtendedResolver.resolve.selector, name, data);
        bytes memory expectedExtraData = abi.encode(name, data);

        // Build expected revert data and assert.
        string[] memory urls = new string[](1);
        urls[0] = GATEWAY;
        bytes memory expectedRevert = abi.encodeWithSelector(
            StratumResolver.OffchainLookup.selector,
            address(resolver),
            urls,
            expectedCallData,
            resolver.resolveWithProof.selector,
            expectedExtraData
        );
        vm.expectRevert(expectedRevert);
        resolver.resolve(name, data);
    }

    // ─── resolveWithProof() — happy + sad paths ────────────────────────────

    function test_ResolveWithProof_ValidSignatureReturnsResult() public view {
        bytes memory name = bytes("\x07auditor\x07stratum\x03eth\x00");
        bytes memory data = hex"3b3b57de";
        bytes memory extraData = abi.encode(name, data);
        bytes memory result = abi.encode(address(0xBEEF));
        uint64 expires = uint64(block.timestamp + 1 hours);

        bytes memory response = _signResponse(result, expires, extraData, SIGNER_PK);
        bytes memory got = resolver.resolveWithProof(response, extraData);
        assertEq(got, result);
    }

    function test_ResolveWithProof_ExpiredResponseReverts() public {
        bytes memory extraData = abi.encode("anything");
        bytes memory result = abi.encode(address(0xBEEF));
        uint64 expires = uint64(block.timestamp + 10);

        bytes memory response = _signResponse(result, expires, extraData, SIGNER_PK);

        vm.warp(block.timestamp + 11);
        vm.expectRevert(StratumResolver.ResponseExpired.selector);
        resolver.resolveWithProof(response, extraData);
    }

    function test_ResolveWithProof_WrongSignerReverts() public {
        bytes memory extraData = abi.encode("anything");
        bytes memory result = abi.encode(address(0xBEEF));
        uint64 expires = uint64(block.timestamp + 1 hours);

        // Sign with a *different* key than the configured gatewaySigner.
        bytes memory response = _signResponse(result, expires, extraData, 0xBADBAD);

        vm.expectRevert(StratumResolver.InvalidSignature.selector);
        resolver.resolveWithProof(response, extraData);
    }

    function test_ResolveWithProof_TamperedExtraDataReverts() public {
        bytes memory originalExtra = abi.encode("query-A");
        bytes memory result = abi.encode(address(0xBEEF));
        uint64 expires = uint64(block.timestamp + 1 hours);

        bytes memory response = _signResponse(result, expires, originalExtra, SIGNER_PK);

        // Replay against a different query — digest changes, signature recovers a
        // different address, recovered != signer → revert.
        bytes memory tamperedExtra = abi.encode("query-B");
        vm.expectRevert(StratumResolver.InvalidSignature.selector);
        resolver.resolveWithProof(response, tamperedExtra);
    }

    function test_ResolveWithProof_AfterSignerRotation() public {
        bytes memory extraData = abi.encode("anything");
        bytes memory result = abi.encode(address(0xBEEF));
        uint64 expires = uint64(block.timestamp + 1 hours);

        // Old signer's response no longer validates after rotation.
        bytes memory response = _signResponse(result, expires, extraData, SIGNER_PK);

        uint256 newPk = 0xC0FFEE;
        vm.prank(owner);
        resolver.setGatewaySigner(vm.addr(newPk));

        vm.expectRevert(StratumResolver.InvalidSignature.selector);
        resolver.resolveWithProof(response, extraData);

        // New signer's response works.
        bytes memory freshResponse = _signResponse(result, expires, extraData, newPk);
        bytes memory got = resolver.resolveWithProof(freshResponse, extraData);
        assertEq(got, result);
    }
}
