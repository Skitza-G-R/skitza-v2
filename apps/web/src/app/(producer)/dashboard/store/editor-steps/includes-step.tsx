// includes-step.tsx
//
// Stage 2 of the producer Store wizard — product name + inclusions builder.
// Ported from the prototype `storefront.html` (IncludesStep, line 904).
//
// Layout: product Name input (autofocus), then a "What's included" section
// with an amber-tinted dashed dropzone for selected chips, then a
// "Suggested for <preset>" pill list of preset extras NOT yet selected,
// then an "Add your own" text input + Add button. When `pickedId` is null
// (edit mode — no preset picker), the suggested list collapses (no preset
// to draw from); the selected chips remain freely editable.

"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { PresetId } from "../type-presets";
import { TYPE_PRESETS } from "../type-presets";

interface IncludesStepProps {
  pickedId: PresetId | null;
  name: string;
  onNameChange: (next: string) => void;
  includes: string[];
  onIncludesChange: (next: string[]) => void;
}

export function IncludesStep({
  pickedId,
  name,
  onNameChange,
  includes,
  onIncludesChange,
}: IncludesStepProps) {
  const [custom, setCustom] = useState("");
  const picked = pickedId ? TYPE_PRESETS.find((p) => p.id === pickedId) : undefined;
  const baseline = picked?.baseline ?? [];
  const extras = picked?.extras ?? [];

  // All preset-driven options (baseline + extras), then filter out already-
  // selected ones to build the suggested list. In edit mode (no preset)
  // this is empty.
  const allOptions: { label: string }[] = [
    ...baseline.map((b) => ({ label: b })),
    ...extras.map((e) => ({ label: e.label })),
  ];
  const available = allOptions.filter((o) => !includes.includes(o.label));

  const remove = (label: string) => {
    onIncludesChange(includes.filter((x) => x !== label));
  };
  const add = (label: string) => {
    if (!label || includes.includes(label)) return;
    onIncludesChange([...includes, label]);
  };
  const addCustom = () => {
    const trimmed = custom.trim();
    if (!trimmed) return;
    add(trimmed);
    setCustom("");
  };

  const trimmedCustom = custom.trim();

  return (
    <div className="flex flex-col gap-5">
      {/* Product name */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="includes-step-name"
          className="font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
        >
          Product name <span className="text-[rgb(var(--brand-primary))]">*</span>
        </label>
        <input
          id="includes-step-name"
          type="text"
          autoFocus
          required
          value={name}
          onChange={(e) => {
            onNameChange(e.target.value);
          }}
          placeholder={picked?.defaultName || "Name your product"}
          className="h-10 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
        />
      </div>

      {/* What's included — dropzone */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
            What&apos;s included
          </span>
          <span className="text-[10.5px] text-[rgb(var(--fg-faint))]">
            {includes.length} selected
          </span>
        </div>
        <div
          className="flex min-h-[56px] flex-wrap content-start gap-2 rounded-[12px] border border-dashed border-[rgb(var(--brand-primary)/0.30)] bg-[rgb(var(--brand-primary)/0.06)] p-3"
        >
          {includes.length === 0 ? (
            <div className="px-1 py-2 text-[12.5px] italic text-[rgb(var(--fg-faint))]">
              Pick items below to add them →
            </div>
          ) : (
            includes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  remove(s);
                }}
                aria-label={`Remove ${s}`}
                className="group inline-flex h-[30px] items-center gap-2 rounded-full border border-[rgb(var(--border-subtle))] bg-white pl-3 pr-1.5 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgba(17,16,9,0.04)] transition-colors hover:border-[rgb(var(--danger,220_56_56))] hover:bg-red-50"
              >
                <span>{s}</span>
                <span
                  aria-hidden
                  className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-default))] text-white"
                >
                  <X size={10} strokeWidth={2.5} />
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Suggested extras */}
      {picked && available.length > 0 ? (
        <div>
          <div className="mb-2.5 font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
            Suggested for {picked.label}
          </div>
          <div className="flex flex-wrap gap-2">
            {available.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  add(ex.label);
                }}
                className="inline-flex h-[30px] items-center gap-2 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] pl-2 pr-3.5 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.08)]"
              >
                <span
                  aria-hidden
                  className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-white"
                >
                  <Plus size={10} strokeWidth={2.5} />
                </span>
                <span>{ex.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Add your own */}
      <div>
        <div className="mb-2.5 font-[var(--font-outfit)] text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
          Add your own
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addCustom();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
            }}
            placeholder="e.g. Sound design pass"
            className="h-10 flex-1 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 text-[13px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.25)]"
          />
          <button
            type="submit"
            disabled={!trimmedCustom}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[rgb(var(--brand-primary))] px-4 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={12} strokeWidth={2.5} aria-hidden />
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
