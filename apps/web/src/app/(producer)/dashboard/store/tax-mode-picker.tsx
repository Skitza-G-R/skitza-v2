// tax-mode-picker.tsx
//
// Inline picker that lives in the storefront header strip. Lets the
// producer flip their business-level VAT disclosure without leaving
// for Settings. Same write path as Settings → Currency & region:
// `updateProducer({ taxMode })`. The artist-facing footnote (rendered
// on every product card and detail page) updates on next render.
//
// Compact by design — one labeled <select>. Same data lives in
// Settings; this is just a second surface.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "~/components/ui/toast";
import {
  TAX_MODES,
  type TaxMode,
  taxModeOptionLabel,
} from "~/lib/tax-mode";
import { updateProducer } from "~/app/(producer)/dashboard/settings/actions";

interface Props {
  initial: TaxMode;
}

export function TaxModePicker({ initial }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState<TaxMode>(initial);
  const [pending, startTransition] = useTransition();

  function onChange(next: TaxMode) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const res = await updateProducer({ taxMode: next });
      if (res.ok) {
        toast("Tax disclosure updated.", "success");
        router.refresh();
      } else {
        setValue(prev);
        toast(res.error, "error");
      }
    });
  }

  return (
    <label className="flex items-center gap-2 text-[11.5px] text-[rgb(var(--fg-muted))]">
      <span className="font-mono uppercase tracking-[0.12em]">Tax</span>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as TaxMode);
        }}
        disabled={pending}
        aria-label="Tax disclosure mode"
        className="h-7 rounded-[6px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 text-[11.5px] font-semibold text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none disabled:opacity-50"
      >
        {TAX_MODES.map((m) => (
          <option key={m} value={m}>
            {taxModeOptionLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );
}
