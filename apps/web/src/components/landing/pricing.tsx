"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";

import { ScrollReveal } from "./scroll-reveal";

// Pricing — DARK world. 3 tiers, monthly/annual toggle (annual = 2
// months free → 20% off badge on annual), Pro highlighted as the most
// common mid-tier. Below the cards sits a grid of feature rows so a
// skim-reader can see "which tier gets X?" at a glance.
//
// CTAs route to Clerk sign-up with a `plan=` query param so the
// onboarding wizard can preselect a plan (wired up in a later phase).
export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section
      data-theme="chrome-dark"
      id="pricing"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute left-[-15%] top-0 h-[28rem] w-[28rem] rounded-full blur-[120px]"
          style={{ background: "rgba(176,104,48,0.08)" }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            Pricing
          </p>
          <h2
            className="mt-3 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            One plan per stage of your
            <span className="block italic text-[rgb(var(--brand-primary))]">producer life.</span>
          </h2>
          <p className="mt-5 text-[rgb(var(--fg-secondary))]">
            Start free. Upgrade when the work picks up. Cancel anytime — your data
            exports in one click.
          </p>
        </div>

        {/* Monthly / annual toggle */}
        <div
          role="group"
          aria-label="Billing cadence"
          className="mx-auto mt-10 inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 text-sm"
        >
          <Toggle active={!annual} onClick={() => { setAnnual(false); }}>Monthly</Toggle>
          <Toggle active={annual} onClick={() => { setAnnual(true); }}>
            Annual
            <span className="ml-2 rounded-full bg-[rgb(var(--brand-primary)/0.18)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
              20% off
            </span>
          </Toggle>
        </div>

        <div className="mx-auto mt-10 block text-center" />

        <div className="mt-2 grid gap-4 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <ScrollReveal
              as="article"
              key={t.id}
              delay={Math.min(i, 4) as 0 | 1 | 2 | 3 | 4}
              className={[
                "sk-lift relative flex flex-col rounded-[var(--radius-lg)] border p-7",
                t.featured
                  ? "border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--bg-elevated))] shadow-[0_20px_60px_-12px_rgb(var(--brand-primary)/0.25)]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
              ].join(" ")}
            >
              {t.featured ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--bg-base))] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                  Most producers
                </span>
              ) : null}

              <p
                className={[
                  "font-display text-lg tracking-tight",
                  t.featured ? "text-[rgb(var(--brand-primary))]" : "text-[rgb(var(--fg-primary))]",
                ].join(" ")}
                style={{ fontWeight: 700 }}
              >
                {t.name}
              </p>
              <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">{t.tagline}</p>

              <div className="mt-6 flex items-baseline gap-2">
                <span
                  className="font-display text-5xl leading-none text-[rgb(var(--fg-primary))]"
                  style={{ fontWeight: 800 }}
                >
                  {t.price === 0
                    ? "$0"
                    : `$${String(annual ? Math.round(t.price * 0.8) : t.price)}`}
                </span>
                <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
                  {t.price === 0 ? "forever" : annual ? "/mo · billed yearly" : "/month"}
                </span>
              </div>
              {annual && t.price > 0 ? (
                <p className="mt-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                  ${String(Math.round(t.price * 0.8) * 12)} /year · save ${String(t.price * 12 - Math.round(t.price * 0.8) * 12)}
                </p>
              ) : null}

              <ul className="mt-6 space-y-2 text-sm text-[rgb(var(--fg-primary))]">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span aria-hidden className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--brand-primary))]">
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex-grow" />
              <Link
                href={t.cta.href as Route}
                className={[
                  "flex min-h-12 items-center justify-center rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold transition-transform hover:-translate-y-[1px] active:translate-y-[1px]",
                  t.featured
                    ? "sk-cta-shine pulse-glow bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] text-[#0C0A07] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.35)]"
                    : "border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-base))]",
                ].join(" ")}
              >
                <span className="relative z-10">{t.cta.label}</span>
              </Link>
            </ScrollReveal>
          ))}
        </div>

        {/* Feature matrix — every row shows which tiers include what. */}
        <div className="mt-14 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <table className="w-full text-sm">
            <thead className="border-b border-[rgb(var(--border-subtle))]">
              <tr>
                <th className="p-4 text-left font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Compare every feature
                </th>
                {TIERS.map((t) => (
                  <th
                    key={t.id}
                    className="p-4 text-center font-display tracking-tight text-[rgb(var(--fg-primary))]"
                    style={{ fontWeight: 700 }}
                  >
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-[rgb(var(--border-subtle))] last:border-b-0"
                >
                  <td className="p-4 text-[rgb(var(--fg-secondary))]">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className="p-4 text-center">
                      {v === true ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--brand-primary))]">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      ) : v === false ? (
                        <span className="text-[rgb(var(--fg-muted))]">—</span>
                      ) : (
                        <span className="font-mono text-xs text-[rgb(var(--fg-primary))]">{v}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] shadow-[inset_0_0_0_1px_rgb(var(--border-subtle))]"
          : "text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

type Tier = {
  id: "free" | "pro" | "studio";
  name: string;
  tagline: string;
  price: number; // monthly in USD; 0 = free
  featured?: boolean;
  features: readonly string[];
  cta: { label: string; href: string };
};

const TIERS: readonly Tier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "For your first paid client.",
    price: 0,
    features: [
      "1 active project",
      "Skitza-branded magic links",
      "10 GB audio storage",
      "Community support",
      "Full client export, anytime",
    ],
    cta: { label: "Start free →", href: "/sign-up?plan=free" },
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Once the work picks up.",
    price: 29,
    featured: true,
    features: [
      "Unlimited projects",
      "Custom branding on magic links",
      "100 GB audio storage",
      "Email support",
      "Desktop app (macOS)",
      "Stripe Connect for deposits",
      "Webhook API access",
    ],
    cta: { label: "Go Pro →", href: "/sign-up?plan=pro" },
  },
  {
    id: "studio",
    name: "Studio",
    tagline: "For rooms and multi-room setups.",
    price: 79,
    features: [
      "Everything in Pro",
      "Custom domain (sessions.yourname.com)",
      "Stripe Connect fees waived",
      "Team seats (coming soon)",
      "1 TB audio storage",
      "White-glove onboarding",
      "Priority deployment",
    ],
    cta: { label: "Go Studio →", href: "/sign-up?plan=studio" },
  },
];

type Val = true | false | string;
const MATRIX: readonly { label: string; values: readonly [Val, Val, Val] }[] = [
  { label: "Active projects",         values: ["1",       "Unlimited", "Unlimited"] },
  { label: "Audio storage",           values: ["10 GB",   "100 GB",    "1 TB"] },
  { label: "Custom branding",         values: [false,     true,        true] },
  { label: "Custom domain",           values: [false,     false,       true] },
  { label: "Desktop app",             values: [false,     true,        true] },
  { label: "Stripe Connect",          values: [false,     true,        true] },
  { label: "Webhook API",             values: [false,     true,        true] },
  { label: "White-glove onboarding",  values: [false,     false,       true] },
  { label: "Support",                 values: ["Community", "Email",   "Priority"] },
];
