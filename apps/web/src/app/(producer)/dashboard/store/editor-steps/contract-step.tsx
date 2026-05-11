// contract-step.tsx
//
// Stage 4 of the producer Store wizard — optional contract URL.
//
// Phase 2 only supports the URL mode (paste a public link to a hosted PDF).
// The prototype's file-upload + inline-text modes are deferred to Phase 4.
// The schema column `products.contractUrl` is a nullable text URL, so this
// step writes a single string and leaves an empty string when skipped.

"use client";

interface ContractStepProps {
  contractUrl: string;
  onChange: (next: string) => void;
}

export function ContractStep({ contractUrl, onChange }: ContractStepProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Optional intro card — dashed amber border, subtle bg */}
      <div className="flex items-start gap-3 rounded-[12px] border border-dashed border-[rgb(var(--brand-primary)/0.45)] bg-[rgb(var(--brand-primary)/0.06)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[rgb(var(--fg-default))]">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary-dark))] font-display text-[11px] font-bold leading-none text-white"
        >
          i
        </span>
        <div>
          Adding a contract is optional. Artists who sign one are{" "}
          <strong className="font-semibold text-[rgb(var(--fg-default))]">
            3× more likely
          </strong>{" "}
          to complete their booking. Skip anytime.
        </div>
      </div>

      {/* URL input */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="contract-step-url"
          className="font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
        >
          Contract PDF URL
        </label>
        <input
          id="contract-step-url"
          type="url"
          inputMode="url"
          value={contractUrl}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder="https://drive.google.com/... or https://dropbox.com/..."
          aria-label="Contract PDF URL"
          className="rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-[13px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
        />
        <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
          Paste a public link to your contract PDF, hosted on Drive, Dropbox, or your own site.
        </div>
      </div>

      {/* Deferred-modes note */}
      <div className="text-[11px] italic leading-snug text-[rgb(var(--fg-faint))]">
        File upload and inline-text terms are coming soon.
      </div>
    </div>
  );
}
