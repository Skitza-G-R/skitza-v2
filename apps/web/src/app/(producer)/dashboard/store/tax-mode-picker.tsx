// tax-mode-picker.tsx
//
// Storefront-header inline tax picker. Same component the Settings
// page uses (TaxModeSegmented), rendered in compact 'sm' size so it
// sits on one line with the live/hidden counts to its left.
//
// Write path is identical to Settings — updateProducer({ taxMode })
// — so the two surfaces stay in lockstep with no risk of drift.
// Pending state grays the whole control (interactive lock) without
// changing the sliding indicator's position.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "~/components/ui/toast";
import { TaxModeSegmented } from "~/components/dashboard/tax-mode-segmented";
import { type TaxMode } from "~/lib/tax-mode";
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
        toast("Tax mode updated.", "success");
        router.refresh();
      } else {
        setValue(prev);
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="font-mono uppercase tracking-[0.14em] text-[10px] font-semibold text-[rgb(var(--fg-muted))]"
      >
        Tax
      </span>
      <TaxModeSegmented
        value={value}
        onChange={onChange}
        size="sm"
        disabled={pending}
        ariaLabel="Tax disclosure mode"
      />
    </div>
  );
}
