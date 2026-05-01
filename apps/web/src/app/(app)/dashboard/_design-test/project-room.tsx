/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Project Room (drill-down). 1:1 port of the
// mockup's ProjectRoom + sub-tab components (sample-app/index.html lines
// 1841-2186). Five sub-tabs: Overview / Songs / Files / Payments /
// Activity. Files & Activity show real-data placeholders (we don't
// have file storage or an event log yet) — empty states match the
// mockup's tone.
//
// Wired logic (vs the mockup's internal song/track switching):
// - Back button → router.push("/dashboard/projects")
// - Song-row click is a no-op for now; the SongPage is wired in the
//   Music Library round.
// - Play button is a no-op (audio context lands in a later round).
// - Action buttons (Send invoice, Schedule session, etc.) emit
//   navigation hints to the existing Skitza routes when relevant; the
//   rest are visible but inert.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { BackButton, Breadcrumbs } from "./nav-chrome";
import {
  Avatar,
  Card,
  EqBars,
  Icon,
  KebabMenu,
  PlayCircle,
  StatusPill,
  fmtMoney,
} from "./primitives";
import type { MockupTagType } from "./data-mapping";

export type ProjectRoomProject = {
  id: string;
  name: string;
  client: string;
  stage: string;
  tag: string;
  tagType: MockupTagType;
  grad: string;
  progress: number;
  paid: number;
  total: number;
  songs: number;
  sessions: number;
  deadline: string;
  deadlineDays: number;
};

export type ProjectRoomTrack = {
  id: string;
  title: string;
  version: string;
  duration: string;
  bpm: number | null;
  mkey: string | null;
  uploaded: string;
  comments: number;
};

export type ActivityEvent = {
  icon: string;
  text: string;
  when: string;
  who: string;
};

type ProjectRoomData = {
  project: ProjectRoomProject;
  tracks: ProjectRoomTrack[];
  activity: ActivityEvent[];
};

