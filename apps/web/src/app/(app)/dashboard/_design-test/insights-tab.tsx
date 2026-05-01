/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Insights tab. 1:1 port of the mockup's
// InsightsTab (sample-app/index.html lines 4112-4444). Six panels:
// HeroMetrics (4 KPI tiles), PageViewsChart, ConversionFunnel,
// TopProducts, TrafficSources, BookingPipeline, QuickGlance.
//
// Wired data:
// - Hero KPIs: real revenue this month + real booking count from
//   producer.today.pulseStats. Page views + conversion are placeholder
//   (no analytics events tracked yet).
// - Booking pipeline: real bookings counts per status from
//   booking.list()
// - Top products: real product list from booking router (stub
//   bookingsThisMonth = 0; surfaces real names + prices)
// - Traffic sources, page views chart, repeat-clients quick-glance:
//   placeholder demo data (no analytics infra yet) — clearly labeled.
//
// `--brand-secondary` isn't in our CSS palette, so the rare references
// fall back to `--brand-copper` (the mockup uses both interchangeably
// and the visual reading is similar amber/orange).

import { useMemo, useState } from "react";

import { Icon } from "./primitives";

export type InsightsStats = {
  views7d: number;
  views7dDelta: number;
  bookings7d: number;
  bookings7dDelta: number;
  revenue7d: number;
  revenue7dDelta: number;
  conversion: number;
  conversionDelta: number;
  topProduct: string;
  topSource: string;
  daily: number[]; // 14 days of view counts
  sources: { label: string; pct: number; count: number }[];
};

export type InsightsBooking = {
  id: string;
  status: "inquiry" | "hold" | "booked" | "completed";
  value?: number;
};

export type InsightsProduct = {
  id: string;
  name: string;
  type: string; // mix | master | production | consult
  price: number;
  bookingsThisMonth: number;
};

type InsightsData = {
  stats: InsightsStats;
  bookings: InsightsBooking[];
  products: InsightsProduct[];
};

export function InsightsTab({ data }: { data: InsightsData }) {
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "all">("7d");

  return (
    <div
      data-screen-label="06 Insights"
      className="custom-scrollbar"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 3vw, 32px)",
        maxWidth: 1280,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <InsightsHeader range={range} setRange={setRange} />
      <HeroMetrics stats={data.stats} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
          marginTop: 16,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PageViewsChart stats={data.stats} />
          <Funnel stats={data.stats} bookings={data.bookings} />
          <TopProducts products={data.products} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TrafficSources stats={data.stats} />
          <BookingPipeline bookings={data.bookings} />
          <QuickGlance stats={data.stats} />
        </div>
      </div>
    </div>
  );
}

