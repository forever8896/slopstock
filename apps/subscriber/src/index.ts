/**
 * @stratum/subscriber — CLI to call Stratum agents.
 *
 * Spec: docs/06-axl-delivery.md §6.
 *
 * Usage:
 *   stratum infer auditor.stratum.eth --input ./Vault.sol --pay-with PEPE
 *
 * Resolves the agent via ENS, looks up MCP+AXL endpoint, pays via Uniswap
 * `pay-with-any-token` if needed, and invokes inference. Verifies the TEE
 * attestation locally before printing.
 */

async function main() {
  const [, , cmd] = process.argv;
  switch (cmd) {
    case "infer":
      // TODO: parse --input, --pay-with; resolve ENS; pay; call MCP; verify
      console.log("[stratum/subscriber] infer not yet implemented");
      break;
    case "discover":
      // TODO: query ENSIP-25 registry; print agents + prices
      console.log("[stratum/subscriber] discover not yet implemented");
      break;
    default:
      console.log("usage: stratum <infer|discover> [args]");
  }
}

main().catch((err) => {
  console.error("[stratum/subscriber] fatal:", err);
  process.exit(1);
});