export function ProjectRoom({ data }: { data: ProjectRoomData }) {
  const router = useRouter();
  const p = data.project;
  const tracks = data.tracks;
  const [tab, setTab] = useState<
    "overview" | "songs" | "files" | "payments" | "activity"
  >("overview");
  const [hoverTrack, setHoverTrack] = useState<string | null>(null);
  const balance = p.total - p.paid;
  const overdue = p.deadlineDays < 0;

  const tabs = [
    { key: "overview" as const, label: "Overview", icon: "layout-grid" },
    { key: "songs" as const, label: `Songs (${String(tracks.length)})`, icon: "music" },
    { key: "files" as const, label: "Files", icon: "folder" },
    { key: "payments" as const, label: "Payments", icon: "dollar-sign" },
    { key: "activity" as const, label: "Activity", icon: "activity" },
  ];

  const goBack = () => router.push("/dashboard/projects");

  return (
    <div
      data-screen-label={`02b Project Room — ${p.name}`}
      className="custom-scrollbar"
      style={{ flex: 1, overflowY: "auto" }}
    >
      {/* Hero header */}
      <div
        className={p.grad}
        style={{
          padding:
            "clamp(20px, 3vw, 28px) clamp(16px, 3vw, 32px) 18px",
          position: "relative",
          color: "#fff",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            <BackButton onClick={goBack} label="All Projects" />
            <Breadcrumbs
              items={[
                { label: "Clients & Projects", onClick: goBack },
                { label: p.name, current: true },
              ]}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                width: 110,
                height: 110,
                borderRadius: 16,
                background: "rgba(0,0,0,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
                flexShrink: 0,
              }}
            >
              <Icon name="folder" size={42} strokeWidth={1.6} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  opacity: 0.78,
                }}
              >
                Project · {p.stage}
              </span>
              <h1
                className="font-syne"
                style={{
                  fontSize: "clamp(28px, 4vw, 48px)",
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  margin: "4px 0 8px",
                  lineHeight: 1,
                  textShadow: "0 2px 14px rgba(0,0,0,0.18)",
                }}
              >
                {p.name}
              </h1>
              <div
                style={{
                  fontSize: 13,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  alignItems: "center",
                  opacity: 0.92,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Icon name="user" size={12} />
                  {p.client}
                </span>
                <span>·</span>
                <span>
                  {tracks.length} {tracks.length === 1 ? "song" : "songs"}
                </span>
                <span>·</span>
                <span>{p.sessions} sessions</span>
                <span>·</span>
                <span
                  className="tabular"
                  style={{ fontFamily: "JetBrains Mono", fontWeight: 600 }}
                >
                  ${p.total.toLocaleString()}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {tracks[0] && (
                <button
                  className="sk-pop"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: "11px 18px",
                    borderRadius: 24,
                    background: "#fff",
                    color: "#111009",
                    fontSize: 13,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    boxShadow: "0 6px 18px rgba(0,0,0,0.24)",
                  }}
                >
                  <Icon name="play" size={14} /> Play latest
                </button>
              )}
              <button
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "11px 14px",
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.16)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  border: "1px solid rgba(255,255,255,0.28)",
                }}
              >
                <Icon name="share-2" size={14} /> Share
              </button>
              <KebabMenu
                items={[
                  { label: "Edit project", icon: "edit-3" },
                  { label: "Send invoice", icon: "file-text" },
                  { label: "Schedule session", icon: "calendar" },
                  { label: "Add collaborator", icon: "user-plus" },
                  { label: "Duplicate", icon: "copy" },
                  { label: "Archive", icon: "archive" },
                  { label: "Delete", icon: "trash-2", danger: true },
                ]}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(16px, 3vw, 28px)" }}>
        {/* Status strip */}
        <div
          className="reveal-up stagger-1"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <RoomStatTile
            label="Status"
            value={<StatusPill tagType={p.tagType} label={p.tag} />}
          />
          <RoomStatTile
            label="Progress"
            value={`${String(p.progress)}%`}
            mono
            trend={
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "rgb(var(--border-subtle))",
                  marginTop: 6,
                }}
              >
                <div
                  style={{
                    width: `${String(p.progress)}%`,
                    height: "100%",
                    background: "rgb(var(--fg-default))",
                    borderRadius: 2,
                  }}
                />
              </div>
            }
          />
          <RoomStatTile
            label="Deadline"
            value={
              overdue
                ? `${String(Math.abs(p.deadlineDays))}d late`
                : p.deadline
            }
            mono
            accent={overdue ? "danger" : p.deadlineDays < 7 ? "warning" : null}
          />
          <RoomStatTile
            label="Outstanding"
            value={balance > 0 ? fmtMoney(balance) : "Settled"}
            mono
            accent={balance > 0 ? "danger" : "success"}
          />
        </div>

        {/* Tabs */}
        <nav
          className="reveal-up stagger-2"
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 14,
            padding: 4,
            borderRadius: 10,
            background: "rgb(var(--bg-elevated))",
            border: "1px solid rgb(var(--border-subtle))",
            overflowX: "auto",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "8px 14px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                background:
                  tab === t.key
                    ? "rgb(var(--bg-background))"
                    : "transparent",
                color:
                  tab === t.key
                    ? "rgb(var(--fg-default))"
                    : "rgb(var(--fg-muted))",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <Icon name={t.icon} size={12} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="reveal-up stagger-3">
          {tab === "overview" && (
            <RoomOverviewTab project={p} tracks={tracks} setTab={setTab} />
          )}
          {tab === "songs" && (
            <RoomSongsTab
              tracks={tracks}
              hoverTrack={hoverTrack}
              setHoverTrack={setHoverTrack}
            />
          )}
          {tab === "files" && <RoomFilesTab />}
          {tab === "payments" && <RoomPaymentsTab project={p} />}
          {tab === "activity" && (
            <RoomActivityTab events={data.activity} />
          )}
        </div>
      </div>
    </div>
  );
}