function InsightsHeader({
  range,
  setRange,
}: {
  range: "7d" | "30d" | "90d" | "all";
  setRange: (r: "7d" | "30d" | "90d" | "all") => void;
}) {
  return (
    <header
      className="reveal-up stagger-1"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 22,
        flexWrap: "wrap",
      }}
    >
      <div>
        <span className="label-tiny" style={{ display: "block", marginBottom: 6 }}>
          Performance
        </span>
        <h1
          className="font-syne"
          style={{
            fontSize: "clamp(34px, 4.5vw, 52px)",
            fontWeight: 800,
            letterSpacing: "-0.035em",
            margin: 0,
            lineHeight: 0.95,
          }}
        >
          Insights
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "rgb(var(--fg-muted))" }}>
          Who&apos;s looking, who&apos;s booking, what&apos;s converting.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 9,
          background: "rgb(var(--bg-elevated))",
          border: "1px solid rgb(var(--border-subtle))",
        }}
      >
        {(
          [
            { key: "7d", label: "7 days" },
            { key: "30d", label: "30 days" },
            { key: "90d", label: "90 days" },
            { key: "all", label: "All time" },
          ] as const
        ).map((r) => {
          const active = range === r.key;
          return (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "6px 11px",
                borderRadius: 6,
                fontSize: 11.5,
                fontWeight: 700,
                background: active ? "rgb(var(--bg-background))" : "transparent",
                color: active ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
                boxShadow: active ? "0 1px 2px rgba(17,16,9,0.04)" : "none",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

function HeroMetrics({ stats }: { stats: InsightsStats }) {
  type Tile = {
    label: string;
    value: string;
    delta: number;
    icon: string;
    tone?: "success";
    deltaUnit?: string;
  };
  const tiles: Tile[] = [
    {
      label: "Page views",
      value: stats.views7d.toLocaleString(),
      delta: stats.views7dDelta,
      icon: "eye",
    },
    {
      label: "Bookings",
      value: String(stats.bookings7d),
      delta: stats.bookings7dDelta,
      icon: "check-circle-2",
    },
    {
      label: "Revenue",
      value: "$" + stats.revenue7d.toLocaleString(),
      delta: stats.revenue7dDelta,
      icon: "wallet",
      tone: "success",
      deltaUnit: "%",
    },
    {
      label: "Conversion",
      value: `${String(stats.conversion)}%`,
      delta: stats.conversionDelta,
      icon: "trending-up",
      deltaUnit: "pp",
    },
  ];
  return (
    <div
      className="reveal-up stagger-2"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 12,
      }}
    >
      {tiles.map((t) => (
        <div key={t.label} className="surface-card" style={{ padding: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgb(var(--fg-muted))",
              }}
            >
              <Icon name={t.icon} size={13} />
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgb(var(--fg-muted))",
              }}
            >
              {t.label}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div
              className="tabular"
              style={{
                fontFamily: "Syne",
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: "-0.025em",
                color:
                t.tone === "success"
                  ? "rgb(var(--fg-success))"
                  : "rgb(var(--fg-default))",
                lineHeight: 1,
              }}
            >
              {t.value}
            </div>
            <span
              style={{
                fontSize: 11.5,
                fontFamily: "JetBrains Mono",
                fontWeight: 700,
                color:
                  t.delta >= 0
                    ? "rgb(var(--fg-success))"
                    : "rgb(var(--fg-danger))",
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              <Icon
                name={t.delta >= 0 ? "arrow-up-right" : "arrow-down-right"}
                size={11}
              />
              {Math.abs(t.delta)}
              {t.deltaUnit}
            </span>
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "rgb(var(--fg-faint))",
              marginTop: 6,
            }}
          >
            vs. previous 7 days
          </div>
        </div>
      ))}
    </div>
  );
}

