import type { HTMLAttributes } from "react";

import { cn } from "~/lib/cn";

export type NativeActionState = "idle" | "progress" | "success" | "error";

interface NativeActionStatusProps extends HTMLAttributes<HTMLDivElement> {
  state: NativeActionState;
  message?: string;
  progress?: number;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Local feedback for a single action or form. It deliberately complements
 * global toasts: progress remains beside the work, success is polite, and an
 * error is announced immediately.
 */
export function NativeActionStatus({
  state,
  message,
  progress,
  className,
  ...props
}: NativeActionStatusProps) {
  if (state === "idle") return null;

  const progressValue =
    state === "progress" && progress != null ? clampProgress(progress) : undefined;
  const fallbackMessage =
    state === "progress" ? "Working…" : state === "success" ? "Done" : "Something went wrong";
  const visibleMessage = message ?? fallbackMessage;

  return (
    <div
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      data-native-status={state}
      className={cn(
        "sk-native-status flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5",
        "text-sm leading-snug",
        state === "progress" &&
          "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken)/0.55)] text-[rgb(var(--fg-secondary))]",
        state === "success" &&
          "border-[rgb(var(--fg-success)/0.3)] bg-[rgb(var(--fg-success)/0.08)] text-[rgb(var(--fg-success-text))]",
        state === "error" &&
          "border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger-text))]",
        className,
      )}
      {...props}
    >
      <StatusIcon state={state} />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{visibleMessage}</p>
        {state === "progress" && progressValue != null ? (
          <div
            role="progressbar"
            aria-label={visibleMessage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValue}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--border-subtle))]"
          >
            <span
              className="block h-full rounded-full bg-[rgb(var(--brand-primary))] transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${String(progressValue)}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusIcon({ state }: { state: Exclude<NativeActionState, "idle"> }) {
  if (state === "progress") {
    return (
      <span
        aria-hidden
        className="sk-native-spinner mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-[rgb(var(--border-strong))] border-t-[rgb(var(--brand-primary))]"
      />
    );
  }

  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="mt-0.5 h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {state === "success" ? (
        <path d="m4 10 4 4 8-9" />
      ) : (
        <>
          <path d="M10 6v5" />
          <path d="M10 14h.01" />
          <circle cx="10" cy="10" r="8" />
        </>
      )}
    </svg>
  );
}
