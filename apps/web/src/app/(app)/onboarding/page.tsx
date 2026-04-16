"use client";

import { useRouter } from "next/navigation";
import { type SyntheticEvent, useState, useTransition } from "react";

import { completeOnboarding } from "./actions";

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--fg-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary))]";

const labelClass = "block text-sm font-medium text-[rgb(var(--fg-primary))] mb-1";

export default function OnboardingPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState<"USD" | "EUR" | "GBP" | "ILS">("USD");
  const [timezone, setTimezone] = useState("");

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

  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Set up your studio</h1>
      <p className="text-[rgb(var(--fg-secondary))] mb-6">
        A few quick details and you&apos;re in.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="displayName" className={labelClass}>Display name</label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); }}
            className={inputClass}
            placeholder="Your studio name"
            required
          />
        </div>
        <div>
          <label htmlFor="slug" className={labelClass}>Slug</label>
          <input
            id="slug"
            type="text"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); }}
            className={inputClass}
            placeholder="your-name"
            required
          />
        </div>
        <div>
          <label htmlFor="defaultCurrency" className={labelClass}>Default currency</label>
          <select
            id="defaultCurrency"
            value={defaultCurrency}
            onChange={(e) => { setDefaultCurrency(e.target.value as "USD" | "EUR" | "GBP" | "ILS"); }}
            className={inputClass}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="ILS">ILS</option>
          </select>
        </div>
        <div>
          <label htmlFor="timezone" className={labelClass}>Timezone</label>
          <input
            id="timezone"
            type="text"
            value={timezone}
            onChange={(e) => { setTimezone(e.target.value); }}
            className={inputClass}
            placeholder="Europe/Berlin"
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-[rgb(var(--fg-danger,239_68_68))]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-medium text-[rgb(var(--bg-base))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.9)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Continue"}
        </button>
      </form>
    </main>
  );
}
