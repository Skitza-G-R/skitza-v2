"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { JoinIntentAction } from "~/server/auth/join-intent";

import {
  continueAsArtist,
  resumeTrustedJoinIntent,
} from "./actions";

export function ResumeTrustedJoin({
  slug,
  action,
}: {
  slug: string;
  action: JoinIntentAction;
}) {
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startTransition(async () => {
      try {
        await resumeTrustedJoinIntent(slug, action);
        setFailed(true);
      } catch {
        setFailed(true);
      }
    });
  }, [action, slug]);

  if (!failed) {
    return (
      <p className="text-center text-sm text-[rgb(var(--fg-secondary))]" role="status">
        Opening booking…
      </p>
    );
  }

  const fallbackAction = continueAsArtist.bind(null, slug, action);
  return (
    <form action={fallbackAction}>
      <button
        type="submit"
        className="sk-press sk-cta-shine inline-flex min-h-12 w-full items-center justify-center rounded-[var(--radius-lg)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-6 py-3 text-sm font-semibold text-[#0C0A07] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] focus-visible:outline-none"
      >
        {action === "book" ? "Continue to booking" : "Continue to your studio"}
      </button>
    </form>
  );
}