function PageViewsChart({ stats }: { stats: InsightsStats }) {
  const data = stats.daily;
  const max = Math.max(...data, 1) * 1.15;
  const w = 100;
  const h = 40;
  const step = w / Math.max(data.length - 1, 1);
  const path = data
    .map((v, i) => {
      const x = i * step;
      const y = h - (v / max) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `${path} L ${String(w)} ${String(h)} L 0 ${String(h)} Z`;

  const total = data.reduce((s, n) => s + n, 0);
  const peak = Math.max(...data, 0);
  const peakIdx = data.indexOf(peak);

  return (
    <div className="surface-card" style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontFamily: "Syne",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Page views
          </h3>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 11.5,
              color: "rgb(var(--fg-muted))",
            }}
          >
            {data.length} days · {total.toLocaleString()} total · peak {peak} on
            day {peakIdx + 1}
          </p>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          <Legend swatch="rgb(var(--brand-primary))" label="Views" />
          <Legend swatch="rgb(var(--brand-copper))" label="Bookings" dot />
        </div>
      </div>

      <div style={{ position: "relative", height: 200 }}>
        <svg
          viewBox={`0 0 ${String(w)} ${String(h)}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <linearGradient id="ins-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(217 119 6)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="rgb(217 119 6)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1="0"
              x2={w}
              y1={h * t}
              y2={h * t}
              stroke="rgb(var(--border-subtle))"
              strokeWidth="0.2"
            />
          ))}
          <path d={area} fill="url(#ins-area)" />
          <path
            d={path}
            fill="none"
            stroke="rgb(217 119 6)"
            strokeWidth="0.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {data.map((v, i) => {
            const x = i * step;
            const y = h - (v / max) * h;
            const isPeak = i === peakIdx;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={isPeak ? 1.0 : 0.6}
                fill={isPeak ? "rgb(217 119 6)" : "#fff"}
                stroke="rgb(217 119 6)"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: 9.5,
            fontFamily: "JetBrains Mono",
            color: "rgb(var(--fg-faint))",
          }}
        >
          {data.map((_, i) =>
            i % 2 === 0 || i === data.length - 1 ? (
              <span key={i} style={{ width: 18, textAlign: "center" }}>
                D{i + 1}
              </span>
            ) : (
              <span key={i} style={{ width: 18 }} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function Legend({
  swatch,
  label,
  dot,
}: {
  swatch: string;
  label: string;
  dot?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        color: "rgb(var(--fg-muted))",
      }}
    >
      {dot ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: swatch,
            outline: "2px solid rgb(var(--bg-background))",
          }}
        />
      ) : (
        <span style={{ width: 14, height: 3, borderRadius: 2, background: swatch }} />
      )}
      {label}
    </span>
  );
}

function Funnel({
  stats,
  bookings,
}: {
  stats: InsightsStats;
  bookings: InsightsBooking[];
}) {
  const total = stats.daily.reduce((s, n) => s + n, 0);
  const productClicks = Math.round(total * 0.42);
  const inquiries = bookings.length;
  const booked = bookings.filter(
    (b) => b.status === "booked" || b.status === "completed",
  ).length;

  const steps = [
    { label: "Page views", n: total, tone: "#d97706" },
    { label: "Product clicks", n: productClicks, tone: "#c2410c" },
    { label: "Inquiries", n: inquiries, tone: "#9a3412" },
    { label: "Booked", n: booked, tone: "#7c2d12" },
  ] as const;
  const max = steps[0].n;

  return (
    <div className="surface-card" style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontFamily: "Syne",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Conversion funnel
          </h3>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 11.5,
              color: "rgb(var(--fg-muted))",
            }}
          >
            Where visitors drop off, where they book.
          </p>
        </div>
        <span
          className="tabular"
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: "rgb(var(--fg-muted))",
          }}
        >
          view → book:{" "}
          <strong style={{ color: "rgb(var(--fg-default))" }}>
            {((booked / Math.max(max, 1)) * 100).toFixed(1)}%
          </strong>
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((s, i) => {
          const pct = (s.n / Math.max(max, 1)) * 100;
          const prev = steps[i - 1]?.n ?? 0;
          const conv = i === 0 ? null : ((s.n / Math.max(prev, 1)) * 100).toFixed(1);
          return (
            <div key={s.label}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "rgb(var(--fg-default))",
                  }}
                >
                  {s.label}
                </span>
                <span
                  className="tabular"
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 11,
                    color: "rgb(var(--fg-muted))",
                  }}
                >
                  <strong style={{ color: "rgb(var(--fg-default))" }}>
                    {s.n.toLocaleString()}
                  </strong>
                  {conv && <span style={{ marginLeft: 8 }}>→ {conv}% from prev</span>}
                </span>
              </div>
              <div
                style={{
                  height: 26,
                  borderRadius: 6,
                  background: "rgb(var(--bg-elevated))",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: `${pct.toFixed(1)}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${s.tone}, ${s.tone}cc)`,
                    borderRadius: 6,
                    transition: "width 400ms ease-out",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 10,
                  }}
                >
                  <span
                    className="tabular"
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                    }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopProducts({ products }: { products: InsightsProduct[] }) {
  const perf = useMemo(
    () =>
      products
        .map((p) => ({
          ...p,
          count: p.bookingsThisMonth,
          revenue: p.bookingsThisMonth * p.price,
        }))
        .sort((a, b) => b.revenue - a.revenue),
    [products],
  );
  const top = Math.max(...perf.map((p) => p.revenue), 1);
  const grad = (type: string): string =>
    ({
      mix: "#d97706",
      master: "#c2410c",
      production: "#059669",
      consult: "#475569",
    } as Record<string, string>)[type] ?? "#475569";

  return (
    <div className="surface-card" style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontFamily: "Syne",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Top products
          </h3>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 11.5,
              color: "rgb(var(--fg-muted))",
            }}
          >
            By revenue this month
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {perf.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: "grid",
              gridTemplateColumns: "24px minmax(0, 1.4fr) minmax(0, 2fr) auto",
              gap: 12,
              alignItems: "center",
            }}
          >
            <span
              className="tabular"
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 11,
                fontWeight: 700,
                color: "rgb(var(--fg-faint))",
                textAlign: "right",
              }}
            >
              #{i + 1}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                className="truncate"
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "rgb(var(--fg-default))",
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "rgb(var(--fg-muted))",
                  fontFamily: "JetBrains Mono",
                  marginTop: 1,
                }}
              >
                {p.count} bookings · ${p.price}
              </div>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: "rgb(var(--bg-elevated))",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${((p.revenue / top) * 100).toFixed(1)}%`,
                  height: "100%",
                  background: grad(p.type),
                  borderRadius: 4,
                  transition: "width 400ms ease-out",
                }}
              />
            </div>
            <span
              className="tabular"
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 12,
                fontWeight: 700,
                color: "rgb(var(--fg-default))",
                textAlign: "right",
                minWidth: 60,
              }}
            >
              ${p.revenue.toLocaleString()}
            </span>
          </div>
        ))}
        {perf.length === 0 && (
          <div
            style={{
              padding: 14,
              fontSize: 12,
              color: "rgb(var(--fg-muted))",
              textAlign: "center",
            }}
          >
            No products yet.
          </div>
        )}
      </div>
    </div>
  );
}

