import { Check, CircleAlert, Copy, Eye } from "lucide-react";

export type StoreHeaderCopyState = "idle" | "copied" | "error";

interface StoreHeaderProps {
  liveCount: number;
  hiddenCount: number;
  onPreview: () => void;
  onCopy: () => void;
  copyState: StoreHeaderCopyState;
}

export function StoreHeader({
  liveCount,
  hiddenCount,
  onPreview,
  onCopy,
  copyState,
}: StoreHeaderProps) {
  const copied = copyState === "copied";
  const copyError = copyState === "error";

  return (
    <header className="mb-5 border-b border-[rgb(var(--border-subtle))] pb-5 lg:mb-6 lg:pb-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
            STORE MANAGEMENT
          </p>
          <div className="mt-1.5 flex min-w-0 items-end justify-between gap-3 lg:block">
            <h1 className="font-display text-[32px] leading-[0.95] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-[40px] lg:text-[64px]">
              Store<span className="text-[rgb(var(--brand-primary))]">.</span>
            </h1>
            <p className="shrink-0 pb-0.5 text-[12.5px] text-[rgb(var(--fg-muted))] lg:mt-2 lg:pb-0 lg:text-[14px]">
              <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">
                {liveCount}
              </span>{" "}
              live
              <span aria-hidden className="mx-1.5 opacity-45">
                ·
              </span>
              <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">
                {hiddenCount}
              </span>{" "}
              hidden
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            type="button"
            onClick={onPreview}
            className="sk-press inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] shadow-[0_8px_24px_-20px_rgb(17_16_9/0.65)] hover:border-[rgb(var(--border-strong))]"
          >
            <Eye aria-hidden size={15} strokeWidth={2.2} />
            <span className="truncate">Preview as artist</span>
          </button>
          <button
            type="button"
            onClick={onCopy}
            aria-live="polite"
            className={[
              "sk-press inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] px-3.5 text-[12.5px] font-bold shadow-[0_8px_24px_-18px_rgb(var(--brand-primary)/0.75)]",
              copyError
                ? "border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger-text))]"
                : "border border-transparent bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))] hover:brightness-105",
            ].join(" ")}
          >
            {copied ? (
              <Check aria-hidden size={15} strokeWidth={2.3} />
            ) : copyError ? (
              <CircleAlert aria-hidden size={15} strokeWidth={2.2} />
            ) : (
              <Copy aria-hidden size={15} strokeWidth={2.2} />
            )}
            <span className="truncate">
              {copied ? "Copied" : copyError ? "Try copy again" : "Copy link"}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
