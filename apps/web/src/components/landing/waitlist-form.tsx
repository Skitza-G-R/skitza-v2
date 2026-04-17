"use client";

import { type SyntheticEvent, useState, useTransition } from "react";

import { joinWaitlist } from "~/app/(public)/actions/waitlist";
import { useToast } from "~/components/ui/toast";

type WaitlistSource = "landing-hero" | "landing-final-cta" | "landing-nav" | "landing-pricing";

interface WaitlistFormProps {
  source: WaitlistSource;
  /** Override the default CTA copy ("Join The Waiting List"). */
  cta?: string;
  /** Stack vertically (mobile-first hero) vs. inline (desktop hero). */
  compact?: boolean;
}

export function WaitlistForm({
  source,
  cta = "Join The Waiting List",
  compact = false,
}: WaitlistFormProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("please enter your email");
      return;
    }
    startTransition(async () => {
      const res = await joinWaitlist({ email: trimmed, source });
      if (res.ok) {
        setDone(true);
        toast("You're on the list — we'll be in touch.", "success");
      } else {
        setError(res.error);
      }
    });
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3 text-center"
      >
        <p className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
          ✓ You&apos;re in.
        </p>
        <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
          We&apos;ll email when early access opens.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={[
        "flex w-full gap-2",
        compact ? "flex-col sm:flex-row" : "flex-row items-stretch",
      ].join(" ")}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
        }}
        placeholder="you@studio.com"
        required
        aria-label="Email"
        className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-sm text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] transition-[border-color,box-shadow] focus:outline-none focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.18)]"
      />
      <button
        type="submit"
        disabled={pending}
        className="pulse-glow inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-6 py-3 text-sm font-semibold text-[#0C0A07] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.35)] transition-transform hover:scale-[1.02] hover:-translate-y-[1px] active:translate-y-[1px] disabled:pointer-events-none disabled:opacity-60"
      >
        {pending ? "Joining…" : cta}
      </button>
      {error ? (
        <p
          role="alert"
          className="mt-1 basis-full text-xs text-[rgb(var(--fg-danger))] sm:mt-2"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
