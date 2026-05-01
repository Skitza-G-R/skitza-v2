"use client";

// Skitza Design Test — shell. 1:1 port of the mockup's shell.jsx Sidebar
// (sample-app.html lines 698-845). Variant `full` only — `rail`, `top`,
// mobile chromes are skipped on this round per Gili's brief (desktop-only).
//
// Wired-logic tweak (per "Option A: keep existing routes"): the `onNav`
// prop fires Next.js client-side navigation to the corresponding /dashboard
// child route instead of swapping internal tab state. Active-tab pill is
// derived from `usePathname` so the highlight follows real URL navigation.
//
// Throwaway sandbox — never merges to main.

import { useRouter, usePathname } from "next/navigation";
import { Avatar, Icon } from "./primitives";

export type Producer = {
  name: string;
  initials: string;
  plan: string;
  avatarGrad: string;
};

// Mockup line 707-714. NAV order is locked — moving entries reshuffles the
// active-pill index math + the keyboard-shortcut prefix in the mockup's
// keymap (`g + o/p/m/c/s/i/t`).
const NAV: Array<{
  key: "overview" | "projects" | "music" | "calendar" | "store" | "insights";
  label: string;
  short: string;
  icon: string;
  href: string;
}> = [
  { key: "overview", label: "Overview", short: "Home", icon: "home", href: "/dashboard" },
  // Skitza routes don't have an "Insights" page yet — link goes to /dashboard
  // (will resolve to a 404-style "coming soon" if user clicks). The button
  // is preserved 1:1 so the design canvas isn't altered.
  { key: "projects", label: "Clients & Projects", short: "Clients", icon: "users", href: "/dashboard/projects" },
  { key: "music", label: "Music Library", short: "Library", icon: "music", href: "/dashboard/music" },
  { key: "calendar", label: "Calendar", short: "Calendar", icon: "calendar", href: "/dashboard/booking" },
  { key: "store", label: "Storefront", short: "Store", icon: "store", href: "/dashboard/booking" },
  { key: "insights", label: "Insights", short: "Insights", icon: "trending-up", href: "/dashboard" },
];

type NavItemProps = {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  collapsed?: boolean;
};

function NavItem({ icon, label, active, onClick, collapsed }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className="sk-row"
      title={collapsed ? label : undefined}
      style={{
        all: "unset",
        display: "flex",
        alignItems: "center",
        gap: collapsed ? 0 : 12,
        padding: collapsed ? "11px 10px" : "10px 12px",
        borderRadius: 10,
        cursor: "pointer",
        color: active ? "#fff" : "rgba(255,255,255,0.55)",
        background: active ? "rgba(255,255,255,0.06)" : "transparent",
        fontSize: 13.5,
        fontWeight: active ? 700 : 500,
        letterSpacing: "-0.005em",
        position: "relative",
        justifyContent: collapsed ? "center" : "flex-start",
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
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

function Wordmark({ small = false, white = true }: { small?: boolean; white?: boolean }) {
  return (
    <span
      className="skitza-wordmark"
      style={{
        fontSize: small ? 18 : 22,
        color: white ? "#fff" : "rgb(var(--fg-default))",
      }}
    >
      Skitza<span className="dot">.</span>
    </span>
  );
}

type SidebarProps = {
  producer: Producer;
  // Optional today-block content. Mockup hardcodes a "2 sessions / Next:
  // Tracking — vocals" preview; we leave it null until session data is
  // wired. The block container stays in the markup either way so layout
  // is identical.
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

  // Derive active key from URL — `/dashboard` → overview, `/dashboard/music`
  // → music, etc. Matches the visual contract of the mockup's `activeTab`
  // state. Falls back to `overview` if no NAV entry matches (shouldn't
  // happen given the nav covers all dashboard children).
  const activeKey: typeof NAV[number]["key"] =
    NAV.find((n) => n.href !== "/dashboard" && pathname?.startsWith(n.href))
      ?.key ?? "overview";

  const collapsed = false; // `variant="full"` only on this round.

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
        onClick={() => router.push("/dashboard")}
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
        {NAV.map((n) => (
          <NavItem
            key={n.key}
            icon={n.icon}
            label={n.label}
            active={activeKey === n.key}
            onClick={() => router.push(n.href)}
            collapsed={collapsed}
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
          active={pathname?.startsWith("/dashboard/settings") ?? false}
          onClick={() => router.push("/dashboard/settings")}
          collapsed={collapsed}
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
          onClick={() => router.push("/dashboard/settings")}
        >
          <Avatar initials={producer.initials} grad={producer.avatarGrad} size={32} />
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div
              style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}
              className="truncate"
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
