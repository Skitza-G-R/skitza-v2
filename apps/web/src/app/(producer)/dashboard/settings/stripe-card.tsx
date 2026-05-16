"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import {
  openStripeDashboard,
  refreshStripeStatus,
  startStripeOnboarding,
} from "./stripe-actions";

// "Payments" card on /dashboard/settings. Three states:
//   1. Not connected   — single CTA: "Connect Stripe"
//   2. Pending KYC     — warning + "Resume onboarding"
//   3. Connected + KYC — green check + "Open Stripe Dashboard"
//
// On `?stripe=return` (the URL Stripe sends the producer back to after
// hosted onboarding) we fire `refreshStripeStatus()` so the badge
// flips immediately without waiting for the webhook. On `?stripe=
// refresh` we just keep the producer on the page; they can click
// "Resume" again.
export function StripeCard({
  connected,
  chargesEnabled,
}: {
  connected: boolean;
  chargesEnabled: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [refreshed, setRefreshed] = useState(false);

  useEffect(() => {
    if (search.get("stripe") === "return" && !refreshed) {
      setRefreshed(true);
      refreshStripeStatus()
        .then((res) => {
          if (res.ok) {
            router.replace("/dashboard/settings");
            router.refresh();
          }
        })
        .catch(() => {
          // best-effort — webhook will catch up
        });
    }
  }, [search, refreshed, router]);

  function onboard() {
    startTransition(async () => {
      const res = await startStripeOnboarding();
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      window.location.href = res.url;
    });
  }

  function dashboard() {
    startTransition(async () => {
      const res = await openStripeDashboard();
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <section>
      {/* Page-level header (settings/page.tsx) hosts the section title
          + description; this section sits flat inside the outer Setup
          container card. The status badge stays — it's a live
          indicator, not chrome. */}
      <header className="mb-3 flex items-center justify-end">
        <StatusBadge connected={connected} chargesEnabled={chargesEnabled} />
      </header>

      {!connected && (
        <Button onClick={onboard} disabled={pending}>
          {pending ? "Opening Stripe…" : "Connect Stripe"}
        </Button>
      )}

      {connected && !chargesEnabled && (
        <div className="space-y-3">
          <p className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-sm text-[rgb(var(--fg-secondary))]">
            Stripe needs more information before you can accept charges. Resume onboarding
            to finish verification.
          </p>
          <Button onClick={onboard} disabled={pending}>
            {pending ? "Opening Stripe…" : "Resume onboarding"}
          </Button>
        </div>
      )}

      {connected && chargesEnabled && (
        <Button variant="secondary" onClick={dashboard} disabled={pending}>
          {pending ? "Opening Stripe…" : "Open Stripe Dashboard"}
        </Button>
      )}
    </section>
  );
}

function StatusBadge({
  connected,
  chargesEnabled,
}: {
  connected: boolean;
  chargesEnabled: boolean;
}) {
  if (chargesEnabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Pending verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--fg-muted))]">
      Not connected
    </span>
  );
}
