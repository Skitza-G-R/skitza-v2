"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Pencil, X } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";

import type { MusicL3ActionResult } from "./song-page";

export type SongManagementDialogConfig = {
  id: string;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  strongWarning?: boolean;
  blockedReason?: string | null;
  details?: readonly string[];
  field?: {
    label: string;
    initialValue: string;
    placeholder: string;
    maxLength: number;
    allowEmpty?: boolean;
    emptyError?: string;
  };
};

type SongManagementDialogProps = {
  open: boolean;
  config: SongManagementDialogConfig;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: string) => Promise<MusicL3ActionResult>;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function SongManagementDialog({
  open,
  config,
  onOpenChange,
  onSubmit,
  returnFocusRef,
}: SongManagementDialogProps) {
  const [value, setValue] = useState(config.field?.initialValue ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(config.field?.initialValue ?? "");
    setError(null);
  }, [config.id, config.field?.initialValue, open]);

  async function handleSubmit() {
    if (pending || config.blockedReason) return;
    const trimmed = value.trim();
    if (config.field && !config.field.allowEmpty && !trimmed) {
      setError(config.field.emptyError ?? "Enter a value to continue.");
      return;
    }

    setError(null);
    setPending(true);
    try {
      const result = await onSubmit(trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
    } catch {
      setError("The change could not be completed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const warning = config.destructive || config.strongWarning;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={[
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)]",
                warning
                  ? "bg-[rgb(var(--fg-danger)/0.1)] text-[rgb(var(--fg-danger))]"
                  : "bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]",
              ].join(" ")}
            >
              {warning ? (
                <AlertTriangle size={20} strokeWidth={2.2} />
              ) : (
                <Pencil size={19} strokeWidth={2.2} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                {config.title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                {config.description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>

          {config.field ? (
            <label className="mt-5 block">
              <span className="text-[12px] font-bold text-[rgb(var(--fg-default))]">
                {config.field.label}
              </span>
              <input
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                maxLength={config.field.maxLength}
                placeholder={config.field.placeholder}
                autoFocus
                className="mt-2 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 text-[14px] text-[rgb(var(--fg-default))] transition-[border-color,box-shadow] outline-none focus:border-[rgb(var(--brand-primary)/0.65)] focus:shadow-[0_0_0_4px_rgb(var(--brand-primary)/0.12)]"
              />
              <span className="mt-1.5 block text-right font-mono text-[10px] text-[rgb(var(--fg-faint))] tabular-nums">
                {String(value.length)}/{String(config.field.maxLength)}
              </span>
            </label>
          ) : null}

          {config.details && config.details.length > 0 ? (
            <div
              className={[
                "mt-4 rounded-[var(--radius-lg)] border p-3.5",
                warning
                  ? "border-[rgb(var(--fg-danger)/0.2)] bg-[rgb(var(--fg-danger)/0.06)]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
              ].join(" ")}
            >
              <p className="text-[11px] font-bold tracking-[0.1em] text-[rgb(var(--fg-default))] uppercase">
                {config.blockedReason ? "Why it is protected" : "What happens"}
              </p>
              <ul className="mt-2.5 space-y-2 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                {config.details.map((detail) => (
                  <li key={detail} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--fg-muted))]"
                    />
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {config.blockedReason ? (
            <p
              role="status"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.25)] bg-[rgb(var(--brand-primary)/0.08)] px-3.5 py-3 text-[12.5px] leading-relaxed font-semibold text-[rgb(var(--fg-default))]"
            >
              {config.blockedReason}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] px-3.5 py-3 text-[12.5px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}

          <div className="sticky bottom-0 mt-5 flex flex-col-reverse gap-2 bg-[rgb(var(--bg-background))] pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
            >
              {config.cancelLabel ?? "Cancel"}
            </button>
            {!config.blockedReason ? (
              <button
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={pending}
                className={[
                  "sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-white disabled:opacity-45",
                  warning
                    ? "bg-[rgb(var(--fg-danger))] shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.45)]"
                    : "bg-[rgb(var(--fg-default))]",
                ].join(" ")}
              >
                {pending ? config.pendingLabel : config.confirmLabel}
              </button>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
