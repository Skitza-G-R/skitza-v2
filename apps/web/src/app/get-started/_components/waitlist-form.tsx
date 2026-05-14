"use client";

import { useId, useState, useTransition, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { submitWaitlist } from "../actions";

// Shared form for hero + final CTA sections. Uses marketing-class
// styling (.gs-form / .gs-input / .btn-primary) from get-started.css
// rather than Tailwind arbitrary values, so light/dark theme variants
// are handled via parent .section-dark.

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

  // Unique IDs per form instance — the funnel renders two
  // <WaitlistForm>s (hero + final CTA), so hardcoded IDs would
  // duplicate across the page (a11y violation, label-for breakage).
  const formId = useId();
  const emailId = `waitlist-email-${formId}`;
  const firstNameId = `waitlist-first-name-${formId}`;

  const isHe = locale === "he";

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const honeypot =
      (formEl.elements.namedItem("company") as HTMLInputElement | null)
        ?.value ?? "";
    const trimmedFirstName = firstName.trim();

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
    <form className="gs-form" onSubmit={onSubmit} noValidate>
      <label className="sr-only" htmlFor={emailId}>
        {isHe ? "אימייל" : "Email"}
      </label>
      <input
        id={emailId}
        className="gs-input"
        type="email"
        required
        autoComplete="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
      />
      <label className="sr-only" htmlFor={firstNameId}>
        {isHe ? "שם פרטי" : "First name (optional)"}
      </label>
      <input
        id={firstNameId}
        className="gs-input"
        type="text"
        autoComplete="given-name"
        placeholder={isHe ? "שם פרטי" : "First name"}
        value={firstName}
        onChange={(e) => {
          setFirstName(e.target.value);
        }}
      />
      {/* Honeypot — bots fill it, humans don't see it (display:none) */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <button type="submit" className="btn-primary" disabled={isPending}>
        {isPending ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : null}
        {isPending
          ? isHe ? "שולח…" : "Sending…"
          : isHe ? "גישה מוקדמת" : "Get early access"}
      </button>
      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="gs-form-error"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
