/**
 * Self-funding leg (plan 06): bridge native ETH on L1 → native OG on 0G mainnet
 * via LI.FI (gasZipBridge route), into the operator wallet so it can top up the
 * 0G compute ledger. Sends a REAL L1 transaction.
 *
 *   bash -c 'set -a && . ./.env && set +a && bun run apps/operator/scripts/bridge-lifi-to-0g.ts [ethAmount=0.002]'
 */

import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const L1_RPC = "https://ethereum-rpc.publicnode.com";
const OG_RPC = "https://evmrpc.0g.ai";
const NATIVE = "0x0000000000000000000000000000000000000000";
const AMOUNT = process.argv[2] ?? "0.002";

const zgMainnet = {
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: { default: { http: [OG_RPC] } },
} as const;

const key = process.env["OPERATOR_PRIVATE_KEY"] as Hex;
if (!key) { console.error("OPERATOR_PRIVATE_KEY not set"); process.exit(1); }
const account = privateKeyToAccount(key);

const l1 = createPublicClient({ chain: mainnet, transport: http(L1_RPC) });
const l1Wallet = createWalletClient({ account, chain: mainnet, transport: http(L1_RPC) });
const og = createPublicClient({ chain: zgMainnet, transport: http(OG_RPC) });

const fromAmount = parseEther(AMOUNT);
const ethBefore = await l1.getBalance({ address: account.address });
const ogBefore = await og.getBalance({ address: account.address });
console.log(`account ${account.address}`);
console.log(`L1 ETH before: ${formatEther(ethBefore)} | 0G OG before: ${formatEther(ogBefore)}`);
if (ethBefore < fromAmount) { console.error(`insufficient L1 ETH (have ${formatEther(ethBefore)}, need ${AMOUNT}+gas)`); process.exit(1); }

// fresh quote (quotes expire)
const url = new URL("https://li.quest/v1/quote");
url.searchParams.set("fromChain", "1");
url.searchParams.set("toChain", "16661");
url.searchParams.set("fromToken", NATIVE);
url.searchParams.set("toToken", NATIVE);
url.searchParams.set("fromAmount", fromAmount.toString());
url.searchParams.set("fromAddress", account.address);
const res = await fetch(url);
if (!res.ok) { console.error(`LI.FI ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const q = (await res.json()) as any;
const tr = q.transactionRequest;
console.log(`route: ${q.tool ?? q.toolDetails?.name} | expect ~${formatEther(BigInt(q.estimate.toAmount))} OG (min ${formatEther(BigInt(q.estimate.toAmountMin))})`);
console.log(`router ${tr.to} | value ${formatEther(BigInt(tr.value))} ETH`);

const hash = await l1Wallet.sendTransaction({
  to: tr.to as Hex,
  data: tr.data as Hex,
  value: BigInt(tr.value),
  ...(tr.gasLimit ? { gas: BigInt(tr.gasLimit) } : {}),
});
console.log(`\n[bridge] L1 tx sent: ${hash}`);
const rcpt = await l1.waitForTransactionReceipt({ hash });
console.log(`[bridge] L1 confirmed in block ${rcpt.blockNumber} (status ${rcpt.status})`);

console.log(`[bridge] polling 0G mainnet for OG arrival (gas.zip, ~secs–mins)…`);
let ogAfter = ogBefore;
for (let i = 0; i < 60 && ogAfter <= ogBefore; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  ogAfter = await og.getBalance({ address: account.address });
  if (i % 4 === 0) console.log(`  …${(i + 1) * 5}s  0G OG = ${formatEther(ogAfter)}`);
}
const delta = ogAfter - ogBefore;
console.log(`\n[bridge] 0G OG after: ${formatEther(ogAfter)}  (delta +${formatEther(delta)} OG)`);
console.log(delta > 0n ? "✅ BRIDGE COMPLETE — OG landed on 0G mainnet" : "⚠️ not yet arrived — re-check balance shortly (gas.zip can lag)");
