// new-product-button.tsx
//
// Amber CTA matching the handoff. Carries the "N" keyboard hint chip;
// the actual N-key handler lives on <StoreScreen>.

"use client";

import { Plus } from "lucide-react";

import { KeyboardHintChip } from "./keyboard-hint-chip";

interface NewProductButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function NewProductButton({ onClick, disabled = false }: NewProductButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sk-press inline-flex items-center justify-center rounded-[10px] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--bg-sidebar))] shadow-[0_2px_14px_rgb(var(--brand-primary)/0.32)] transition-transform hover:translate-y-[-1px] disabled:opacity-50"
      style={{ background: "rgb(var(--brand-primary))" }}
    >
      <Plus size={15} strokeWidth={2.4} />
      <span className="ml-1.5">New product</span>
      <KeyboardHintChip label="N" />
    </button>
  );
}
