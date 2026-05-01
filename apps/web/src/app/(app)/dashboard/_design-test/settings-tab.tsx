/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Settings tab. 1:1 port of the mockup's
// SettingsTab (sample-app/index.html lines 3193-3303). Sections:
// Account, Plan, Integrations, Language & Region.
//
// Wired data:
// - Account name / email / public-link slug — from producer.me()
// - Stripe integration: real `me.stripeConnected` flag drives the
//   connected/disconnected pill
// - Other integrations (gcal, spotify, dropbox): local state stubs
//   until those are real
//
// Save flow: displayName + slug + tagline persist via the
// `updateProducerSettings` Server Action (producer.update under the
// hood). Email is Clerk-managed and intentionally read-only here.

import { type CSSProperties, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Avatar, Card, Icon } from "./primitives";
import { updateProducerSettings } from "./settings-actions";

export type SettingsData = {
  name: string;
  email: string;
  tagline: string;
  publicLinkSlug: string;
  stripeConnected: boolean;
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string; field?: "displayName" | "slug" | "tagline" };

export function SettingsTab({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [name, setName] = useState(data.name);
  const [email, setEmail] = useState(data.email);
  const [tagline, setTagline] = useState(data.tagline);
  const [pubSlug, setPubSlug] = useState(data.publicLinkSlug);
  const [lang, setLang] = useState<"en" | "he">("en");
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== data.name || pubSlug !== data.publicLinkSlug || tagline !== data.tagline;

  const onSave = () => {
    setStatus({ kind: "saving" });
    startTransition(() => {
      void (async () => {
        const result = await updateProducerSettings({
          displayName: name,
          slug: pubSlug,
          tagline,
        });
        if (result.ok) {
          setStatus({ kind: "saved" });
          router.refresh();
          // Keep the "Saved" pill visible briefly, then fade back to idle.
          window.setTimeout(() => {
            setStatus((cur) => (cur.kind === "saved" ? { kind: "idle" } : cur));
          }, 1800);
        } else {
          setStatus({
            kind: "error",
            message: result.error,
            ...(result.field ? { field: result.field } : {}),
          });
        }
      })();
    });
  };

  const onCancel = () => {
    setName(data.name);
    setEmail(data.email);
    setTagline(data.tagline);
    setPubSlug(data.publicLinkSlug);
    setStatus({ kind: "idle" });
  };
  const [integrations, setIntegrations] = useState<{
    stripe: boolean;
    gcal: boolean;
    spotify: boolean;
    dropbox: boolean;
  }>({
    stripe: data.stripeConnected,
    gcal: false,
    spotify: false,
    dropbox: false,
  });

  const inputCss: CSSProperties = {
    all: "unset",
    flex: 1,
    fontSize: 13,
    fontFamily: "inherit",
    color: "rgb(var(--fg-default))",
    padding: "8px 12px",
    border: "1px solid rgb(var(--border-subtle))",
    borderRadius: 8,
    background: "rgb(var(--bg-elevated))",
    boxSizing: "border-box",
    minWidth: 0,
  };

  const initials =
    name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "GS";

  return (
    <div
      data-screen-label="06 Settings"
      className="custom-scrollbar"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 3vw, 32px)",
        maxWidth: 900,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <header className="reveal-up stagger-1" style={{ marginBottom: 22 }}>
        <span className="label-tiny" style={{ display: "block", marginBottom: 6 }}>
          Workspace
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
          Settings
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "rgb(var(--fg-muted))" }}>
          Account · Plan · Integrations · Language
        </p>
      </header>

      <div
        className="reveal-up stagger-2"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <Card title="Account" icon={<Icon name="user" size={14} />}>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar initials={initials} grad="grad-amber" size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 14, fontWeight: 700 }}>
                  {name}
                </div>
                <div
                  className="truncate"
                  style={{
                    fontSize: 11.5,
                    color: "rgb(var(--fg-muted))",
                    fontFamily: "JetBrains Mono",
                  }}
                >
                  {email}
                </div>
              </div>
              <button
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "7px 12px",
                  borderRadius: 8,
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: "rgb(var(--bg-elevated))",
                  border: "1px solid rgb(var(--border-subtle))",
                }}
              >
                Change avatar
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 10,
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="label-tiny">Display name</span>
                <input
                  style={inputCss}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="label-tiny">Email</span>
                <input
                  style={inputCss}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  gridColumn: "1 / -1",
                }}
              >
                <span className="label-tiny">Tagline</span>
                <input
                  style={inputCss}
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  gridColumn: "1 / -1",
                }}
              >
                <span className="label-tiny">Public link</span>
                <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "JetBrains Mono",
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "8px 10px",
                      background: "rgb(var(--bg-sidebar))",
                      color: "rgb(var(--bg-background))",
                      border: "1px solid rgb(var(--border-subtle))",
                      borderRight: "none",
                      borderTopLeftRadius: 8,
                      borderBottomLeftRadius: 8,
                    }}
                  >
                    skitza.app/p/
                  </span>
                  <input
                    style={{
                      ...inputCss,
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      fontFamily: "JetBrains Mono",
                    }}
                    value={pubSlug}
                    onChange={(e) => setPubSlug(e.target.value)}
                  />
                </div>
              </label>
            </div>
          </div>
        </Card>

        <Card title="Plan" icon={<Icon name="zap" size={14} />}>
          <div
            style={{
              padding: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  className="font-syne"
                  style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}
                >
                  Pro
                </span>
                <span
                  className="tabular"
                  style={{
                    fontSize: 13,
                    color: "rgb(var(--fg-muted))",
                    fontFamily: "JetBrains Mono",
                  }}
                >
                  $12 / mo
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgb(var(--fg-muted))" }}>
                Unlimited projects · Custom storefront · Payment automation
              </p>
            </div>
            <button
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "8px 14px",
                borderRadius: 9,
                background: "rgb(var(--brand-primary))",
                color: "#111009",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Manage billing
            </button>
          </div>
        </Card>

        <Card title="Integrations" icon={<Icon name="plug" size={14} />}>
          <div
            style={{ padding: 4, display: "flex", flexDirection: "column", gap: 2 }}
          >
            {(
              [
                { key: "stripe", label: "Stripe", sub: "Payments", icon: "credit-card" },
                { key: "gcal", label: "Google Calendar", sub: "Sync sessions both ways", icon: "calendar" },
                { key: "spotify", label: "Spotify", sub: "Show your producer playlist", icon: "music" },
                { key: "dropbox", label: "Dropbox", sub: "Auto-archive delivered stems", icon: "folder" },
              ] as const
            ).map((int) => {
              const on = integrations[int.key];
              return (
                <div
                  key={int.key}
                  className="sk-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "rgb(var(--bg-elevated))",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name={int.icon} size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{int.label}</div>
                    <div style={{ fontSize: 11, color: "rgb(var(--fg-muted))" }}>
                      {int.sub}
                      {on ? " — connected" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setIntegrations((p) => ({ ...p, [int.key]: !p[int.key] }))
                    }
                    className="sk-pop"
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 10px",
                      borderRadius: 7,
                      fontSize: 10.5,
                      fontWeight: 700,
                      background: on ? "transparent" : "rgb(var(--fg-default))",
                      color: on ? "rgb(var(--fg-success))" : "rgb(var(--bg-background))",
                      border: on
                        ? "1px solid rgb(var(--fg-success) / 0.3)"
                        : "none",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {on ? (
                      <>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: "rgb(var(--fg-success))",
                          }}
                        />{" "}
                        Connected
                      </>
                    ) : (
                      "Connect"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Language & Region" icon={<Icon name="globe" size={14} />}>
          <div style={{ padding: 14 }}>
            <div className="label-tiny" style={{ marginBottom: 8 }}>
              Interface
            </div>
            <div
              style={{
                display: "inline-flex",
                padding: 3,
                borderRadius: 9,
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
              }}
            >
              {(
                [
                  ["en", "English (LTR)"],
                  ["he", "עברית (RTL)"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setLang(k)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: "7px 14px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    background: lang === k ? "rgb(var(--bg-background))" : "transparent",
                    color: lang === k ? "rgb(var(--fg-default))" : "rgb(var(--fg-muted))",
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            {lang === "he" && (
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "rgb(var(--fg-muted))" }}>
                RTL preview — changes apply on save.
              </p>
            )}
          </div>
        </Card>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            paddingTop: 4,
          }}
        >
          {status.kind === "error" && (
            <span
              role="alert"
              style={{
                fontSize: 12,
                color: "rgb(var(--fg-danger))",
                marginRight: "auto",
              }}
            >
              {status.message}
            </span>
          )}
          {status.kind === "saved" && (
            <span
              role="status"
              style={{
                fontSize: 12,
                color: "rgb(var(--fg-success))",
                marginRight: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "rgb(var(--fg-success))",
                }}
              />
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={pending || !dirty}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending || !dirty ? "not-allowed" : "pointer",
              padding: "10px 16px",
              borderRadius: 9,
              fontSize: 12.5,
              fontWeight: 700,
              background: "transparent",
              color: "rgb(var(--fg-muted))",
              border: "1px solid rgb(var(--border-subtle))",
              opacity: pending || !dirty ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !dirty}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending || !dirty ? "not-allowed" : "pointer",
              padding: "10px 18px",
              borderRadius: 9,
              fontSize: 12.5,
              fontWeight: 700,
              background: "rgb(var(--fg-default))",
              color: "rgb(var(--bg-background))",
              opacity: pending || !dirty ? 0.6 : 1,
            }}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
