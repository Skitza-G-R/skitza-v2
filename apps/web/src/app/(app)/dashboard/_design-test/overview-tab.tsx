"use client";

// Skitza Design Test — Overview tab. 1:1 port of the mockup's tabs/overview.jsx
// (sample-app.html lines 1316-1509). Layout `default` only; `finance-hero` and
// `rail` variants are skipped this round (Gili wants the default canvas).
//
// Wired-logic tweaks:
// - `d.producer.publicLink` → real producer slug → ${publicBaseUrl}/join/${slug}
// - `d.projects` → real `project.list()` rows, mapped to mockup shape with a
//   synthesized `tagType` (danger/warning/neutral/success) derived from stage
// - `d.tracks` → real `producer.today().recentUploads`, mapped to mockup shape
// - `d.clients` → derived from real overdue invoices when present, else null
// - `onPlay` is a no-op for now (no audio player wired on this test surface)
// - `onNav('projects', id)` → router.push to the existing /dashboard/projects
//   route (deep-linking to a specific project requires a brief from Raz).
//
// Throwaway sandbox — never merges to main.

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  Icon,
  PlayCircle,
  ProjectBadge,
  StatusPill,
  fmtMoney,
} from "./primitives";

export type OverviewProject = {
  id: string;
  name: string;
  client: string;
  status: string;
  tag: string;
  tagType: "danger" | "warning" | "neutral" | "success" | "brand";
  grad: string;
};

export type OverviewTrack = {
  id: string;
  title: string;
  project: string;
  uploaded: string;
  duration: string;
};

export type OverviewClient = {
  id: string;
  name: string;
  balance: number;
};

export type OverviewProducer = {
  publicLink: string; // e.g. "skitza.app/p/gili"
  publicLinkSlug: string; // the slug part shown in amber: "gili"
  publicLinkPrefix: string; // the dim part: "skitza.app/p/"
  earnedMonth: number;
  outstanding: number;
  earnedDelta: number; // integer percentage
  outstandingClientCount: number; // for "Across N clients" copy
  greetingName: string; // first name for "Good morning, Gili."
  todayDate: string; // pre-formatted display string e.g. "May 1, 2026"
};

export type OverviewData = {
  producer: OverviewProducer;
  projects: OverviewProject[];
  tracks: OverviewTrack[];
  overdueClient: OverviewClient | null;
};

type OverviewTabProps = { data: OverviewData };

