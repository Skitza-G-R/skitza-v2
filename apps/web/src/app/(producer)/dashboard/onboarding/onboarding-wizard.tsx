"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { QrCode } from "~/components/ui/qr-code";
import { useToast } from "~/components/ui/toast";
import {
  createFirstPackage,
  saveIdentity,
  saveWeeklyHours,
  type ActionResult,
} from "./actions";

// Local step type. The wizard is a linear 4-stop stepper — no
// branching — so a tuple index is enough. Labels live in one array
// so the progress dots + the step titles stay in sync.
type StepKey = "identity" | "package" | "hours" | "share";
const STEPS: { key: StepKey; label: string }[] = [
  { key: "identity", label: "You" },
  { key: "package", label: "Package" },
  { key: "hours", label: "Hours" },
  { key: "share", label: "Share" },
];

export interface OnboardingInitial {
  displayName: string;
  slug: string;
  defaultCurrency: string;
  publicUrl: string; // absolute /join/{slug} URL; rebuilt in step 4
  appOrigin: string; // for rebuilding publicUrl if slug changes
}

// 4-step, skippable, idiot-proof. Mobile-first: each step is one
// column, large inputs, giant Next button. Desktop gets the same
// layout centred + wider.
export function OnboardingWizard({ initial }: { initial: OnboardingInitial }) {
  const router = useRouter();
  const [step, setStep] = useState<number>(0);

  // Step 1 state
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(false);
  const identitySlug = slug.trim().toLowerCase();

  // Step 2 state — starter package. Defaults are a "mixing session"
  // because that's the most common first offering.
  const [pkgName, setPkgName] = useState("Mixing session");
  const [pkgDurationMin, setPkgDurationMin] = useState(120);
  const [pkgPriceDollars, setPkgPriceDollars] = useState("250");
  const [pkgDepositPct, setPkgDepositPct] = useState("25");

  // Step 3 state — weekly hours. Preset = Mon-Fri 10-18. Custom can
  // flip individual days on/off. startMin/endMin stored in minutes.
  const [weekBlocks, setWeekBlocks] = useState<WeekBlock[]>(defaultWeek());

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const publicUrl = useMemo(() => {
    // If the slug in step 1 changed, step 4 shows the new URL. Fall
    // back to the initial URL if slug is empty.
    const s = identitySlug || initial.slug;
    return `${initial.appOrigin}/join/${s}`;
  }, [identitySlug, initial.appOrigin, initial.slug]);

  function onNext() {
    setError(null);
    if (step === 0) {
      if (!displayName.trim() || displayName.trim().length < 1) {
        setError("Please enter your display name.");
        return;
      }
      if (!/^[a-z0-9-]{3,48}$/.test(identitySlug)) {
        setError("Slug must be 3–48 chars, lowercase letters, numbers, or dashes.");
        return;
      }
      startTransition(() => {
        void saveIdentity({ displayName: displayName.trim(), slug: identitySlug }).then(
          onActionResult(() => {
            setStep(1);
          }),
        );
      });
      return;
    }
    if (step === 1) {
      const duration = pkgDurationMin;
      const priceDollars = Number(pkgPriceDollars);
      const depositPct = Number(pkgDepositPct || "0");
      if (!pkgName.trim()) {
        setError("Give your service a name.");
        return;
      }
      if (!Number.isFinite(duration) || duration < 15) {
        setError("Duration must be at least 15 minutes.");
        return;
      }
      if (!Number.isFinite(priceDollars) || priceDollars < 0) {
        setError("Price can't be negative.");
        return;
      }
      if (!Number.isFinite(depositPct) || depositPct < 0 || depositPct > 100) {
        setError("Deposit must be 0–100%.");
        return;
      }
      startTransition(() => {
        void createFirstPackage({
          name: pkgName.trim(),
          durationMin: Math.round(duration),
          priceCents: Math.round(priceDollars * 100),
          depositPct: Math.round(depositPct),
        }).then(
          onActionResult(() => {
            setStep(2);
          }),
        );
      });
      return;
    }
    if (step === 2) {
      const blocks = weekBlocks
        .filter((b) => b.enabled)
        .map((b) => ({
          weekday: b.weekday,
          startMin: b.startMin,
          endMin: b.endMin,
        }));
      if (blocks.length === 0) {
        setError("Pick at least one day you're open.");
        return;
      }
      startTransition(() => {
        void saveWeeklyHours({ blocks }).then(
          onActionResult(() => {
            setStep(3);
          }),
        );
      });
      return;
    }
    // Step 3 → finish
    router.push("/dashboard");
    router.refresh();
  }

  function onActionResult(onSuccess: () => void) {
    return (r: ActionResult) => {
      if (r.ok) {
        onSuccess();
      } else {
        setError(r.error);
      }
    };
  }

  function skipAll() {
    router.push("/dashboard?skip=1");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+88px)] pt-6 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={[
                "h-2 w-2 rounded-full transition-colors",
                i === step
                  ? "bg-[rgb(var(--brand-primary))]"
                  : i < step
                    ? "bg-[rgb(var(--fg-secondary))]"
                    : "bg-[rgb(var(--border-subtle))]",
              ].join(" ")}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={skipAll}
          className="text-xs text-[rgb(var(--fg-muted))] underline decoration-dotted underline-offset-2 hover:text-[rgb(var(--fg-secondary))]"
        >
          Skip — I&rsquo;ll set this up later
        </button>
      </div>

      <p className="mt-8 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        Step {String(step + 1)} of {String(STEPS.length)} · {STEPS[step]?.label}
      </p>

      <div className="mt-3 flex-1">
        {step === 0 ? (
          <IdentityStep
            displayName={displayName}
            setDisplayName={(v) => {
              setDisplayName(v);
              if (!slugEdited) {
                setSlug(slugify(v));
              }
            }}
            slug={slug}
            setSlug={(v) => {
              setSlug(v);
              setSlugEdited(true);
            }}
          />
        ) : null}
        {step === 1 ? (
          <PackageStep
            pkgName={pkgName}
            setPkgName={setPkgName}
            pkgDurationMin={pkgDurationMin}
            setPkgDurationMin={setPkgDurationMin}
            pkgPriceDollars={pkgPriceDollars}
            setPkgPriceDollars={setPkgPriceDollars}
            pkgDepositPct={pkgDepositPct}
            setPkgDepositPct={setPkgDepositPct}
            currency={initial.defaultCurrency}
          />
        ) : null}
        {step === 2 ? <HoursStep blocks={weekBlocks} setBlocks={setWeekBlocks} /> : null}
        {step === 3 ? <ShareStep publicUrl={publicUrl} /> : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-3 py-2 text-sm text-[rgb(var(--fg-primary))]"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep((s) => Math.max(0, s - 1));
            }}
            className="text-sm text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
          >
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={pending}
          className="inline-flex h-14 flex-1 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 text-base font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110 disabled:opacity-60 sm:flex-none sm:px-8"
        >
          {pending ? "Saving…" : step === STEPS.length - 1 ? "Go to dashboard" : "Next"}
        </button>
      </div>

      {step === 3 ? (
        <p className="mt-4 text-center text-xs text-[rgb(var(--fg-muted))]">
          You can edit any of this later under Setup & Booking.
          <br />
          <Link
            href="/dashboard"
            className="underline decoration-dotted underline-offset-2 hover:text-[rgb(var(--fg-secondary))]"
          >
            Go to your dashboard →
          </Link>
        </p>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {pending ? "Saving" : ""}
      </span>
    </div>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────

function IdentityStep({
  displayName,
  setDisplayName,
  slug,
  setSlug,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  slug: string;
  setSlug: (v: string) => void;
}) {
  return (
    <div>
      <h1 className="font-display text-3xl leading-tight tracking-tight sm:text-4xl">
        What do clients call you?
      </h1>
      <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
        This is your studio name on your public page, and the short URL clients
        use to book you.
      </p>
      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Display name
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
            placeholder="Skitza Studio"
            autoFocus
            className="block w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-base text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Your URL
          </span>
          <div className="flex items-center overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] focus-within:border-[rgb(var(--brand-primary))]">
            <span className="select-none px-3 text-sm text-[rgb(var(--fg-muted))]">
              skitza.app/join/
            </span>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              placeholder="yourname"
              className="block w-full bg-transparent py-3 pr-4 text-base text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none"
            />
          </div>
        </label>
      </div>
    </div>
  );
}

function PackageStep({
  pkgName,
  setPkgName,
  pkgDurationMin,
  setPkgDurationMin,
  pkgPriceDollars,
  setPkgPriceDollars,
  pkgDepositPct,
  setPkgDepositPct,
  currency,
}: {
  pkgName: string;
  setPkgName: (v: string) => void;
  pkgDurationMin: number;
  setPkgDurationMin: (v: number) => void;
  pkgPriceDollars: string;
  setPkgPriceDollars: (v: string) => void;
  pkgDepositPct: string;
  setPkgDepositPct: (v: string) => void;
  currency: string;
}) {
  const currencySymbol: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    ILS: "₪",
  };
  return (
    <div>
      <h1 className="font-display text-3xl leading-tight tracking-tight sm:text-4xl">
        What do you sell?
      </h1>
      <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
        Pick one thing to sell today — a mixing session, a production day,
        whatever&apos;s most common for you. More can come later.
      </p>
      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Name
          </span>
          <input
            type="text"
            value={pkgName}
            onChange={(e) => {
              setPkgName(e.target.value);
            }}
            placeholder="Mixing session"
            className="block w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-base text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Duration (min)
            </span>
            <input
              type="number"
              min={15}
              max={1440}
              step={15}
              value={pkgDurationMin}
              onChange={(e) => {
                setPkgDurationMin(Number(e.target.value));
              }}
              className="sk-num block w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-base text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Price ({currencySymbol[currency] ?? currency})
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={pkgPriceDollars}
              onChange={(e) => {
                setPkgPriceDollars(e.target.value);
              }}
              className="sk-num block w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-base text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Deposit % (optional)
          </span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={pkgDepositPct}
            onChange={(e) => {
              setPkgDepositPct(e.target.value);
            }}
            className="sk-num block w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-base text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}

// ─── Hours step ────────────────────────────────────────────────────

interface WeekBlock {
  weekday: number;
  enabled: boolean;
  startMin: number;
  endMin: number;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultWeek(): WeekBlock[] {
  // Mon-Fri 10:00-18:00. Producer can toggle days / edit times.
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled: weekday >= 1 && weekday <= 5,
    startMin: 10 * 60,
    endMin: 18 * 60,
  }));
}

function HoursStep({
  blocks,
  setBlocks,
}: {
  blocks: WeekBlock[];
  setBlocks: (next: WeekBlock[]) => void;
}) {
  function applyPreset() {
    setBlocks(defaultWeek());
  }
  function toggle(weekday: number) {
    setBlocks(
      blocks.map((b) => (b.weekday === weekday ? { ...b, enabled: !b.enabled } : b)),
    );
  }
  function setTime(weekday: number, field: "startMin" | "endMin", minutes: number) {
    setBlocks(
      blocks.map((b) =>
        b.weekday === weekday
          ? {
              ...b,
              [field]: minutes,
            }
          : b,
      ),
    );
  }
  return (
    <div>
      <h1 className="font-display text-3xl leading-tight tracking-tight sm:text-4xl">
        When are you open?
      </h1>
      <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
        Clients only see slots inside these hours. Most producers start with the
        preset and adjust one or two days.
      </p>
      <div className="mt-6">
        <button
          type="button"
          onClick={applyPreset}
          className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-4 py-2 text-sm text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]"
        >
          Use Mon–Fri, 10am–6pm
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {blocks.map((b) => (
          <li
            key={b.weekday}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2"
          >
            <label className="flex items-center gap-2 text-sm text-[rgb(var(--fg-primary))]">
              <input
                type="checkbox"
                checked={b.enabled}
                onChange={() => {
                  toggle(b.weekday);
                }}
                className="h-4 w-4"
              />
              <span className="w-10 font-mono text-xs uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                {WEEKDAY_LABELS[b.weekday]}
              </span>
            </label>
            <div className="ml-auto flex items-center gap-1 text-sm">
              <TimeInput
                value={b.startMin}
                disabled={!b.enabled}
                onChange={(v) => {
                  setTime(b.weekday, "startMin", v);
                }}
              />
              <span className="text-[rgb(var(--fg-muted))]">–</span>
              <TimeInput
                value={b.endMin}
                disabled={!b.enabled}
                onChange={(v) => {
                  setTime(b.weekday, "endMin", v);
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimeInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (minutes: number) => void;
}) {
  const hh = String(Math.floor(value / 60)).padStart(2, "0");
  const mm = String(value % 60).padStart(2, "0");
  const inputValue = `${hh}:${mm}`;
  return (
    <input
      type="time"
      value={inputValue}
      disabled={disabled}
      onChange={(e) => {
        const parts = e.target.value.split(":").map((s) => Number(s));
        const hours = parts[0];
        const minutes = parts[1];
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
        onChange((hours ?? 0) * 60 + (minutes ?? 0));
      }}
      className="sk-num rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1 text-sm text-[rgb(var(--fg-primary))] disabled:opacity-40"
    />
  );
}

// ─── Share step ────────────────────────────────────────────────────

function ShareStep({ publicUrl }: { publicUrl: string }) {
  const { toast } = useToast();
  return (
    <div>
      <h1 className="font-display text-3xl leading-tight tracking-tight sm:text-4xl">
        You&rsquo;re set. Share your link.
      </h1>
      <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
        Paste this anywhere — DMs, email, link-in-bio. Clients pick a slot,
        you see the request land in your inbox.
      </p>
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <div className="flex items-start gap-4">
          <QrCode value={publicUrl} size={96} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Your link
            </p>
            <p className="mt-1 truncate font-mono text-sm text-[rgb(var(--fg-primary))]">
              {publicUrl}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(publicUrl).then(() => {
                    toast("Link copied", "success");
                  });
                }}
                className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
              >
                Copy link
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-4 text-sm text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))]"
              >
                Preview
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
