"use client";

import { useId, useState, useTransition, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { usePublicOnline } from "~/components/public/public-connectivity";

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
  const online = usePublicOnline();

  // Unique IDs per form instance — the funnel renders two
  // <WaitlistForm>s (hero + final CTA), so hardcoded IDs would
  // duplicate across the page (a11y violation, label-for breakage).
  const formId = useId();
  const emailId = `waitlist-email-${formId}`;
  const firstNameId = `waitlist-first-name-${formId}`;
  const errorId = `waitlist-error-${formId}`;

  const isHe = locale === "he";

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!online) {
      setError(
        isHe
          ? "אין חיבור לאינטרנט. התחברו ונסו שוב."
          : "You’re offline. Reconnect and try again.",
      );
      return;
    }
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
      try {
        const result = await submitWaitlist(payload);

        if (result.ok) {
          const url = trimmedFirstName
            ? `${thanksHref}?n=${encodeURIComponent(trimmedFirstName)}`
            : thanksHref;
          router.push(url);
        } else {
          setError(result.message);
        }
      } catch {
        setError(
          isHe
            ? "לא הצלחנו לשלוח כרגע. בדקו את החיבור ונסו שוב."
            : "We couldn’t submit that. Check your connection and try again.",
        );
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
        className="gs-input sk-native-field"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        enterKeyHint="next"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
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
        className="gs-input sk-native-field"
        type="text"
        autoComplete="given-name"
        enterKeyHint="done"
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
      <button
        type="submit"
        className="btn-primary sk-press"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : null}
        {isPending
          ? isHe ? "שולח…" : "Sending…"
          : isHe ? "גישה מוקדמת" : "Get early access"}
      </button>
      {error ? (
        <p
          id={errorId}
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
