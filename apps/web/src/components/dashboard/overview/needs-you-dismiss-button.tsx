"use client";

import { X } from "lucide-react";
import { useTransition } from "react";

import {
  dismissAttentionRow,
  restoreAttentionRow,
} from "~/app/(producer)/dashboard/attention-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

import type { DismissibleKind } from "./needs-you";

// SK-284 — the ✕ on a "Needs you" row.
//
// Only the three deadline-free rows get one: a finished-session follow-up, an
// artist comment, and a stuck project. Money and anything on a clock never do,
// so "Nothing needs you right now" stays true.
//
// Hiding is optimistic — the row leaves immediately — but the parent puts it
// straight back if the save fails, and the error is announced rather than
// swallowed. Undo simply deletes the dismissal; visibility is recomputed from
// scratch on the next render, so there is no second state to keep in sync.

export function NeedsYouDismissButton({
  dismiss,
  title,
  meta,
  onDismissed,
  onRestored,
}: {
  dismiss: { kind: DismissibleKind; subjectId: string };
  title: string;
  meta: string;
  onDismissed: () => void;
  onRestored: () => void;
}) {
  const online = useOnlineStatus();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function undo() {
    // Put it back on screen first; the delete is what makes that stick.
    onRestored();
    startTransition(() => {
      void restoreAttentionRow(dismiss).then((result) => {
        if (!result.ok) toast(result.error, "error");
      });
    });
  }

  function hide() {
    if (!online) {
      toast("You're offline. Reconnect to hide this.", "error");
      return;
    }
    onDismissed();
    startTransition(() => {
      void dismissAttentionRow(dismiss).then((result) => {
        if (!result.ok) {
          // Never leave a row hidden on a write that did not land.
          onRestored();
          toast(result.error, "error");
          return;
        }
        toast("Hidden until something changes", "success", {
          action: { label: "Undo", onClick: undo },
        });
      });
    });
  }

  return (
    <button
      type="button"
      onClick={hide}
      disabled={pending}
      aria-label={`Hide ${title} — ${meta}`}
      className="sk-press-pop relative -mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1 before:content-[''] text-[rgb(var(--fg-onsidebar)/0.62)] hover:bg-[rgb(var(--fg-onsidebar)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50 lg:h-9 lg:w-9 lg:text-[rgb(var(--fg-muted))] lg:hover:bg-[rgb(var(--bg-overlay))]"
    >
      <X aria-hidden size={17} />
    </button>
  );
}
