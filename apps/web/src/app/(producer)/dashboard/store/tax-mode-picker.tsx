// tax-mode-picker.tsx
//
// Inline picker that lives in the storefront header strip. Lets the
// producer flip their business-level VAT disclosure without leaving
// for Settings. Same write path as Settings → Currency & region:
// `updateProducer({ taxMode })`. The artist-facing footnote (rendered
// on every product card and detail page) updates on next render.
//
// Visually a single chip: bordered pill, eyebrow label baked-in, custom
// chevron, hover-strong border, focus ring matching .s-select. While
// the save is in flight the chip's border pulses (no opacity drop —
// keeps the value readable mid-save).

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
    <label
      className={[
        // One bordered chip — eyebrow label sits inside the same border
        // as the select. Matches the s-select hover/focus contract from
        // settings.css so this storefront surface and the Settings
        // surface feel like the same control.
        "group relative inline-flex h-8 items-center gap-2 rounded-[10px] border bg-[rgb(var(--bg-elevated))] pl-3 pr-9 text-[11.5px]",
        "border-[rgb(var(--border-subtle))]",
        // Pending: subtle border pulse instead of opacity drop so the
        // value stays readable. .sk-pending-pulse animates the border
        // via box-shadow at the brand hue.
        pending
          ? "sk-pending-pulse"
          : "hover:border-[rgb(var(--border-strong))] focus-within:border-[rgb(var(--brand-primary))] focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.12)]",
        "transition-[border-color,box-shadow] duration-200",
      ].join(" ")}
      style={{
        // Custom chevron — same SVG path as .s-select so the producer
        // surface and Settings surface render an identical glyph.
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M3 5l3 3 3-3' stroke='%236b6359' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        transitionTimingFunction: "var(--ease-out-strong)",
      }}
    >
      <span
        className="font-mono uppercase tracking-[0.14em] text-[10.5px] font-semibold text-[rgb(var(--fg-muted))]"
        aria-hidden
      >
        Tax
      </span>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as TaxMode);
        }}
        disabled={pending}
        aria-label="Tax disclosure mode"
        className={[
          // Native <select> stripped to its essence — sits on top of
          // the chip's chevron. cursor-pointer reinforces affordance.
          "appearance-none bg-transparent text-[11.5px] font-semibold leading-none text-[rgb(var(--fg-default))] outline-none cursor-pointer",
          "disabled:cursor-progress",
        ].join(" ")}
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
