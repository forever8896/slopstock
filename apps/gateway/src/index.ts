/**
 * @stratum/gateway — ENS CCIP-Read gateway worker.
 *
 * Spec: docs/05-ens-identity.md §3.2.
 *
 * Receives offchain ENS lookups for *.stratum.eth, computes the answer
 * (possibly time/caller-dependent for rotating addresses), signs it with
 * gatewaySigner, and returns. The on-chain StratumResolver verifies the sig.
 */

export interface Env {
  GATEWAY_SIGNER_KEY: string;     // hex private key (Worker secret)
  AGENT_REGISTRY_URL: string;     // indexer URL for ENSIP-25 records
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    // TODO: parse { name, data } payload (ABI-decoded from CCIP-Read client)
    // TODO: branch on selector: addr(bytes32), text(bytes32, string), ...
    // TODO: handle rotating treasury — derive next HD address per-call
    // TODO: handle subscriber subnames — gate on on-chain authorizeUsage
    // TODO: sign keccak256(extraData || result || expires) with gatewaySigner
    // TODO: return { result, expires, sig } ABI-encoded
    return new Response("not implemented", { status: 501 });
  },
};
