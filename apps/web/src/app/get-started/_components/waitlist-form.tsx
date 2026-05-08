"use client";

import { useState, useTransition, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { submitWaitlist } from "../actions";

// Shared form for hero + CTA-repeat sections.
//
// Pattern: server-action call via useTransition (same as
// quick-note-actions across the dashboard). On success, push to the
// thanks route with `?n=<firstName>` for personalization. On failure,
// surface the message inline with aria-live="polite" so screen readers
// announce it without grabbing focus.
//
// Honeypot: the visible `company` input has `display:none` +
// `aria-hidden="true"` + `tabIndex={-1}` so humans never reach it.
// Bots autofilling the field will hit the silent-success branch in
// the waitlist procedure.

export function WaitlistForm({
  locale,
  thanksHref,
}: {
  locale: "en" | "he";
  thanksHref: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isHe = locale === "he";

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const honeypot =
      (formEl.elements.namedItem("company") as HTMLInputElement | null)
        ?.value ?? "";
    const trimmedFirstName = firstName.trim();

    // Build the action input deliberately — exactOptionalPropertyTypes
    // forbids `key: undefined`, so we omit optional fields when empty
    // rather than passing them as undefined.
    startTransition(async () => {
      const payload: Parameters<typeof submitWaitlist>[0] = {
        email: email.trim().toLowerCase(),
        locale,
        company: honeypot,
      };
      if (trimmedFirstName) payload.firstName = trimmedFirstName;
      const result = await submitWaitlist(payload);

      if (result.ok) {
        const url = trimmedFirstName
          ? `${thanksHref}?n=${encodeURIComponent(trimmedFirstName)}`
          : thanksHref;
        router.push(url);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      noValidate
    >
      <label className="sr-only" htmlFor="waitlist-email">
        {isHe ? "אימייל" : "Email"}
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        autoComplete="email"
        placeholder={isHe ? "הזן אימייל" : "your@email.com"}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
        className="h-12 flex-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 text-[rgb(var(--fg-primary))] placeholder-[rgb(var(--fg-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--brand-primary))] sm:h-14"
      />
      <label className="sr-only" htmlFor="waitlist-first-name">
        {isHe ? "שם פרטי" : "First name (optional)"}
      </label>
      <input
        id="waitlist-first-name"
        type="text"
        autoComplete="given-name"
        placeholder={isHe ? "שם פרטי (אופציונלי)" : "First name (optional)"}
        value={firstName}
        onChange={(e) => {
          setFirstName(e.target.value);
        }}
        className="h-12 flex-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 text-[rgb(var(--fg-primary))] placeholder-[rgb(var(--fg-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--brand-primary))] sm:h-14"
      />
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <button
        type="submit"
        disabled={isPending}
        className="sk-cta-shine h-12 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 font-semibold text-[rgb(var(--fg-inverse))] disabled:opacity-50 sm:h-14"
      >
        {isPending
          ? isHe
            ? "שולח..."
            : "Sending..."
          : isHe
            ? "גישה מוקדמת"
            : "Get early access"}
      </button>
      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-[rgb(var(--fg-danger))] sm:basis-full"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
