/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Cmd-K command palette. 1:1 port of the mockup's
// CommandPalette (sample-app/index.html lines 1114-1255).
//
// Wired logic:
// - Recent items persist in localStorage under RECENTS_KEY
// - Selecting a tab → router.push to its href
// - Selecting a project → router.push("/dashboard/projects/<id>")
// - Selecting a track → router.push("/dashboard/music/<versionId>")
// - Selecting a client → router.push("/dashboard/projects?client=<id>")
//   (projects page can filter by client via query param)
// - Esc / click backdrop → onClose
// - ↑↓ navigate, Enter to fire selected item

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  rankPaletteItems,
  type PaletteCandidate,
  type PaletteItem,
  type RecentRef,
} from "./palette-ranking";
import { Icon } from "./primitives";

const RECENTS_KEY = "skitza:dt:palette:recents";
const RECENTS_MAX = 8;

function readRecents(): RecentRef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentRef =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as RecentRef).kind === "string" &&
          typeof (e as RecentRef).id === "string",
      )
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

function pushRecent(entry: RecentRef) {
  if (typeof window === "undefined") return;
  try {
    const current = readRecents().filter(
      (r) => !(r.kind === entry.kind && r.id === entry.id),
    );
    const next = [entry, ...current].slice(0, RECENTS_MAX);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* swallow — palette still works without recents */
  }
}

export type PaletteData = {
  projects: { id: string; title: string; client: string; grad: string }[];
  tracks: {
    id: string; // versionId
    title: string;
    sub: string;
    grad: string;
  }[];
  clients: { id: string; name: string; projectCount: number }[];
};

const TABS: PaletteCandidate[] = [
  { kind: "tab", id: "/dashboard", label: "Overview", icon: "home", hint: "Go to · g h" },
  {
    kind: "tab",
    id: "/dashboard/projects",
    label: "Clients & Projects",
    icon: "users",
    hint: "Go to · g p",
  },
  {
    kind: "tab",
    id: "/dashboard/music",
    label: "Music Library",
    icon: "music",
    hint: "Go to · g m",
  },
  {
    kind: "tab",
    id: "/dashboard/booking",
    label: "Calendar",
    icon: "calendar",
    hint: "Go to · g c",
  },
  {
    kind: "tab",
    id: "/dashboard/store",
    label: "Storefront",
    icon: "store",
    hint: "Go to · g s",
  },
  {
    kind: "tab",
    id: "/dashboard/insights",
    label: "Insights",
    icon: "trending-up",
    hint: "Go to · g i",
  },
  {
    kind: "tab",
    id: "/dashboard/settings",
    label: "Settings",
    icon: "settings",
    hint: "Go to · g t",
  },
];

