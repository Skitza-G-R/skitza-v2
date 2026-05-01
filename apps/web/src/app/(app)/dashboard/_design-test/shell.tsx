/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — shell. 1:1 port of the mockup's shell.jsx Sidebar
// (sample-app/index.html lines 698-845). Variant `full` only on this
// round; `rail`, `top`, and mobile chromes are out of scope per the
// desktop-first brief.
//
// Wired-logic tweak (per Option A — keep existing routes): `onNav`
// fires Next.js client-side navigation to the matching /dashboard
// child route instead of swapping internal tab state. The active
// pill is derived from `usePathname` so the highlight follows real
// URL navigation across page mounts.

import { usePathname, useRouter } from "next/navigation";

import { Avatar, Icon } from "./primitives";

export type Producer = {
  name: string;
  initials: string;
  plan: string;
  avatarGrad: string;
};

// Mockup line 707-714. NAV order is locked — moving entries reshuffles
// the active-pill index math + the keyboard-shortcut prefix. `href`
// values follow Skitza's existing route map; routes that don't yet
// exist (insights, store) point at /dashboard so a click doesn't 404
// while we wire those tabs in later rounds.
const NAV: ReadonlyArray<{
  key:
    | "overview"
    | "projects"
    | "music"
    | "calendar"
    | "store"
    | "insights"
    | "settings";
  label: string;
  short: string;
  icon: string;
  href: string;
}> = [
  {
    key: "overview",
    label: "Overview",
    short: "Home",
    icon: "home",
    href: "/dashboard",
  },
  {
    key: "projects",
    label: "Clients & Projects",
    short: "Clients",
    icon: "users",
    href: "/dashboard/projects",
  },
  {
    key: "music",
    label: "Music Library",
    short: "Library",
    icon: "music",
    href: "/dashboard/music",
  },
  {
    key: "calendar",
    label: "Calendar",
    short: "Calendar",
    icon: "calendar",
    href: "/dashboard/booking",
  },
  {
    key: "store",
    label: "Storefront",
    short: "Store",
    icon: "store",
    // Storefront page doesn't exist yet on Skitza — points at /dashboard
    // until we ship the matching tab.
    href: "/dashboard",
  },
  {
    key: "insights",
    label: "Insights",
    short: "Insights",
    icon: "trending-up",
    // Insights page doesn't exist yet either — same fallback.
    href: "/dashboard",
  },
  {
    key: "settings",
    label: "Settings",
    short: "Settings",
    icon: "settings",
    href: "/dashboard/settings",
  },
];

// Internal — derives the active nav key from the current pathname.
// Exported as `_deriveActiveKey` so future tests can target it without
// rendering the component. Rules: longest-href-match wins so
// `/dashboard/music` is "music", not "overview" (whose href is just
// `/dashboard`). Falls back to "overview" when no entry matches.
export function deriveActiveKey(
  pathname: string | null,
): (typeof NAV)[number]["key"] {
  if (!pathname) return "overview";
  // Sort longest-href-first so /dashboard/music beats /dashboard.
  const sorted = [...NAV].sort((a, b) => b.href.length - a.href.length);
  for (const entry of sorted) {
    if (entry.href === "/dashboard") {
      // Special-case the root: only match an exact equality, otherwise
      // every dashboard child route would highlight Overview.
      if (pathname === "/dashboard") return entry.key;
      continue;
    }
    if (pathname.startsWith(entry.href)) return entry.key;
  }
  return "overview";
}

type NavItemProps = {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
};

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className="sk-row"
      style={{
        all: "unset",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 10,
        cursor: "pointer",
        color: active ? "#fff" : "rgba(255,255,255,0.55)",
        background: active ? "rgba(255,255,255,0.06)" : "transparent",
        fontSize: 13.5,
        fontWeight: active ? 700 : 500,
        letterSpacing: "-0.005em",
        position: "relative",
        justifyContent: "flex-start",
      }}
    >
      {active && (
        <span
          style={{
            position: "absolute",
            left: -5,
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: 2,
            background: "rgb(var(--brand-primary))",
          }}
        />
      )}
      <Icon name={icon} size={16} strokeWidth={2.3} />
      <span>{label}</span>
    </button>
  );
}

