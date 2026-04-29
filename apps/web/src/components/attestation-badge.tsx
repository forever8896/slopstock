import type { InferenceReceipt } from "@stratum/shared";
import { shortAddr } from "@/lib/format";
import { verifyReceipt } from "@/lib/attestation";

const RUNTIME_LABEL: Record<string, string> = {
  "openai-compat": "OpenAI-compatible (single-shot)",
  hermes: "Hermes-pattern (stateful)",
};

const BACKEND_LABEL: Record<string, string> = {
  "openai-compat": "OpenAI-compatible HTTP",
  "0g-compute": "0G Compute Sealed Executor",
};

interface ZGAttestation {
  kind: "0g-tee";
  provider: `0x${string}`;
  chatId: string;
  isValid: boolean;
}

function tryDecodeZGAttestation(quoteB64: string): ZGAttestation | null {
  try {
    const decoded = atob(quoteB64);
    const parsed = JSON.parse(decoded) as { kind?: string };
    if (parsed.kind === "0g-tee") return parsed as ZGAttestation;
  } catch {
    /* not 0G */
  }
  return null;
}

export function AttestationBadge({
  receipt,
  expectedMeasurement,
}: {
  receipt: InferenceReceipt | undefined;
  expectedMeasurement: `0x${string}`;
}) {
  const result = verifyReceipt(receipt, expectedMeasurement);

  if (result.kind !== "verified" || !receipt) {
    return (
      <div className="border border-accent-red bg-bg-elev px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-accent-red">
          <span>⚠ This output is unattested — do not trust.</span>
        </div>
        <div className="mt-1 text-xs text-text-muted">
          Reason: {result.kind === "rejected" ? result.reason : "no receipt"}
        </div>
      </div>
    );
  }

  const runtimeLabel = RUNTIME_LABEL[receipt.agentRuntime] ?? receipt.agentRuntime;
  const backendLabel = BACKEND_LABEL[receipt.computeBackend] ?? receipt.computeBackend;
  const stateMoved = receipt.bundleHashBefore !== receipt.bundleHashAfter;
  const zg = tryDecodeZGAttestation(receipt.teeAttestation.quote);

  // Border + headline color depends on the strongest attestation we can show.
  const isSealed = receipt.computeBackend === "0g-compute";
  const sealedVerified = isSealed && zg?.isValid === true;
  const borderClass = sealedVerified
    ? "border-accent-green border-2"
    : isSealed
    ? "border-yellow-400"
    : "border-accent-green";

  return (
    <div className={`border ${borderClass} bg-bg-elev p-4 space-y-3`}>
      <div className="flex items-center gap-2 text-sm">
        {sealedVerified ? (
          <span className="text-accent-green font-semibold">
            ✓✓ Sealed inference verified inside 0G Compute TEE
          </span>
        ) : isSealed ? (
          <span className="text-yellow-400 font-semibold">
            ◐ Ran on 0G Compute TEE — TeeML signature not yet retrievable from provider edge
          </span>
        ) : (
          <span className="text-accent-green">
            ✓ TEE attestation chain-pinned (placeholder until 0G Compute integration)
          </span>
        )}
        <span className="text-text-muted">
          ({receipt.teeAttestation.vendor}, measurement{" "}
          {shortAddr(receipt.teeAttestation.measurement, 6)})
        </span>
      </div>

      <div className="grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-3 sm:gap-x-4">
        <Field label="agent runtime" value={runtimeLabel} />
        <Field label="compute backend" value={backendLabel} />
        <Field label="model" value={receipt.model} />
      </div>

      <div className="grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-3 sm:gap-x-4">
        <Field
          label="bundle"
          value={
            stateMoved
              ? `${shortAddr(receipt.bundleHashBefore, 4)} → ${shortAddr(receipt.bundleHashAfter, 4)}`
              : `${shortAddr(receipt.bundleHashBefore, 6)} (no change)`
          }
        />
        <Field
          label="skills"
          value={
            receipt.skillsLoaded.length === 0 && receipt.skillsCreated.length === 0
              ? "—"
              : `${receipt.skillsLoaded.length} loaded · ${receipt.skillsCreated.length} created`
          }
        />
        {zg ? (
          <Field
            label="0G provider"
            value={shortAddr(zg.provider, 6)}
            hint={`chatId ${zg.chatId.slice(0, 14)}…`}
          />
        ) : (
          <Field label="provenance" value="placeholder" />
        )}
      </div>

      <div className="text-xs text-text-muted">
        {sealedVerified ? (
          <>
            Verification level:{" "}
            <span className="text-accent-green">
              shape + chain-pinned measurement + TeeML provider signature
            </span>
            . The response was produced inside an Intel TDX enclave registered with 0G
            Compute Network and the provider's signature on this chatId was checked
            against their on-chain signing address.
          </>
        ) : isSealed ? (
          <>
            The chat completion was returned by a TeeML-verified 0G Compute provider, but
            the broker couldn't fetch the provider's signature for this chatId — the
            receipt records the result honestly. Re-run the broker's{" "}
            <code className="text-text-primary">processResponse(provider, chatId)</code>{" "}
            when the provider's signing edge is up to upgrade this badge to the green
            two-check state.
          </>
        ) : (
          <>
            Verification level:{" "}
            <span className="text-text-primary">shape + on-chain measurement match</span>
            . Sealed-inference attestation lands when this agent's compute backend is
            switched to <code className="text-text-primary">0g-compute</code>.
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="label text-text-muted">{label}</div>
      <div className="font-mono text-text-primary">{value}</div>
      {hint ? <div className="text-text-muted text-[10px] mt-0.5">{hint}</div> : null}
    </div>
  );
}
