import type { InferenceReceipt } from "@stratum/shared";
import { shortAddr } from "@/lib/format";
import { verifyReceipt } from "@/lib/attestation";

const RUNTIME_LABEL: Record<string, string> = {
  "openai-compat": "OpenAI-compatible (single-shot)",
  hermes: "Hermes-pattern (stateful)",
};

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
  const stateMoved = receipt.bundleHashBefore !== receipt.bundleHashAfter;

  return (
    <div className="border border-accent-green bg-bg-elev p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-accent-green">
        <span>✓ TEE attestation verified</span>
        <span className="text-text-muted">
          ({receipt.teeAttestation.vendor}, measurement{" "}
          {shortAddr(receipt.teeAttestation.measurement, 6)})
        </span>
      </div>

      <div className="grid grid-cols-1 gap-y-1 text-xs sm:grid-cols-3 sm:gap-x-4">
        <Field label="agent runtime" value={runtimeLabel} />
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
      </div>

      <div className="text-xs text-text-muted">
        Verification level:{" "}
        <span className="text-text-primary">shape + on-chain measurement match</span>. Full Intel TDX
        quote signature check requires a vendor-cert verifier in-browser — pending.
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label text-text-muted">{label}</div>
      <div className="font-mono text-text-primary">{value}</div>
    </div>
  );
}
