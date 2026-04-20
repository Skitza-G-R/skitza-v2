"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import type { TodayListItem } from "./today-list";

// Right-pane (desktop) / full-viewport (mobile) detail for whichever
// inbox item is selected via ?itemId. Reads the current selection
// from URL state and finds the matching row in the passed-in list
// prop — the list is already rendered on the same page so we don't
// re-fetch, we just look up.
//
// Empty state: no ?itemId → "Select an item…" prompt. The empty
// state has to live here (not in today-view) because on mobile the
// list disappears when an item is selected, so the detail IS the
// primary surface.
export function TodayDetail({
  items,
  selectedItemId,
}: {
  items: TodayListItem[];
  selectedItemId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const clearSelection = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("itemId");
    const query = params.toString();
    startTransition(() => {
      router.replace(`/dashboard${query ? `?${query}` : ""}`, { scroll: false });
    });
  };

  if (!selectedItemId) {
    return (
      // Batch C — empty state as typography, not a dashed box.
      <div className="flex min-h-[240px] items-center justify-center p-8 text-center">
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          Pick an item on the left to see details.
        </p>
      </div>
    );
  }

  const item = items.find((i) => i.id === selectedItemId);
  if (!item) {
    return (
      <div className="flex min-h-[240px] items-center justify-center p-8 text-center">
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
          That item is no longer in your inbox.{" "}
          <button
            type="button"
            onClick={clearSelection}
            className="text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
          >
            Back to inbox
          </button>
        </p>
      </div>
    );
  }

  return (
    // Batch C — no card frame. The detail pane is the right half of a
    // two-pane inbox; on mobile it's a full-bleed screen. Chrome on
    // either would read as "card in a card."
    <article className="flex flex-col gap-6 p-2 md:pl-8">
      <header>
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          {KIND_LABEL[item.kind]}
        </p>
        <h2 className="mt-2 font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-4xl">
          {item.title}
        </h2>
        <p className="mt-3 text-[0.95rem] leading-7 text-[rgb(var(--fg-secondary))]">
          {item.subtitle}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Link
          href={item.href}
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          Open in Project Room
        </Link>

        {item.kind === "session" ? (
          <Link
            href={item.href}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]"
          >
            Reschedule
          </Link>
        ) : null}

        {item.kind === "comment" ? (
          <Link
            href={item.href}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]"
          >
            Reply in thread
          </Link>
        ) : null}

        {item.kind === "invoice" ? (
          <Link
            href={item.href}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]"
          >
            Open Stripe
          </Link>
        ) : null}

        {item.kind === "lead" ? (
          <>
            <Link
              href={item.href}
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]"
            >
              Accept lead
            </Link>
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 text-sm text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))]"
            >
              Skip for now
            </button>
          </>
        ) : null}
      </div>

      <footer className="flex items-center justify-between border-t border-[rgb(var(--border-subtle))] pt-3">
        <p className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
          {new Date(item.occurredAtIso).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={clearSelection}
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
        >
          Close
        </button>
      </footer>
    </article>
  );
}

const KIND_LABEL: Record<TodayListItem["kind"], string> = {
  session: "Session",
  comment: "Comment",
  invoice: "Invoice",
  lead: "Lead",
};
