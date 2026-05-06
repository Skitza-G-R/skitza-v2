"use client";

import { useState } from "react";

import { Chips } from "~/components/ui/chips";
import { formatMoney } from "~/lib/format/money";

// Phase 4 — Storefront screen.
//
// Mirrors `notes/producer-screens-2.jsx` ProducerStorefrontScreen:
//   • Inner Chips toggle: Products | Analytics.
//   • Products: dark "Create product" CTA + list of product cards
//     (name + featured/hidden pills, tagline, big mono price,
//     footer with bookings + plan + Edit / Hide buttons).
//   • Analytics: KPI grid (Views / Bookings / Revenue / Conversion)
//     + 7-day sparkline + sources list. Stubbed for v1 — the
//     `analytics` prop is null until producer.today exposes the
//     storefront analytics aggregation. Visual remains intact so
//     producers can preview what's coming.

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  sessionCount: number;
  priceCents: number;
  currency: string;
  active: boolean;
  bookingsThisMonth?: number;
  /** Display name of the payment plan (e.g. "50/50", "Pay once"). */
  planLabel?: string;
  featured?: boolean;
}

export interface StorefrontAnalytics {
  views7d: number;
  views7dDelta: number | null;
  bookings7d: number;
  bookings7dDelta: number | null;
  revenue7dCents: number;
  revenue7dDelta: number | null;
  conversionPct: number;
  conversionDelta: number | null;
  /** 7 daily values, oldest at index 0. */
  daily: number[];
  sources: Array<{ label: string; pct: number; count: number }>;
  currency: string;
}

interface StorefrontScreenProps {
  products: StorefrontProduct[];
  analytics: StorefrontAnalytics | null;
  /** Public storefront URL (e.g. https://skitza.app/p/gili). */
  publicUrl: string | null;
}

type TabKey = "products" | "analytics";

