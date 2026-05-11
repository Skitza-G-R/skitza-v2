// contract-step.tsx
//
// Stage 5 of the producer Store wizard — optional agreement.
//
// Three modes:
//   * "file" — drop zone for a PDF (or click to browse). Phase 2 has no
//     upload pipeline yet, so the panel falls back to a plain URL input
//     and a "File upload coming soon" hint. The URL still writes to
//     products.contractUrl on save.
//   * "link" — paste a public URL to a contract PDF. Writes to
//     products.contractUrl.
//   * "text" — type inline terms. Writes to the encoded description
//     meta block (see description-encoding.ts) because the schema has
//     no dedicated column for inline contract text yet.
//
// canContinue stays true for all three modes — the step is skippable.

"use client";

import { FileText, Link as LinkIcon, Upload } from "lucide-react";

export type ContractMode = "file" | "link" | "text";

interface ContractStepProps {
  mode: ContractMode;
  contractUrl: string;
  contractText: string;
  onChange: (
    patch: Partial<{ mode: ContractMode; contractUrl: string; contractText: string }>,
  ) => void;
}

interface ModeOption {
  id: ContractMode;
  label: string;
  icon: typeof Upload;
}

const MODE_OPTIONS: ModeOption[] = [
  { id: "file", label: "File", icon: Upload },
  { id: "link", label: "Link", icon: LinkIcon },
  { id: "text", label: "Text", icon: FileText },
];

export function ContractStep({
  mode,
  contractUrl,
  contractText,
  onChange,
}: ContractStepProps) {
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

      {/* Mode tabs */}
      <div
        role="radiogroup"
        aria-label="Contract mode"
        className="grid grid-cols-3 gap-2"
      >
        {MODE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const picked = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={picked}
              onClick={() => {
                onChange({ mode: opt.id });
              }}
              className={[
                "sk-press inline-flex h-[44px] items-center justify-center gap-2 rounded-[10px] border text-[12.5px] font-semibold transition-colors",
                picked
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary-dark))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]",
              ].join(" ")}
            >
              <Icon size={14} strokeWidth={2.2} aria-hidden />
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {/* File mode panel */}
      {mode === "file" ? (
        <div className="flex flex-col gap-3">
          <div
            className="flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-background))] px-4 py-5 text-center"
            aria-label="Contract file dropzone"
          >
            <Upload
              size={20}
              strokeWidth={2.1}
              aria-hidden
              className="text-[rgb(var(--fg-muted))]"
            />
            <div className="text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
              Drop your PDF here, or click to browse
            </div>
          </div>
          <div className="text-[11.5px] italic leading-snug text-[rgb(var(--fg-faint))]">
            File upload coming soon. For now, paste a public link to your file below.
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="contract-step-file-url"
              className="font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
            >
              Public file URL
            </label>
            <input
              id="contract-step-file-url"
              type="url"
              inputMode="url"
              value={contractUrl}
              onChange={(e) => {
                onChange({ contractUrl: e.target.value });
              }}
              placeholder="https://drive.google.com/... or https://dropbox.com/..."
              aria-label="Contract PDF URL"
              className="rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-[13px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
            />
          </div>
        </div>
      ) : null}

      {/* Link mode panel */}
      {mode === "link" ? (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="contract-step-link-url"
            className="font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
          >
            Contract PDF URL
          </label>
          <input
            id="contract-step-link-url"
            type="url"
            inputMode="url"
            value={contractUrl}
            onChange={(e) => {
              onChange({ contractUrl: e.target.value });
            }}
            placeholder="https://drive.google.com/... or https://dropbox.com/..."
            aria-label="Contract PDF URL"
            className="rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-[13px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
          />
          <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
            Paste a public link to your contract PDF, hosted on Drive, Dropbox, or your own site.
          </div>
        </div>
      ) : null}

      {/* Text mode panel */}
      {mode === "text" ? (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="contract-step-text"
            className="font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
          >
            Contract terms
          </label>
          <textarea
            id="contract-step-text"
            rows={8}
            value={contractText}
            onChange={(e) => {
              onChange({ contractText: e.target.value });
            }}
            placeholder="Write your terms here..."
            aria-label="Contract terms"
            className="rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-[13px] leading-relaxed text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
          />
          <div className="flex items-center justify-between">
            <div className="text-[11.5px] text-[rgb(var(--fg-faint))]">
              Write your terms here. Artists see this text inline before they book.
            </div>
            <div className="text-[11px] tabular-nums text-[rgb(var(--fg-faint))]">
              {contractText.length} characters
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
