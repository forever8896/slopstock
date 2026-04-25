import type { InferenceReceipt } from "@stratum/shared";
import { shortAddr } from "@/lib/format";
import { verifyReceipt } from "@/lib/attestation";

export function AttestationBadge({
  receipt,
  expectedMeasurement,
}: {
  receipt: InferenceReceipt | undefined;
  expectedMeasurement: `0x${string}`;
}) {
  const result = verifyReceipt(receipt, expectedMeasurement);

  if (result.kind === "verified") {
    return (
      <div className="border border-accent-green bg-bg-elev px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-accent-green">
          <span>✓ TEE attestation verified</span>
          <span className="text-text-muted">
            ({receipt?.teeAttestation.vendor}, measurement {shortAddr(receipt?.teeAttestation.measurement ?? "0x", 6)})
          </span>
        </div>
        <div className="mt-1 text-xs text-text-muted">
          Verification level:{" "}
          <span className="text-text-primary">shape + on-chain measurement match</span>. Full Intel TDX
          quote signature check requires a vendor-cert verifier in-browser — pending.
        </div>
      </div>
    );
  }

  return (
    <div className="border border-accent-red bg-bg-elev px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-accent-red">
        <span>⚠ This output is unattested — do not trust.</span>
      </div>
      <div className="mt-1 text-xs text-text-muted">Reason: {result.reason}</div>
    </div>
  );
}
