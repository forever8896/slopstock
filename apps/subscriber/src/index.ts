/**
 * @stratum/subscriber — CLI to call Stratum agents.
 *
 * Commands:
 *
 *   stratum discover
 *     List every registered agent on 0G Galileo (AgentRegistry events).
 *
 *   stratum profile <tokenId>
 *     Fetch the operator's chain-driven /profile/:tokenId.
 *
 *   stratum infer --token <ticker|tokenId> --input <file> [--receipt-tx 0x...]
 *     Pay USDC to the agent's vault on Base Sepolia, POST to operator
 *     /x402/infer, verify the TEE measurement matches what the iNFT pins,
 *     print the audit. Pays with SUBSCRIBER_PRIVATE_KEY (or --key 0x...).
 *     Skip the pay step by passing --receipt-tx with an existing USDC transfer.
 *
 * Required env (or flags):
 *   ZG_RPC_URL                   default https://evmrpc-testnet.0g.ai
 *   BASE_RPC_URL                 default https://base-sepolia-rpc.publicnode.com
 *   STRATUM_OPERATOR_URL         default http://127.0.0.1:8402
 *   SUBSCRIBER_PRIVATE_KEY       only required for `infer` without --receipt-tx
 */

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  parseUnits,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFile } from "node:fs/promises";
import {
  ZG_GALILEO,
  USDC_BASE_SEPOLIA,
  BASE_SEPOLIA_AGENTS,
  type AgentAddresses,
} from "@stratum/shared";
import {
  agentRegistryAbi,
  stratumAgentNftAbi,
  erc20Abi,
} from "@stratum/contracts-types";

const ZG_RPC_URL = process.env["ZG_RPC_URL"] ?? "https://evmrpc-testnet.0g.ai";
const BASE_RPC_URL = process.env["BASE_RPC_URL"] ?? "https://base-sepolia-rpc.publicnode.com";
const OPERATOR_URL = process.env["STRATUM_OPERATOR_URL"] ?? "http://127.0.0.1:8402";

const zgChain = {
  id: ZG_GALILEO.chainId,
  name: "0G Galileo",
  nativeCurrency: { decimals: 18, name: "0G", symbol: "0G" },
  rpcUrls: { default: { http: [ZG_RPC_URL] } },
} as const satisfies Chain;

const baseChain = {
  id: 84_532,
  name: "Base Sepolia",
  nativeCurrency: { decimals: 18, name: "Sepolia Ether", symbol: "ETH" },
  rpcUrls: { default: { http: [BASE_RPC_URL] } },
} as const satisfies Chain;

const zgPublic: PublicClient = createPublicClient({ chain: zgChain, transport: http(ZG_RPC_URL) });
const basePublic: PublicClient = createPublicClient({ chain: baseChain, transport: http(BASE_RPC_URL) });

// ─── CLI ────────────────────────────────────────────────────────────

interface Flags {
  token?: string;
  input?: string;
  receiptTx?: Hex;
  key?: Hex;
  help?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--token":
        out.token = next;
        i++;
        break;
      case "--input":
        out.input = next;
        i++;
        break;
      case "--receipt-tx":
        out.receiptTx = next as Hex;
        i++;
        break;
      case "--key":
        out.key = next as Hex;
        i++;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
    }
  }
  return out;
}