export function CommandPalette({
  data,
  onClose,
}: {
  data: PaletteData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [recents, setRecents] = useState<RecentRef[]>([]);

  useEffect(() => {
    setRecents(readRecents());
    inputRef.current?.focus();
  }, []);

  const candidates: PaletteCandidate[] = useMemo(() => {
    const projectCands: PaletteCandidate[] = data.projects.map((p) => ({
      kind: "project",
      id: p.id,
      label: p.title,
      sub: p.client,
      icon: "folder",
      grad: p.grad,
      hint: "Open project",
    }));
    const trackCands: PaletteCandidate[] = data.tracks.map((t) => ({
      kind: "track",
      id: t.id,
      label: t.title,
      sub: t.sub,
      icon: "music",
      grad: t.grad,
      hint: "Open song",
    }));
    const clientCands: PaletteCandidate[] = data.clients.map((c) => ({
      kind: "client",
      id: c.id,
      label: c.name,
      sub:
        c.projectCount > 0
          ? `${String(c.projectCount)} project${c.projectCount === 1 ? "" : "s"}`
          : "No projects yet",
      icon: "user",
      hint: "Open client",
    }));
    return [...TABS, ...projectCands, ...trackCands, ...clientCands];
  }, [data]);

  const items: PaletteItem[] = useMemo(
    () => rankPaletteItems({ query: q, candidates, recents }),
    [q, candidates, recents],
  );

  useEffect(() => {
    setSel(0);
  }, [q]);

  const fire = (item: PaletteItem | undefined) => {
    if (!item) return;
    pushRecent({ kind: item.kind, id: item.id });
    setRecents(readRecents());
    if (item.kind === "tab") {
      router.push(item.id);
    } else if (item.kind === "project") {
      router.push(`/dashboard/projects/${item.id}`);
    } else if (item.kind === "track") {
      router.push(`/dashboard/music/${item.id}`);
    } else if (item.kind === "client") {
      router.push(`/dashboard/projects?client=${encodeURIComponent(item.id)}`);
    }
    onClose();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      fire(items[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(15,12,8,0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "clamp(40px, 10vh, 120px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, calc(100% - 32px))",
          background: "rgb(var(--bg-default))",
          border: "1px solid rgb(var(--border-default))",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(17,16,9,0.36)",
          overflow: "hidden",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: "1px solid rgb(var(--border-subtle))",
          }}
        >
          <Icon name="search" size={16} style={{ color: "rgb(var(--fg-muted))" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search projects, songs, clients — or jump to…"
            style={{
              all: "unset",
              flex: 1,
              fontSize: 14.5,
              fontFamily: "inherit",
              color: "rgb(var(--fg-default))",
            }}
          />
          <span
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 10.5,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgb(var(--bg-elevated))",
              color: "rgb(var(--fg-muted))",
              border: "1px solid rgb(var(--border-subtle))",
            }}
          >
            esc
          </span>
        </div>

        <div
          className="custom-scrollbar"
          style={{ flex: 1, overflowY: "auto", padding: 6 }}
        >
          {items.length === 0 && (
            <div
              style={{
                padding: "40px 16px",
                textAlign: "center",
                color: "rgb(var(--fg-muted))",
                fontSize: 13,
              }}
            >
              No matches for &quot;{q}&quot;
            </div>
          )}
          {items.map((it, i) => (
            <div key={`${it.kind}:${it.id}:${String(i)}`}>
              {it._section && (
                <div
                  style={{
                    padding: "8px 10px 4px",
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "rgb(var(--fg-faint))",
                  }}
                >
                  {it._section}
                </div>
              )}
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => fire(it)}
                className="sk-row"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "9px 10px",
                  borderRadius: 8,
                  width: "calc(100% - 4px)",
                  background:
                    i === sel ? "rgb(var(--bg-elevated))" : "transparent",
                }}
              >
                <span
                  className={it.grad ?? ""}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background: it.grad ? undefined : "rgb(var(--bg-elevated))",
                    color: it.grad ? "#fff" : "rgb(var(--fg-muted))",
                    border: it.grad ? "none" : "1px solid rgb(var(--border-subtle))",
                  }}
                >
                  <Icon name={it.icon} size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "rgb(var(--fg-default))",
                    }}
                    className="truncate"
                  >
                    {it.label}
                  </div>
                  {it.sub && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "rgb(var(--fg-muted))",
                        marginTop: 1,
                      }}
                      className="truncate"
                    >
                      {it.sub}
                    </div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "rgb(var(--fg-faint))",
                    flexShrink: 0,
                  }}
                >
                  {it.hint}
                </span>
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "8px 14px",
            borderTop: "1px solid rgb(var(--border-subtle))",
            fontSize: 10.5,
            color: "rgb(var(--fg-muted))",
            background: "rgb(var(--bg-elevated))",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <kbd className="kbd">↑↓</kbd> navigate
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <kbd className="kbd">↵</kbd> open
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <kbd className="kbd">esc</kbd> close
          </span>
          <span style={{ flex: 1 }} />
          <span>
            {String(items.length)} result{items.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}