function RoomStatTile({
  label,
  value,
  mono,
  accent,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: "danger" | "warning" | "success" | null;
  trend?: React.ReactNode;
}) {
  const accents: Record<
    "danger" | "warning" | "success",
    { color: string; bg: string; border: string }
  > = {
    danger: {
      color: "rgb(var(--fg-danger))",
      bg: "rgb(var(--fg-danger) / 0.06)",
      border: "rgb(var(--fg-danger) / 0.2)",
    },
    warning: {
      color: "rgb(var(--fg-warning))",
      bg: "rgb(var(--fg-warning) / 0.06)",
      border: "rgb(var(--fg-warning) / 0.2)",
    },
    success: {
      color: "rgb(var(--fg-success))",
      bg: "rgb(var(--fg-success) / 0.06)",
      border: "rgb(var(--fg-success) / 0.2)",
    },
  };
  const a = accent ? accents[accent] : null;
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        background: a ? a.bg : "rgb(var(--bg-elevated))",
        border: `1px solid ${a ? a.border : "rgb(var(--border-subtle))"}`,
      }}
    >
      <div className="label-tiny" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div
        className={mono ? "tabular" : ""}
        style={{
          fontSize: 17,
          fontWeight: 800,
          letterSpacing: "-0.015em",
          fontFamily: mono ? "JetBrains Mono" : "inherit",
          color: a ? a.color : "rgb(var(--fg-default))",
        }}
      >
        {value}
      </div>
      {trend}
    </div>
  );
}

function RoomOverviewTab({
  project,
  tracks,
  setTab,
}: {
  project: ProjectRoomProject;
  tracks: ProjectRoomTrack[];
  setTab: (k: "overview" | "songs" | "files" | "payments" | "activity") => void;
}) {
  const stages = [
    "Brief & Intake",
    "Production",
    "Mixing",
    "Review",
    "Mastering",
    "Delivery",
  ];
  const stageIdx = Math.min(
    stages.length - 1,
    Math.floor((project.progress / 100) * stages.length),
  );
  const clientInitials = project.client
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      <Card
        title="Workflow"
        icon={<Icon name="check-circle" size={14} />}
        action={
          <button
            onClick={() => setTab("activity")}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgb(var(--fg-muted))",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            History
          </button>
        }
      >
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {stages.map((stage, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <div
                key={stage}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: active
                    ? "rgb(var(--brand-primary) / 0.08)"
                    : "transparent",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: done
                      ? "rgb(var(--fg-success))"
                      : active
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--border-subtle))",
                    color: done || active ? "#fff" : "rgb(var(--fg-muted))",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {done ? <Icon name="check" size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                    color:
                      done || active
                        ? "rgb(var(--fg-default))"
                        : "rgb(var(--fg-muted))",
                  }}
                >
                  {stage}
                </span>
                {active && (
                  <span className="pill pill-brand" style={{ fontSize: 9 }}>
                    NOW
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Latest songs"
        icon={<Icon name="music" size={14} />}
        action={
          <button
            onClick={() => setTab("songs")}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 700,
              color: "rgb(var(--fg-muted))",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            See all
          </button>
        }
      >
        <div style={{ padding: 4 }}>
          {tracks.slice(0, 3).map((t) => (
            <div
              key={t.id}
              className="sk-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <PlayCircle size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 12.5, fontWeight: 700 }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 10.5, color: "rgb(var(--fg-muted))" }}>
                  {t.version} · {t.uploaded}
                </div>
              </div>
              <span
                className="tabular"
                style={{
                  fontSize: 10.5,
                  fontFamily: "JetBrains Mono",
                  color: "rgb(var(--fg-muted))",
                }}
              >
                {t.duration}
              </span>
            </div>
          ))}
          {tracks.length === 0 && (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                color: "rgb(var(--fg-muted))",
                fontSize: 12,
              }}
            >
              No songs uploaded yet.
            </div>
          )}
        </div>
      </Card>

      <Card title="Client & collaborators" icon={<Icon name="users" size={14} />}>
        <div style={{ padding: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 10px",
              marginBottom: 4,
            }}
          >
            <Avatar initials={clientInitials} grad="grad-slate" size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{project.client}</div>
              <div style={{ fontSize: 10.5, color: "rgb(var(--fg-muted))" }}>Owner</div>
            </div>
            <button
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "6px 10px",
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 600,
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
              }}
            >
              Message
            </button>
          </div>
          <button
            className="sk-pop sk-row"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderRadius: 8,
              color: "rgb(var(--fg-muted))",
              fontSize: 12,
              width: "100%",
              boxSizing: "border-box",
              border: "1px dashed rgb(var(--border-strong))",
            }}
          >
            <Icon name="user-plus" size={13} /> Invite collaborator
          </button>
        </div>
      </Card>
    </div>
  );
}