const USAGE = `stratum — Slopstock subscriber CLI

usage:
  stratum discover
  stratum profile <tokenId>
  stratum infer --token <ticker|tokenId> --input <path> [--receipt-tx 0x...] [--key 0x...]

env:
  ZG_RPC_URL, BASE_RPC_URL, STRATUM_OPERATOR_URL, SUBSCRIBER_PRIVATE_KEY
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseFlags(rest);
  if (flags.help || !cmd) {
    console.log(USAGE);
    return;
  }

  switch (cmd) {
    case "discover":
      await discover();
      break;
    case "profile":
      if (!rest[0]) throw new Error("profile requires <tokenId>");
      await profile(rest[0]);
      break;
    case "infer":
      await infer(flags);
      break;
    default:
      console.log(USAGE);
      process.exit(2);
  }
}

// ─── discover ───────────────────────────────────────────────────────

async function discover() {
  const events = parseAbi([
    "event Registered(uint256 indexed tokenId, address shareToken, address vaultBase, bytes32 ensNameHash, address operator)",
  ]);
  // 0G public RPC tends to allow wide ranges; if it fails we'd paginate.
  const logs = await zgPublic.getLogs({
    address: ZG_GALILEO.agentRegistry,
    event: events[0],
    fromBlock: 0n,
    toBlock: "latest",
  });

  if (logs.length === 0) {
    console.log("(no agents registered)");
    return;
  }

  console.log(`tokenId  ens                            operator                                       shareToken                                     vault`);
  console.log("-------  ------------------------       ----------------------------------------       ----------------------------------------       ----------------------------------------");
  for (const log of logs) {
    const args = (log as { args?: { tokenId?: bigint; shareToken?: Hex; vaultBase?: Hex; operator?: Hex } }).args;
    if (!args?.tokenId) continue;
    const ensName = await zgPublic.readContract({
      address: ZG_GALILEO.agentNft,
      abi: stratumAgentNftAbi,
      functionName: "ensName",
      args: [args.tokenId],
    });
    console.log(
      `${pad(args.tokenId.toString(), 7)}  ${pad(ensName, 30)}  ${pad(args.operator ?? "—", 42)}  ${pad(args.shareToken ?? "—", 42)}  ${args.vaultBase ?? "—"}`,
    );
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

// ─── profile ────────────────────────────────────────────────────────

async function profile(tokenId: string) {
  const res = await fetch(`${OPERATOR_URL}/profile/${tokenId}`);
  if (!res.ok) {
    throw new Error(`operator ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}

// ─── infer ──────────────────────────────────────────────────────────

