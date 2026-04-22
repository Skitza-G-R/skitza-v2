"use client";

import { useRouter } from "next/navigation";
import { type SyntheticEvent, useState, useTransition } from "react";

import { Button } from "~/components/ui/button";
import { Input, Label, Select } from "~/components/ui/input";
import { completeOnboarding } from "./actions";

// Default timezone suggestion — read from the browser so the field isn't
// empty. Server still validates; this is a UX hint.
function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState<"USD" | "EUR" | "GBP" | "ILS">("USD");
  const [timezone, setTimezone] = useState<string>(defaultTimezone);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await completeOnboarding({ displayName, slug, defaultCurrency, timezone });
        router.push("/dashboard");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  // Live-sanitise slug to the DB regex so users can't type invalid chars.
  function handleSlug(v: string) {
    setSlug(
      v
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 48),
    );
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      {/* Ambient background — same palette as landing, quieter. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-6rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[rgb(var(--brand-primary)/0.08)] blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
        <div className="reveal-up">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Onboarding · Step 1 of 1
          </p>
          <h1
            className="mt-3 font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Name your studio.
          </h1>
          <p className="mt-4 max-w-md text-[rgb(var(--fg-secondary))]">
            A few quick details and you&apos;re in. You can change these later from settings.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="reveal-up-delay-1 mt-8 space-y-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
        >
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); }}
              placeholder="Your studio name"
              required
              autoFocus
            />
            <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
              Shown at the top of your public portfolio.
            </p>
          </div>

          <div>
            <Label htmlFor="slug">Studio URL</Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-xs text-[rgb(var(--fg-muted))]">
                /join/
              </span>
              <Input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => { handleSlug(e.target.value); }}
                placeholder="your-name"
                required
                className="pl-10 font-mono"
                pattern="[a-z0-9-]+"
                minLength={3}
                maxLength={48}
              />
            </div>
            <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
              Lowercase letters, numbers, and dashes. 3-48 characters.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="defaultCurrency">Currency</Label>
              <Select
                id="defaultCurrency"
                value={defaultCurrency}
                onChange={(e) =>
                  { setDefaultCurrency(e.target.value as "USD" | "EUR" | "GBP" | "ILS"); }
                }
              >
                <option value="USD">USD · $</option>
                <option value="EUR">EUR · €</option>
                <option value="GBP">GBP · £</option>
                <option value="ILS">ILS · ₪</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                type="text"
                value={timezone}
                onChange={(e) => { setTimezone(e.target.value); }}
                placeholder="Europe/Berlin"
                required
                list="tz-suggestions"
                className="font-mono"
              />
              <datalist id="tz-suggestions">
                <option value="Europe/Berlin" />
                <option value="Europe/London" />
                <option value="Europe/Paris" />
                <option value="America/New_York" />
                <option value="America/Los_Angeles" />
                <option value="Asia/Jerusalem" />
                <option value="Asia/Tokyo" />
                <option value="Australia/Sydney" />
              </datalist>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={pending} size="lg" className="w-full">
            {pending ? "Saving…" : "Enter your studio →"}
          </Button>
        </form>

        <p className="reveal-up-delay-2 mt-6 text-center font-mono text-xs text-[rgb(var(--fg-muted))]">
          You can edit all of this later · nothing's locked in
        </p>
      </div>
    </div>
  );
}
