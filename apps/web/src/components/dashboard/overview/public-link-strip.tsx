"use client";

import { Check, CircleAlert, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PUBLIC_BRAND_ORIGIN, buildJoinUrl } from "~/lib/share/public-url";

export async function copyPublicLink(
  url: string,
  writeText: ((text: string) => Promise<void>) | undefined,
): Promise<boolean> {
  if (!writeText) return false;
  try {
    await writeText(url);
    return true;
  } catch {
    return false;
  }
}

type CopyState = "idle" | "copied" | "error";

export function PublicLinkStrip({ slug }: { slug: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullUrl = buildJoinUrl(slug);
  const displayUrl = `${PUBLIC_BRAND_ORIGIN.replace(/^https?:\/\//, "")}/join/${slug}`;

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyLink() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    const clipboardWrite = clipboard
      ? clipboard.writeText.bind(clipboard)
      : undefined;
    const copied = await copyPublicLink(fullUrl, clipboardWrite);
    setCopyState(copied ? "copied" : "error");
    resetTimer.current = setTimeout(() => {
      setCopyState("idle");
    }, copied ? 1600 : 2600);
  }

  const isCopied = copyState === "copied";
  const hasError = copyState === "error";

  return (
    <div className="hidden min-w-0 items-center justify-end gap-3 lg:flex">
      <span className="max-w-[310px] truncate font-mono text-[12px] text-[rgb(var(--fg-secondary))] xl:max-w-[390px]">
        {displayUrl}
      </span>
      <button
        type="button"
        onClick={() => {
          void copyLink();
        }}
        aria-live="polite"
        aria-label={hasError ? "Copy failed. Try copying the public link again." : undefined}
        className={`sk-press inline-flex h-11 min-w-[174px] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] border px-4 text-sm font-bold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:outline-none ${
          hasError
            ? "border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger-text))]"
            : "border-transparent bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))] hover:brightness-105"
        }`}
      >
        {isCopied ? (
          <Check aria-hidden size={16} />
        ) : hasError ? (
          <CircleAlert aria-hidden size={16} />
        ) : (
          <Copy aria-hidden size={16} />
        )}
        {isCopied ? "Copied" : hasError ? "Try copy again" : "Copy public link"}
      </button>
      {hasError ? (
        <span role="alert" className="sr-only">
          The public link could not be copied. Try again.
        </span>
      ) : null}
    </div>
  );
}