function TrafficSources({ stats }: { stats: InsightsStats }) {
  return (
    <div className="surface-card" style={{ padding: 18 }}>
      <h3
        style={{
          margin: "0 0 4px",
          fontFamily: "Syne",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        Traffic sources
      </h3>
      <p style={{ margin: "0 0 12px", fontSize: 11, color: "rgb(var(--fg-muted))" }}>
        Where artists found you
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {stats.sources.map((s) => (
          <div key={s.label}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 3,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</span>
              <span
                className="tabular"
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 11,
                  color: "rgb(var(--fg-muted))",
                }}
              >
                {s.pct}% · {s.count}
              </span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: "rgb(var(--bg-elevated))",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${String(s.pct)}%`,
                  height: "100%",
                  background: "rgb(var(--brand-copper))",
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingPipeline({ bookings }: { bookings: InsightsBooking[] }) {
  const stages = [
    { key: "inquiry", label: "Inquiry", icon: "message-square", dot: "rgb(var(--brand-primary))" },
    { key: "hold", label: "Hold", icon: "clock", dot: "rgb(var(--fg-warning))" },
    { key: "booked", label: "Booked", icon: "check-circle-2", dot: "rgb(var(--fg-success))" },
    { key: "completed", label: "Completed", icon: "archive", dot: "rgb(var(--fg-faint))" },
  ] as const;
  const value = bookings.reduce((s, b) => s + (b.value ?? 0), 0);

  return (
    <div className="surface-card" style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontFamily: "Syne",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Booking pipeline
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgb(var(--fg-muted))" }}>
            Live status · manage in Projects
          </p>
        </div>
        <span
          className="tabular"
          style={{
            fontFamily: "Syne",
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "-0.02em",
          }}
        >
          ${value.toLocaleString()}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {stages.map((s) => {
          const n = bookings.filter((b) => b.status === s.key).length;
          return (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 8px",
                borderRadius: 7,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  background: s.dot,
                  flexShrink: 0,
                }}
              />
              <Icon name={s.icon} size={12} style={{ color: "rgb(var(--fg-muted))" }} />
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "rgb(var(--fg-default))",
                }}
              >
                {s.label}
              </span>
              <span
                className="tabular"
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "rgb(var(--fg-default))",
                }}
              >
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickGlance({ stats }: { stats: InsightsStats }) {
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    ["Top product", stats.topProduct, "package"],
    ["Top source", stats.topSource, "compass"],
    ["Repeat clients", "—", "repeat"],
    ["Avg booking value", "—", "banknote"],
    ["Avg time-to-book", "—", "clock"],
  ];
  return (
    <div className="surface-card" style={{ padding: 18 }}>
      <h3
        style={{
          margin: "0 0 4px",
          fontFamily: "Syne",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        At a glance
      </h3>
      <p style={{ margin: "0 0 10px", fontSize: 11, color: "rgb(var(--fg-muted))" }}>
        This month
      </p>
      <div>
        {rows.map(([label, value, icon], i) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderTop: i === 0 ? "none" : "1px dashed rgb(var(--border-subtle))",
            }}
          >
            <Icon name={icon} size={12} style={{ color: "rgb(var(--fg-faint))" }} />
            <span style={{ fontSize: 11.5, color: "rgb(var(--fg-muted))", flex: 1 }}>
              {label}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "rgb(var(--fg-default))",
                textAlign: "right",
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
