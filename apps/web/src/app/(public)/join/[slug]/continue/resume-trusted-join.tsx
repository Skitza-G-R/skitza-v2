"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { JoinIntentAction } from "~/server/auth/join-intent";
import { Button } from "~/components/ui/button";

import { continueAsArtist, resumeTrustedJoinIntent } from "./actions";

export function ResumeTrustedJoin({ slug, action }: { slug: string; action: JoinIntentAction }) {
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
      <Button
        type="submit"
        size="lg"
        className="sk-cta-shine w-full rounded-[var(--radius-lg)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] text-[#0C0A07]"
      >
        {action === "book" ? "Continue to booking" : "Continue to your studio"}
      </Button>
    </form>
  );
}