function RoomSongsTab({
  tracks,
  hoverTrack,
  setHoverTrack,
}: {
  tracks: ProjectRoomTrack[];
  hoverTrack: string | null;
  setHoverTrack: (id: string | null) => void;
}) {
  if (tracks.length === 0) {
    return (
      <Card padded={false}>
        <div style={{ padding: 60, textAlign: "center" }}>
          <Icon
            name="music"
            size={32}
            style={{ color: "rgb(var(--fg-faint))", marginBottom: 10 }}
          />
          <div style={{ fontSize: 14, fontWeight: 700 }}>No songs yet</div>
          <div style={{ fontSize: 12, color: "rgb(var(--fg-muted))", marginTop: 4 }}>
            Upload your first track to get started.
          </div>
          <button
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              marginTop: 14,
              padding: "9px 16px",
              borderRadius: 9,
              background: "rgb(var(--brand-primary))",
              color: "#111009",
              fontSize: 12.5,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="upload" size={13} /> Upload track
          </button>
        </div>
      </Card>
    );
  }
  return (
    <Card padded={false}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "36px minmax(0,2fr) 80px 80px 80px 36px",
          alignItems: "center",
          gap: 14,
          padding: "10px 18px",
          borderBottom: "1px solid rgb(var(--border-subtle))",
          background: "rgb(var(--bg-elevated))",
        }}
      >
        <span
          className="label-tiny"
          style={{ textAlign: "center", color: "rgb(var(--fg-faint))" }}
        >
          #
        </span>
        <span className="label-tiny">Title</span>
        <span className="label-tiny" style={{ textAlign: "right" }}>
          Version
        </span>
        <span className="label-tiny" style={{ textAlign: "right" }}>
          Notes
        </span>
        <span className="label-tiny" style={{ textAlign: "right" }}>
          Length
        </span>
        <span></span>
      </div>
      {tracks.map((t, i) => {
        const hovered = hoverTrack === t.id;
        return (
          <div
            key={t.id}
            className="sk-row"
            onMouseEnter={() => setHoverTrack(t.id)}
            onMouseLeave={() => setHoverTrack(null)}
            style={{
              display: "grid",
              gridTemplateColumns: "36px minmax(0,2fr) 80px 80px 80px 36px",
              alignItems: "center",
              gap: 14,
              padding: "12px 18px",
              borderBottom:
                i === tracks.length - 1
                  ? "none"
                  : "1px solid rgb(var(--border-subtle) / 0.6)",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {hovered ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="sk-pop"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "rgb(var(--fg-default))",
                    color: "rgb(var(--bg-background))",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <Icon name="play" size={11} strokeWidth={2.6} />
                </span>
              ) : (
                <span
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 11.5,
                    color: "rgb(var(--fg-faint))",
                  }}
                >
                  {i + 1}
                </span>
              )}
            </span>
            <div
              style={{
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="truncate"
                  style={{ fontSize: 13, fontWeight: 700 }}
                >
                  {t.title}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "rgb(var(--fg-muted))",
                  }}
                >
                  {t.bpm ? `${String(t.bpm)} BPM · ` : ""}
                  {t.mkey ? `${t.mkey} · ` : ""}
                  uploaded {t.uploaded}
                </div>
              </div>
            </div>
            <span
              className="pill"
              style={{
                fontSize: 10,
                background: "rgb(var(--bg-elevated))",
                color: "rgb(var(--fg-default))",
                border: "1px solid rgb(var(--border-subtle))",
                justifySelf: "end",
              }}
            >
              {t.version}
            </span>
            <span
              className="tabular"
              style={{
                textAlign: "right",
                fontSize: 11.5,
                color:
                  t.comments > 0
                    ? "rgb(var(--fg-default))"
                    : "rgb(var(--fg-faint))",
                fontFamily: "JetBrains Mono",
              }}
            >
              {t.comments > 0 ? t.comments : "—"}
            </span>
            <span
              className="tabular"
              style={{
                textAlign: "right",
                fontSize: 12,
                fontFamily: "JetBrains Mono",
              }}
            >
              {t.duration}
            </span>
            <span
              onClick={(e) => e.stopPropagation()}
              style={{ justifySelf: "end" }}
            >
              <KebabMenu
                items={[
                  { label: "Open song", icon: "external-link" },
                  { label: "Download", icon: "download" },
                  { label: "Share with artist", icon: "share-2" },
                  { label: "Upload new version", icon: "upload" },
                  { label: "Delete", icon: "trash-2", danger: true },
                ]}
              />
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function RoomFilesTab() {
  // Skitza doesn't yet have a generic project-files table — only audio
  // tracks. Render the empty state from the mockup so the design still
  // reads correctly.
  return (
    <Card padded={false}>
      <div
        style={{
          padding: "10px 18px",
          borderBottom: "1px solid rgb(var(--border-subtle))",
          background: "rgb(var(--bg-elevated))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span className="label-tiny">Files</span>
        <button
          className="sk-pop"
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "6px 12px",
            borderRadius: 7,
            fontSize: 11.5,
            fontWeight: 700,
            background: "rgb(var(--fg-default))",
            color: "rgb(var(--bg-background))",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Icon name="upload" size={12} /> Upload file
        </button>
      </div>
      <div style={{ padding: 60, textAlign: "center" }}>
        <Icon
          name="folder"
          size={32}
          style={{ color: "rgb(var(--fg-faint))", marginBottom: 10 }}
        />
        <div style={{ fontSize: 14, fontWeight: 700 }}>No files yet</div>
        <div style={{ fontSize: 12, color: "rgb(var(--fg-muted))", marginTop: 4 }}>
          Briefs, stems, references, contracts, artwork — all in one place.
        </div>
      </div>
    </Card>
  );
}

function RoomPaymentsTab({ project }: { project: ProjectRoomProject }) {
  const balance = project.total - project.paid;
  // Milestone breakdown is the mockup's display model — we mirror it
  // against the real total so the proportions track real money. Status
  // is derived from how much the producer has already collected.
  const milestones = [
    {
      id: "m1",
      label: "Deposit",
      amount: project.total * 0.3,
      status:
        project.paid >= project.total * 0.3 ? "paid" : "upcoming",
    },
    {
      id: "m2",
      label: "Mid-project",
      amount: project.total * 0.4,
      status:
        project.paid >= project.total * 0.7
          ? "paid"
          : project.paid >= project.total * 0.3
            ? "pending"
            : "upcoming",
    },
    {
      id: "m3",
      label: "Final",
      amount: project.total * 0.3,
      status: project.paid >= project.total ? "paid" : "upcoming",
    },
  ] as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card
        title={balance > 0 ? "Outstanding balance" : "Settled"}
        icon={<Icon name="dollar-sign" size={14} />}
      >
        <div
          style={{
            padding: 16,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {(
            [
              ["Total", project.total, null],
              ["Paid", project.paid, "success"],
              [
                "Balance",
                balance,
                balance > 0 ? "danger" : "success",
              ],
            ] as const
          ).map(([l, v, accent]) => (
            <div
              key={l}
              style={{
                padding: 14,
                borderRadius: 10,
                background:
                  accent === "danger"
                    ? "rgb(var(--fg-danger) / 0.06)"
                    : accent === "success"
                      ? "rgb(var(--fg-success) / 0.06)"
                      : "rgb(var(--bg-elevated))",
                border: `1px solid ${
                  accent === "danger"
                    ? "rgb(var(--fg-danger) / 0.2)"
                    : accent === "success"
                      ? "rgb(var(--fg-success) / 0.2)"
                      : "rgb(var(--border-subtle))"
                }`,
              }}
            >
              <div className="label-tiny" style={{ marginBottom: 6 }}>
                {l}
              </div>
              <div
                className="tabular"
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  fontFamily: "JetBrains Mono",
                  color:
                    accent === "danger"
                      ? "rgb(var(--fg-danger))"
                      : accent === "success"
                        ? "rgb(var(--fg-success))"
                        : "rgb(var(--fg-default))",
                }}
              >
                ${v.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        {balance > 0 && (
          <div style={{ padding: "0 16px 16px", display: "flex", gap: 8 }}>
            <button
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                flex: 1,
                textAlign: "center",
                padding: "12px 16px",
                borderRadius: 10,
                background: "rgb(var(--fg-default))",
                color: "rgb(var(--bg-background))",
                fontSize: 13,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Icon name="send" size={13} />
              Send payment reminder
            </button>
            <button
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "12px 16px",
                borderRadius: 10,
                background: "rgb(var(--bg-elevated))",
                color: "rgb(var(--fg-default))",
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid rgb(var(--border-subtle))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Icon name="file-text" size={13} />
              Invoice
            </button>
          </div>
        )}
      </Card>

      <Card title="Milestones" icon={<Icon name="flag" size={14} />}>
        <div style={{ padding: 8 }}>
          {milestones.map((m, i) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "10px 12px",
                borderBottom:
                  i === milestones.length - 1
                    ? "none"
                    : "1px solid rgb(var(--border-subtle) / 0.6)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background:
                    m.status === "paid"
                      ? "rgb(var(--fg-success))"
                      : m.status === "pending"
                        ? "rgb(var(--fg-warning))"
                        : "rgb(var(--border-strong))",
                }}
              />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{m.label}</span>
              <span
                className="tabular"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "JetBrains Mono",
                }}
              >
                ${Math.round(m.amount).toLocaleString()}
              </span>
              <span
                className="pill"
                style={{
                  fontSize: 9.5,
                  background:
                    m.status === "paid"
                      ? "rgb(var(--fg-success) / 0.14)"
                      : m.status === "pending"
                        ? "rgb(var(--fg-warning) / 0.16)"
                        : "rgb(var(--bg-elevated))",
                  color:
                    m.status === "paid"
                      ? "rgb(var(--fg-success))"
                      : m.status === "pending"
                        ? "rgb(var(--fg-warning))"
                        : "rgb(var(--fg-muted))",
                  border: "none",
                }}
              >
                {m.status.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RoomActivityTab({ events }: { events: ActivityEvent[] }) {
  return (
    <Card padded={false}>
      <div style={{ padding: 8 }}>
        {events.length === 0 ? (
          <div
            style={{
              padding: 60,
              textAlign: "center",
              color: "rgb(var(--fg-muted))",
            }}
          >
            <Icon
              name="activity"
              size={28}
              style={{ marginBottom: 10, color: "rgb(var(--fg-faint))" }}
            />
            <div style={{ fontSize: 14, fontWeight: 700 }}>No activity yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Uploads, payments, and comments will show up here.
            </div>
          </div>
        ) : (
          events.map((e, i) => (
            <div
              key={i}
              className="sk-row"
              style={{
                display: "flex",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 8,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  background: "rgb(var(--bg-elevated))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "rgb(var(--fg-muted))",
                  marginTop: 2,
                }}
              >
                <Icon name={e.icon} size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{e.text}</div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "rgb(var(--fg-faint))",
                    marginTop: 2,
                  }}
                >
                  {e.who} · {e.when}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// EqBars + NowPlayingDot are imported from ./primitives — keeping the
// import here as a tree-shaking hint (component file references them
// in commented-out code blocks for future round audio wiring).
void EqBars;