async function infer(flags: Flags) {
  if (!flags.token) throw new Error("infer requires --token <ticker|tokenId>");
  if (!flags.input) throw new Error("infer requires --input <path>");

  const agent = resolveAgent(flags.token);
  const inputContent = await readFile(flags.input, "utf-8");

  console.log(`agent: ${agent.ensName} (tokenId=${agent.tokenId})`);
  console.log(`vault: ${agent.revenueVault}`);
  console.log(`input: ${flags.input} (${inputContent.length} bytes)`);

  // 1. Get the price challenge from operator (so we know exact amount).
  const challenge = await fetchChallenge(agent.tokenId);
  console.log(`price: ${challenge.amount} ${challenge.asset} (smallest unit) → ${challenge.recipient}`);

  // 2. Resolve a payment receipt — either the user-supplied txHash, or
  //    auto-pay from SUBSCRIBER_PRIVATE_KEY.
  let txHash: Hex;
  if (flags.receiptTx) {
    txHash = flags.receiptTx;
    console.log(`using supplied --receipt-tx ${txHash}`);
  } else {
    const key = (flags.key ?? (process.env["SUBSCRIBER_PRIVATE_KEY"] as Hex | undefined));
    if (!key) {
      throw new Error("no payment txHash and SUBSCRIBER_PRIVATE_KEY not set; pass --key or --receipt-tx");
    }
    txHash = await payUsdc({
      privateKey: key,
      to: challenge.recipient,
      amount: BigInt(challenge.amount),
    });
    console.log(`paid via ${txHash}, waiting for inclusion…`);
    await basePublic.waitForTransactionReceipt({ hash: txHash });
    console.log("payment confirmed.");
  }

  // 3. Subscriber address — derived from the payment account, falling back
  //    to a sentinel for the supplied-receipt path.
  const subscriber = await deriveSubscriber(flags, txHash);

  // 4. POST /x402/infer with the receipt.
  const receiptHeader = JSON.stringify({ txHash, facilitator: "chain", receiptId: `rcpt-${crypto.randomUUID()}` });
  const res = await fetch(`${OPERATOR_URL}/x402/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PAYMENT-V1-RESPONSE": receiptHeader },
    body: JSON.stringify({ tokenId: agent.tokenId.toString(), input: inputContent, subscriber }),
  });

  if (res.status === 402) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`payment validation failed: ${(err as { error?: string }).error ?? "402"}`);
  }
  if (!res.ok) {
    throw new Error(`operator ${res.status}: ${await res.text()}`);
  }
  const body = await res.json() as {
    callId: string;
    output: string;
    receipt: { teeAttestation: { measurement: Hex; vendor: string }; signature: Hex };
  };

  // 5. Verify the TEE measurement matches what the iNFT pins on chain.
  const expected = await zgPublic.readContract({
    address: ZG_GALILEO.agentNft,
    abi: stratumAgentNftAbi,
    functionName: "expectedMeasurement",
    args: [agent.tokenId],
  });
  const measurementOk = body.receipt.teeAttestation.measurement.toLowerCase() === expected.toLowerCase();

  console.log("");
  console.log("─── audit ──────────────────────────────────────────────────");
  console.log(body.output);
  console.log("─── attestation ────────────────────────────────────────────");
  console.log(`callId:       ${body.callId}`);
  console.log(`vendor:       ${body.receipt.teeAttestation.vendor}`);
  console.log(`measurement:  ${body.receipt.teeAttestation.measurement}`);
  console.log(`expected:     ${expected}`);
  console.log(`signature:    ${body.receipt.signature.slice(0, 30)}…`);
  console.log(`tee match:    ${measurementOk ? "✓" : "✗ (TODO: chain expects keccak(teeAttestation))"}`);
}

// ─── helpers ────────────────────────────────────────────────────────

function resolveAgent(tokenOrTicker: string): AgentAddresses {
  const upper = tokenOrTicker.toUpperCase();
  if (BASE_SEPOLIA_AGENTS[upper]) return BASE_SEPOLIA_AGENTS[upper];
  // Try parsing as tokenId.
  const id = BigInt(tokenOrTicker);
  for (const a of Object.values(BASE_SEPOLIA_AGENTS)) {
    if (a.tokenId === id) return a;
  }
  throw new Error(`unknown agent: ${tokenOrTicker}`);
}

interface PaymentChallenge {
  network: "base";
  asset: "USDC";
  amount: string;
  recipient: Hex;
}

async function fetchChallenge(tokenId: bigint): Promise<PaymentChallenge> {
  // The operator's GET /profile gives us recipient + price.
  const res = await fetch(`${OPERATOR_URL}/profile/${tokenId}`);
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  const body = (await res.json()) as { vaultBase: Hex; pricing: { perCall: string } };
  return {
    network: "base",
    asset: "USDC",
    amount: body.pricing.perCall,
    recipient: body.vaultBase,
  };
}

async function payUsdc(opts: { privateKey: Hex; to: Hex; amount: bigint }): Promise<Hex> {
  const account = privateKeyToAccount(opts.privateKey);
  const wallet = createWalletClient({ account, chain: baseChain, transport: http(BASE_RPC_URL) });
  const hash = await wallet.writeContract({
    address: USDC_BASE_SEPOLIA,
    abi: erc20Abi,
    functionName: "transfer",
    args: [opts.to, opts.amount],
  });
  return hash;
}

async function deriveSubscriber(flags: Flags, _txHash: Hex): Promise<Hex> {
  const key = flags.key ?? (process.env["SUBSCRIBER_PRIVATE_KEY"] as Hex | undefined);
  if (key) return privateKeyToAccount(key).address;
  // No key — derive from the receipt's `from` field (the actual payer).
  // For demo flows this is good enough.
  const tx = await basePublic.getTransaction({ hash: _txHash });
  return tx.from;
}

main().catch((err) => {
  console.error(`[stratum/subscriber] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