export function OverviewTab({ data }: OverviewTabProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const d = data;
  const urgent = d.projects
    .filter((p) => p.tagType === "danger" || p.tagType === "warning")
    .slice(0, 3);
  const recent = d.tracks.slice(0, 3);
  const overdue = d.overdueClient;

  const copy = () => {
    void navigator.clipboard?.writeText(d.producer.publicLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // The mockup's onNav('projects', id) drilled into a project room. With
  // Option A routing we route to the projects list page; per-project deep
  // links land in a follow-up brief.
  const navProjects = () => router.push("/dashboard/projects");

  const LinkBlock = (
    <div
      className="reveal-up stagger-2"
      style={{
        position: "relative",
        overflow: "hidden",
        background: "rgb(var(--bg-sidebar))",
        borderRadius: 18,
        padding: 18,
        color: "#fff",
        border: "1px solid rgb(var(--border-sidebar))",
      }}
    >
      <div className="animate-shine" />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon
              name="link-2"
              size={18}
              style={{ color: "rgb(var(--brand-primary))" }}
              strokeWidth={2.4}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "rgba(255,255,255,0.45)",
                marginBottom: 2,
              }}
            >
              Your Public Link
            </div>
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.55)",
                lineHeight: 1.3,
              }}
            >
              Artists listen, book, and pay automatically.
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 6,
            borderRadius: 12,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              padding: "0 12px",
              fontSize: 13.5,
              fontFamily: "JetBrains Mono",
              fontWeight: 500,
            }}
          >
            <span style={{ color: "rgba(255,255,255,0.32)" }}>
              {d.producer.publicLinkPrefix}
            </span>
            <span style={{ color: "#fff" }}>{d.producer.publicLinkSlug}</span>
          </div>
          <button
            onClick={copy}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              background: copied
                ? "rgb(var(--fg-success))"
                : "rgb(var(--brand-primary))",
              color: copied ? "#fff" : "#111009",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={13} strokeWidth={2.6} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );

  const UrgentCard: ReactNode = (
    <Card
      title="Urgent Projects"
      icon={<Icon name="alert-circle" size={14} />}
      action={
        <button
          onClick={navProjects}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "rgb(var(--fg-muted))",
          }}
          className="sk-pop"
        >
          View all →
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {urgent.map((p) => (
          <button
            key={p.id}
            onClick={navProjects}
            className="sk-row"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderRadius: 12,
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                minWidth: 0,
                flex: 1,
              }}
            >
              <ProjectBadge grad={p.grad} size={36} rounded={10} />
              <div style={{ minWidth: 0, textAlign: "left" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 2,
                  }}
                >
                  <span
                    className="truncate"
                    style={{
                      fontSize: 13.5,
                      fontWeight: 700,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {p.name}
                  </span>
                  <StatusPill tagType={p.tagType} label={p.tag} />
                </div>
                <div
                  className="truncate"
                  style={{ fontSize: 12, color: "rgb(var(--fg-muted))" }}
                >
                  {p.client}
                  <span style={{ margin: "0 6px", opacity: 0.4 }}>•</span>
                  {p.status}
                </div>
              </div>
            </div>
            <Icon
              name="chevron-right"
              size={16}
              className="sk-pop"
              style={{ color: "rgb(var(--fg-faint))" }}
            />
          </button>
        ))}
        {urgent.length === 0 && (
          // Mockup has no empty state for this card; we add a neutral
          // placeholder so the page doesn't render an empty card. Visual
          // weight matches a single row so the layout doesn't shift.
          <div
            style={{
              padding: "14px",
              fontSize: 12.5,
              color: "rgb(var(--fg-muted))",
              textAlign: "center",
            }}
          >
            No urgent projects right now.
          </div>
        )}
      </div>
    </Card>
  );

  const RecentCard: ReactNode = (
    <Card
      title="Recent Uploads"
      icon={<Icon name="activity" size={14} />}
      action={
        <button
          onClick={() => router.push("/dashboard/music")}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "rgb(var(--fg-muted))",
          }}
        >
          Library →
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {recent.map((t) => (
          <div
            key={t.id}
            className="sk-row"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 14px",
              borderRadius: 12,
              gap: 12,
            }}
          >
            <PlayCircle size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="truncate"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                }}
              >
                {t.title}
              </div>
              <div
                className="truncate"
                style={{
                  fontSize: 11.5,
                  color: "rgb(var(--fg-muted))",
                  marginTop: 2,
                }}
              >
                {t.project}
              </div>
            </div>
            <div
              style={{
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 2,
              }}
            >
              <span className="label-tiny">Uploaded</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{t.uploaded}</span>
            </div>
            <div
              style={{
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 2,
                marginLeft: 16,
              }}
            >
              <span className="label-tiny">Duration</span>
              <span
                className="tabular"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: "JetBrains Mono",
                }}
              >
                {t.duration}
              </span>
            </div>
          </div>
        ))}
        {recent.length === 0 && (
          <div
            style={{
              padding: "14px",
              fontSize: 12.5,
              color: "rgb(var(--fg-muted))",
              textAlign: "center",
            }}
          >
            No recent uploads yet.
          </div>
        )}
      </div>
    </Card>
  );

  const FinanceCard: ReactNode = (
    <Card
      title="Financial Pulse"
      icon={<Icon name="dollar-sign" size={14} />}
      action={<span className="label-tiny">This month</span>}
    >
      <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap" }}>
        <div
          style={{
            flex: 1,
            minWidth: 200,
            padding: "12px 16px",
            borderRight: "1px solid rgb(var(--border-subtle) / 0.7)",
            position: "relative",
          }}
        >
          <div className="label-tiny" style={{ marginBottom: 8 }}>
            Earned this month
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div
              className="tabular"
              style={{
                fontSize: 32,
                fontWeight: 800,
                fontFamily: "JetBrains Mono",
                letterSpacing: "-0.02em",
              }}
            >
              ${d.producer.earnedMonth.toLocaleString()}
            </div>
            <span className="pill pill-success" style={{ fontSize: 10 }}>
              <Icon name="trending-up" size={10} strokeWidth={3} />
              {d.producer.earnedDelta}%
            </span>
          </div>
          <svg
            width="100"
            height="22"
            viewBox="0 0 100 22"
            style={{ position: "absolute", right: 14, bottom: 12, opacity: 0.5 }}
          >
            <path
              d="M0,18 L18,14 L34,16 L50,8 L66,12 L82,4 L100,2"
              fill="none"
              stroke="rgb(var(--fg-success))"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 200,
            padding: "12px 16px",
            borderRight: "1px solid rgb(var(--border-subtle) / 0.7)",
          }}
        >
          <div className="label-tiny" style={{ marginBottom: 8 }}>
            Outstanding
          </div>
          <div
            className="tabular"
            style={{
              fontSize: 32,
              fontWeight: 800,
              fontFamily: "JetBrains Mono",
              letterSpacing: "-0.02em",
            }}
          >
            ${d.producer.outstanding.toLocaleString()}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "rgb(var(--fg-muted))",
              marginTop: 4,
            }}
          >
            Across {d.producer.outstandingClientCount} clients
          </div>
        </div>
        {overdue && (
          <div style={{ flex: 1, minWidth: 220, padding: "12px 16px" }}>
            <div className="label-tiny" style={{ marginBottom: 8 }}>
              Needs follow-up
            </div>
            <button
              onClick={navProjects}
              className="sk-row"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgb(var(--fg-danger) / 0.06)",
                border: "1px solid rgb(var(--fg-danger) / 0.2)",
                width: "calc(100% - 4px)",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ position: "relative", width: 10, height: 10 }}>
                  <span
                    className="ping-dot"
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      background: "rgb(var(--fg-danger))",
                      opacity: 0.5,
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      background: "rgb(var(--fg-danger))",
                    }}
                  />
                </span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{overdue.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgb(var(--fg-danger))",
                    }}
                  >
                    Overdue invoice
                  </div>
                </div>
              </div>
              <span
                className="tabular"
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  fontFamily: "JetBrains Mono",
                  color: "rgb(var(--fg-danger))",
                }}
              >
                {fmtMoney(overdue.balance)}
              </span>
            </button>
          </div>
        )}
      </div>
    </Card>
  );

  const Header = (
    <header
      className="reveal-up stagger-1"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
        flexWrap: "wrap",
      }}
    >
      <div>
        <span className="pill pill-success" style={{ marginBottom: 12 }}>
          <span style={{ position: "relative", width: 8, height: 8 }}>
            <span
              className="ping-dot"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: "rgb(var(--fg-success))",
                opacity: 0.5,
              }}
            />
            <span
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: "rgb(var(--fg-success))",
              }}
            />
          </span>
          Accepting Sessions
        </span>
        <h1
          className="font-syne"
          style={{
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            margin: "6px 0 4px",
            lineHeight: 1,
          }}
        >
          Good morning, {d.producer.greetingName}.
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "rgb(var(--fg-muted))" }}>
          Here is the pulse of your studio today.
        </p>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 10,
          background: "rgb(var(--bg-elevated))",
          border: "1px solid rgb(var(--border-subtle))",
          fontSize: 12.5,
          fontWeight: 600,
          color: "rgb(var(--fg-muted))",
        }}
      >
        <Icon
          name="clock"
          size={14}
          style={{ color: "rgb(var(--brand-primary))" }}
          strokeWidth={2.4}
        />
        {d.producer.todayDate}
      </div>
    </header>
  );

  // Default — landing-style two-column with link-strip hero. Mockup line 1494.
  return (
    <div
      data-screen-label="01 Overview · Default"
      className="custom-scrollbar"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 3vw, 32px)",
        maxWidth: 1180,
        margin: "0 auto",
        width: "100%",
      }}
    >
      {Header}
      <div style={{ marginBottom: 14 }}>{LinkBlock}</div>
      <div
        className="reveal-up stagger-3"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 14,
          marginBottom: 14,
        }}
      >
        {UrgentCard}
        {RecentCard}
      </div>
      <div className="reveal-up stagger-4">{FinanceCard}</div>
    </div>
  );
}
