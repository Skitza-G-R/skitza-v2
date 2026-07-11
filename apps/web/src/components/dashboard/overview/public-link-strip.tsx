"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

import { PUBLIC_BRAND_ORIGIN, buildJoinUrl } from "~/lib/share/public-url";

export function PublicLinkStrip({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullUrl = buildJoinUrl(slug);
  const displayUrl = `${PUBLIC_BRAND_ORIGIN.replace(/^https?:\/\//, "")}/join/${slug}`;

  function copyLink() {
    void navigator.clipboard.writeText(fullUrl).catch(() => undefined);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setCopied(false);
    }, 1600);
  }

  return (
    <div className="hidden min-w-0 items-center justify-end gap-3 lg:flex">
      <span className="max-w-[310px] truncate font-mono text-[12px] text-[rgb(var(--fg-secondary))] xl:max-w-[390px]">
        {displayUrl}
      </span>
      <button
        type="button"
        onClick={copyLink}
        aria-live="polite"
        className="sk-press inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-on-brand))] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2"
      >
        {copied ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />}
        {copied ? "Copied" : "Copy public link"}
      </button>
    </div>
  );
}