function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span
      className="skitza-wordmark"
      style={{
        fontSize: small ? 18 : 22,
        color: "#fff",
      }}
    >
      Skitza<span className="dot">.</span>
    </span>
  );
}

type SidebarProps = {
  producer: Producer;
  // Optional today-block: when present the sidebar shows the "Today"
  // mini-card under the nav. Hidden until a sessions/calendar query
  // wires real data into the Overview round.
  todayPreview?: {
    sessionCount: number;
    nextSessionTitle: string;
    nextSessionTime: string;
    nextSessionClient: string;
  } | null;
  onOpenPalette?: () => void;
};

export function Sidebar({ producer, todayPreview, onOpenPalette }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeKey = deriveActiveKey(pathname);

  const goHome = () => router.push("/dashboard");
  // Settings and the per-row nav routes are pinned to the existing
  // Skitza routes so URL state stays authentic on click.
  const navTo = (href: string) => () => router.push(href);

  return (
    <aside
      style={{
        width: 232,
        background: "rgb(var(--bg-sidebar))",
        color: "rgb(var(--fg-inverse))",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid rgb(var(--border-sidebar))",
        boxShadow: "4px 0 24px rgba(17,16,9,0.08)",
        flexShrink: 0,
        height: "100%",
        zIndex: 20,
      }}
    >
      <button
        onClick={goHome}
        title="Go home (Overview)"
        aria-label="Skitza Hall — Home"
        className="sk-pop"
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "20px 18px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
        }}
      >
        <Wordmark />
      </button>

      {onOpenPalette && (
        <div style={{ padding: "0 12px 8px" }}>
          <button
            onClick={onOpenPalette}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "calc(100% - 16px)",
              padding: "8px 10px",
              borderRadius: 9,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 12.5,
            }}
          >
            <Icon name="search" size={14} strokeWidth={2.2} />
            <span style={{ flex: 1 }}>Search…</span>
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 10.5,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              ⌘K
            </span>
          </button>
        </div>
      )}

      <nav
        className="custom-scrollbar"
        style={{
          flex: 1,
          padding: "4px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
        }}
      >
        {NAV.filter((n) => n.key !== "settings").map((n) => (
          <NavItem
            key={n.key}
            icon={n.icon}
            label={n.label}
            active={activeKey === n.key}
            onClick={navTo(n.href)}
          />
        ))}

        {todayPreview && (
          <div style={{ marginTop: 18, padding: "0 4px" }}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "rgba(255,255,255,0.32)",
                marginBottom: 8,
                paddingLeft: 8,
              }}
            >
              Today
            </div>
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  color: "rgba(255,255,255,0.6)",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "rgb(var(--fg-success))",
                  }}
                />
                {todayPreview.sessionCount} sessions
              </div>
              <div style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>
                Next: {todayPreview.nextSessionTitle}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.45)",
                  fontFamily: "JetBrains Mono",
                  marginTop: 2,
                }}
              >
                {todayPreview.nextSessionTime} · {todayPreview.nextSessionClient}
              </div>
            </div>
          </div>
        )}
      </nav>

      <div
        style={{
          padding: "12px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <NavItem
          icon="settings"
          label="Settings"
          active={activeKey === "settings"}
          onClick={navTo("/dashboard/settings")}
        />

        <button
          className="sk-row"
          style={{
            all: "unset",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 10px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            marginTop: 8,
            width: "calc(100% - 4px)",
          }}
          onClick={navTo("/dashboard/settings")}
        >
          <Avatar initials={producer.initials} grad={producer.avatarGrad} size={32} />
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div
              className="truncate"
              style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}
            >
              {producer.name}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: "rgba(255,255,255,0.4)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginTop: 2,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "rgb(var(--brand-primary))",
                }}
              />
              {producer.plan} Plan
            </div>
          </div>
          <Icon
            name="chevron-up"
            size={14}
            style={{ color: "rgba(255,255,255,0.3)" }}
          />
        </button>
      </div>
    </aside>
  );
}