export function StorefrontScreen({
  products,
  analytics,
  publicUrl,
}: StorefrontScreenProps) {
  const [tab, setTab] = useState<TabKey>("products");

  return (
    <div className="flex flex-col gap-4">
      {publicUrl ? (
        <p className="px-1 text-[12px] text-[rgb(var(--fg-muted))]">
          <span className="font-mono">{publicUrl.replace(/^https?:\/\//, "")}</span>
        </p>
      ) : null}

      <Chips<TabKey>
        ariaLabel="Storefront sections"
        items={[
          { value: "products", label: "Products", count: products.length },
          { value: "analytics", label: "Analytics" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "products" ? (
        <ProductsSection products={products} />
      ) : (
        <AnalyticsSection analytics={analytics} />
      )}
    </div>
  );
}

// — Products section —

function ProductsSection({ products }: { products: StorefrontProduct[] }) {
  return (
    <div className="flex flex-col gap-2">
      <a
        href="/dashboard/settings?section=services&action=create"
        className="sk-press flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-4 py-3 text-sm font-bold text-[rgb(var(--fg-onsidebar))]"
      >
        <PlusIcon />
        Create product
      </a>

      {products.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          No products yet — Create one to start taking bookings.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: StorefrontProduct }) {
  return (
    <article
      className={[
        "flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5",
        product.active ? "" : "opacity-60",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-bold leading-tight text-[rgb(var(--fg-default))]">
              {product.name}
            </p>
            {product.featured ? (
              <span className="pill pill-brand inline-flex items-center gap-1">
                <StarIcon /> featured
              </span>
            ) : null}
            {product.active ? null : <span className="pill pill-neutral">hidden</span>}
          </div>
          {product.description ? (
            <p className="mt-1 line-clamp-2 text-[12px] text-[rgb(var(--fg-muted))]">
              {product.description}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 text-right font-mono text-[14px] font-extrabold text-[rgb(var(--fg-default))] tabular-nums">
          {formatMoney(product.priceCents, product.currency)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--border-subtle))] pt-2.5 text-[11px] text-[rgb(var(--fg-muted))]">
        {product.bookingsThisMonth != null ? (
          <span>
            <span className="font-mono tabular-nums">
              {String(product.bookingsThisMonth)}
            </span>{" "}
            this month
          </span>
        ) : null}
        {product.planLabel ? (
          <>
            <span>·</span>
            <span>{product.planLabel}</span>
          </>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <a
            href={`/dashboard/settings?section=services&product=${product.id}`}
            className="sk-press rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] font-semibold text-[rgb(var(--fg-default))]"
          >
            Edit
          </a>
        </div>
      </div>
    </article>
  );
}

// — Analytics section (stubbed for v1) —

function AnalyticsSection({
  analytics,
}: {
  analytics: StorefrontAnalytics | null;
}) {
  // Empty-state branch: stubbed for v1 — Phase 4 surfaces the visual
  // shape without wiring backend aggregation. The producer.today
  // extension that returns this data lives in a follow-up. Inlining
  // the predicate (instead of a `hasData` boolean) lets TS narrow
  // `analytics` to non-null inside the rich-render branch.
  if (analytics === null || analytics.views7d === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center">
        <p className="font-display text-[14px] font-bold text-[rgb(var(--fg-default))]">
          Analytics coming soon
        </p>
        <p className="text-[12px] text-[rgb(var(--fg-muted))]">
          Once your storefront has real traffic, you&rsquo;ll see views, bookings,
          revenue, and conversion right here.
        </p>
      </div>
    );
  }

  const max = Math.max(...analytics.daily, 1);

  const kpis: Array<{ label: string; value: string; delta: number | null }> = [
    {
      label: "Views · 7d",
      value: String(analytics.views7d),
      delta: analytics.views7dDelta,
    },
    {
      label: "Bookings · 7d",
      value: String(analytics.bookings7d),
      delta: analytics.bookings7dDelta,
    },
    {
      label: "Revenue · 7d",
      value: formatMoney(analytics.revenue7dCents, analytics.currency),
      delta: analytics.revenue7dDelta,
    },
    {
      label: "Conversion",
      value: `${analytics.conversionPct.toFixed(1)}%`,
      delta: analytics.conversionDelta,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-2">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="flex flex-col rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3"
          >
            <p className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
              {k.label}
            </p>
            <p className="mt-1 font-mono text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))] tabular-nums">
              {k.value}
            </p>
            {k.delta !== null ? (
              <p
                className={[
                  "mt-0.5 font-mono text-[10px] font-bold tabular-nums",
                  k.delta > 0
                    ? "text-[rgb(var(--fg-success))]"
                    : "text-[rgb(var(--fg-danger))]",
                ].join(" ")}
              >
                {k.delta > 0 ? "↑" : "↓"} {Math.abs(k.delta).toFixed(0)}
              </p>
            ) : (
              <p className="mt-0.5 font-mono text-[10px] text-[rgb(var(--fg-muted))]">—</p>
            )}
          </div>
        ))}
      </div>

      {/* Sparkline */}
      <div className="flex flex-col rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5">
        <p className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          Views · last 7 days
        </p>
        <div className="flex h-[84px] items-end gap-1.5">
          {analytics.daily.map((v, i) => {
            const dayLabel = ["M", "T", "W", "T", "F", "S", "S"][i] ?? "";
            const isLast = i === analytics.daily.length - 1;
            const heightPct = (v / max) * 70;
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={[
                    "w-full rounded-sm",
                    isLast
                      ? "bg-[rgb(var(--brand-primary))]"
                      : "bg-[rgb(var(--bg-sidebar)/0.25)]",
                  ].join(" ")}
                  style={{ height: `${heightPct.toFixed(1)}px` }}
                />
                <p className="font-mono text-[9.5px] text-[rgb(var(--fg-muted))]">
                  {dayLabel}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sources */}
      <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          Where they&rsquo;re coming from
        </p>
        {analytics.sources.length === 0 ? (
          <p className="text-[12px] text-[rgb(var(--fg-muted))]">No sources yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {analytics.sources.map((s) => (
              <div key={s.label}>
                <div className="mb-1 flex justify-between text-[12px]">
                  <span className="font-semibold text-[rgb(var(--fg-default))]">
                    {s.label}
                  </span>
                  <span className="font-mono text-[rgb(var(--fg-muted))] tabular-nums">
                    {String(s.count)}{" "}
                    <span className="opacity-50">· {s.pct}%</span>
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-[rgb(var(--border-subtle))]">
                  <div
                    className="h-full bg-[rgb(var(--brand-primary))]"
                    style={{ width: `${Math.min(100, s.pct).toFixed(1)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// — Inline icons (no lucide-react) —

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      aria-hidden
      width="9"
      height="9"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <path d="M6 1l1.6 3.2 3.4.5-2.5 2.4.6 3.4L6 8.9l-3.1 1.6.6-3.4L1 4.7l3.4-.5z" />
    </svg>
  );
}
