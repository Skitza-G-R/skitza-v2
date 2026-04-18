"use client";

import { type SyntheticEvent, useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { submitBookingRequest } from "./actions";

// Data the server passes down — already active packages for this
// producer + their studio timezone + display name.
export interface BookingPackage {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  sessionCount: number;
  priceCents: number;
  currency: string;
  depositPct: number;
  kind: string;
  locationType: string;
  minLeadHours: number;
}

// Display labels. Public-friendly wording, not the DB enum values.
const KIND_SECTION: Record<string, string> = {
  session: "Sessions",
  mixing: "Mixing",
  mastering: "Mastering",
  producing: "Producing",
  other: "Other",
};
const LOCATION_PILL: Record<string, { label: string; tone: "studio" | "remote" | "travel" }> = {
  studio: { label: "In studio", tone: "studio" },
  remote: { label: "Remote", tone: "remote" },
  client_space: { label: "Your space", tone: "travel" },
};

interface Props {
  slug: string;
  displayName: string;
  timezone: string;
  packages: BookingPackage[];
  initialSlotsByPackage: Record<string, string[]>;
}

type Step = "package" | "slot" | "details" | "done";

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};
function formatMoney(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  const dollars = cents / 100;
  const prefix = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${prefix}${dollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Format slot start in the PRODUCER's timezone. Visitor-TZ conversion
// is deferred to v2 — we show a banner telling visitors about this.
function formatSlotInTz(iso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  return fmt.format(new Date(iso));
}

function groupByDay(slots: string[], tz: string): { dayLabel: string; slots: string[] }[] {
  const days = new Map<string, string[]>();
  const dayFmt = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  for (const slot of slots) {
    const day = dayFmt.format(new Date(slot));
    const list = days.get(day) ?? [];
    list.push(slot);
    days.set(day, list);
  }
  return Array.from(days.entries()).map(([dayLabel, sls]) => ({ dayLabel, slots: sls }));
}

export function BookingClient({
  slug,
  displayName,
  timezone,
  packages,
  initialSlotsByPackage,
}: Props) {
  const [step, setStep] = useState<Step>("package");
  const [pkgId, setPkgId] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [artistName, setArtistName] = useState("");
  const [artistEmail, setArtistEmail] = useState("");
  const [artistPhone, setArtistPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pkg = useMemo(() => packages.find((p) => p.id === pkgId) ?? null, [packages, pkgId]);
  const slotsForPkg = useMemo(() => {
    if (!pkgId) return [];
    return initialSlotsByPackage[pkgId] ?? [];
  }, [pkgId, initialSlotsByPackage]);
  const slotGroups = useMemo(() => groupByDay(slotsForPkg, timezone), [slotsForPkg, timezone]);

  // Auto-advance when the visitor clicks a package — reduces friction.
  useEffect(() => {
    if (step === "package" && pkgId) setStep("slot");
  }, [step, pkgId]);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pkgId || !slotIso) return;
    setError(null);
    startTransition(async () => {
      const res = await submitBookingRequest({
        slug,
        productId: pkgId,
        artistName: artistName.trim(),
        artistEmail: artistEmail.trim(),
        ...(artistPhone.trim() ? { artistPhone: artistPhone.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        startsAtIso: slotIso,
      });
      if (res.ok) {
        // Phase H.5 — when the producer has Stripe Connect on, the
        // server returns a Checkout URL. Redirect immediately so the
        // visitor pays before they bounce. Otherwise fall through to
        // the original "pending approval" success state.
        if (res.data.checkoutUrl) {
          window.location.href = res.data.checkoutUrl;
          return;
        }
        setStep("done");
      } else {
        setError(res.error);
      }
    });
  }

  // ─ Render steps ────────────────────────────────────────────────
  if (step === "done") {
    return (
      <section className="mx-auto max-w-xl text-center">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Request submitted
        </p>
        <h2
          className="mt-4 font-display text-4xl leading-tight tracking-tight"
          style={{ fontWeight: 800 }}
        >
          Pending {displayName}&apos;s confirmation.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-[rgb(var(--fg-secondary))]">
          You&apos;ll hear back within 24h. The slot is held for you — no need to submit again.
        </p>
        {slotIso && pkg ? (
          <p className="mt-8 inline-block rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-3 text-left font-mono text-sm">
            {pkg.name} · {formatSlotInTz(slotIso, timezone)}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-center gap-3 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        <span className={step === "package" ? "text-[rgb(var(--brand-primary))] font-semibold" : ""}>
          1 · Package
        </span>
        <span>›</span>
        <span className={step === "slot" ? "text-[rgb(var(--brand-primary))] font-semibold" : ""}>
          2 · Slot
        </span>
        <span>›</span>
        <span className={step === "details" ? "text-[rgb(var(--brand-primary))] font-semibold" : ""}>
          3 · Details
        </span>
      </div>

      {/* Step 1: package picker.
          Grouped by `kind` when the producer offers ≥2 distinct kinds
          (e.g. Mixing + Producing), otherwise rendered as a single
          grid to avoid an awkward solo section header. */}
      {step === "package" ? (
        <div className="space-y-8">
          {(() => {
            // Preserve the producer's `position` ordering inside each
            // kind bucket.
            const byKind = new Map<string, BookingPackage[]>();
            for (const p of packages) {
              const list = byKind.get(p.kind) ?? [];
              list.push(p);
              byKind.set(p.kind, list);
            }
            const shouldGroup = byKind.size >= 2;
            const kinds = shouldGroup
              ? Array.from(byKind.keys())
              : ["__all__"];
            return kinds.map((k) => {
              const items = shouldGroup ? (byKind.get(k) ?? []) : packages;
              return (
                <section key={k}>
                  {shouldGroup ? (
                    <h2 className="mb-3 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                      {KIND_SECTION[k] ?? k}
                    </h2>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {items.map((p) => {
                      const loc = LOCATION_PILL[p.locationType];
                      const isPack = p.sessionCount > 1;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setPkgId(p.id);
                          }}
                          className="group relative flex min-h-[44px] flex-col rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 text-left transition-all hover:border-[rgb(var(--brand-primary)/0.5)] hover:shadow-[0_8px_24px_-4px_rgb(var(--brand-primary)/0.15)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-display text-xl leading-tight" style={{ fontWeight: 700 }}>
                              {p.name}
                            </h3>
                            {loc ? (
                              <span
                                className={[
                                  "shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wider",
                                  loc.tone === "studio"
                                    ? "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
                                    : loc.tone === "remote"
                                    ? "bg-[rgb(var(--fg-muted)/0.15)] text-[rgb(var(--fg-secondary))]"
                                    : "bg-[rgb(var(--brand-accent)/0.15)] text-[rgb(var(--brand-accent))]",
                                ].join(" ")}
                              >
                                {loc.label}
                              </span>
                            ) : null}
                          </div>
                          {p.description ? (
                            <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))] line-clamp-3">
                              {p.description}
                            </p>
                          ) : null}
                          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span
                              className="font-display text-2xl leading-none text-[rgb(var(--brand-primary))]"
                              style={{ fontWeight: 800 }}
                            >
                              {formatMoney(p.priceCents, p.currency)}
                            </span>
                            <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
                              {p.durationMin}min · {isPack ? `${String(p.sessionCount)}-pack` : "1 session"}
                            </span>
                          </div>
                          {p.depositPct > 0 ? (
                            <p className="mt-3 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--brand-accent))]">
                              {String(p.depositPct)}% deposit at booking
                            </p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            });
          })()}
        </div>
      ) : null}

      {/* Step 2: slot picker */}
      {step === "slot" && pkg ? (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[rgb(var(--fg-secondary))]">
                Selected: <span className="font-semibold text-[rgb(var(--fg-primary))]">{pkg.name}</span>
              </p>
              <p className="mt-1 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                Times shown in <span className="text-[rgb(var(--fg-secondary))]">{timezone}</span>
                {pkg.locationType === "remote"
                  ? " (remote session — no physical location)"
                  : pkg.locationType === "client_space"
                  ? " (producer travels to you)"
                  : " (producer's studio)"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPkgId(null);
                setSlotIso(null);
                setStep("package");
              }}
            >
              ← Change package
            </Button>
          </div>

          {slotsForPkg.length === 0 ? (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-12 text-center">
              <p className="font-display text-lg" style={{ fontWeight: 700 }}>
                No slots available.
              </p>
              <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
                {displayName} hasn&apos;t opened slots in the next 14 days. Check back later or
                reach out directly.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {slotGroups.map((g) => (
                <div key={g.dayLabel}>
                  <h3 className="mb-3 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                    {g.dayLabel}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {g.slots.map((s) => {
                      const label = new Intl.DateTimeFormat(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: timezone,
                      }).format(new Date(s));
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setSlotIso(s);
                            setStep("details");
                          }}
                          className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 font-mono text-xs text-[rgb(var(--fg-primary))] transition-all hover:border-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.08)]"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Step 3: details form */}
      {step === "details" && pkg && slotIso ? (
        <form
          onSubmit={onSubmit}
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6"
        >
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] pb-5">
            <div>
              <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                Your request
              </p>
              <p className="mt-1 font-display text-lg" style={{ fontWeight: 700 }}>
                {pkg.name}
              </p>
              <p className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-secondary))]">
                {formatSlotInTz(slotIso, timezone)} · {pkg.durationMin}min
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep("slot");
              }}
            >
              ← Change slot
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="artistName">Your name</Label>
              <Input
                id="artistName"
                type="text"
                value={artistName}
                onChange={(e) => {
                  setArtistName(e.target.value);
                }}
                required
                maxLength={80}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="artistEmail">Email</Label>
              <Input
                id="artistEmail"
                type="email"
                value={artistEmail}
                onChange={(e) => {
                  setArtistEmail(e.target.value);
                }}
                required
              />
            </div>
            <div>
              <Label htmlFor="artistPhone">Phone (optional)</Label>
              <Input
                id="artistPhone"
                type="tel"
                value={artistPhone}
                onChange={(e) => {
                  setArtistPhone(e.target.value);
                }}
                maxLength={40}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                type="text"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                }}
                placeholder="What you're working on / any links"
                maxLength={1000}
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-[rgb(var(--fg-danger))]">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button type="submit" disabled={pending} size="lg">
              {pending ? "Sending…" : "Request session"}
            </Button>
          </div>
          <p className="mt-3 text-center font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            {displayName} confirms within 24h · deposit collected after
          </p>
        </form>
      ) : null}
    </div>
  );
}
