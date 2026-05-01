"use client";

// Skitza Design Test — nav chrome (Breadcrumbs + BackButton).
// 1:1 ports of the mockup's nav.jsx (sample-app/index.html lines 1057-
// 1099). Used by the project room hero.

import { Fragment, type MouseEventHandler, type ReactNode } from "react";

import { Icon } from "./primitives";

export type Crumb = {
  label: ReactNode;
  current?: boolean;
  onClick?: MouseEventHandler;
};

export function Breadcrumbs({
  items = [],
  light = false,
  onHome,
}: {
  items?: Crumb[];
  light?: boolean;
  onHome?: MouseEventHandler;
}) {
  if (items.length === 0) return null;
  const fg = light ? "rgb(var(--fg-muted))" : "rgba(255,255,255,0.78)";
  const fgCurrent = light ? "rgb(var(--fg-default))" : "#fff";
  const fgSep = light ? "rgb(var(--fg-faint))" : "rgba(255,255,255,0.45)";
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {onHome && (
        <>
          <button
            onClick={onHome}
            className="sk-pop"
            title="Home"
            aria-label="Home"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              color: fg,
              padding: "2px 4px",
              borderRadius: 4,
            }}
          >
            <Icon name="home" size={12} />
          </button>
          <span aria-hidden="true" style={{ color: fgSep }}>
            /
          </span>
        </>
      )}
      {items.map((it, i) => (
        <Fragment key={i}>
          {it.current ? (
            <span
              style={{ color: fgCurrent, fontWeight: 700 }}
              aria-current="page"
            >
              {it.label}
            </span>
          ) : (
            <button
              onClick={it.onClick}
              className="sk-pop"
              style={{
                all: "unset",
                cursor: "pointer",
                color: fg,
                padding: "2px 4px",
                borderRadius: 4,
              }}
            >
              {it.label}
            </button>
          )}
          {i < items.length - 1 && (
            <span aria-hidden="true" style={{ color: fgSep }}>
              /
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

export function BackButton({
  onClick,
  label = "Back",
  light = false,
}: {
  onClick?: MouseEventHandler;
  label?: string;
  light?: boolean;
}) {
  const bg = light ? "rgb(var(--bg-elevated))" : "rgba(255,255,255,0.12)";
  const border = light
    ? "rgb(var(--border-subtle))"
    : "rgba(255,255,255,0.20)";
  const color = light ? "rgb(var(--fg-default))" : "#fff";
  return (
    <button
      onClick={onClick}
      className="sk-pop"
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        background: bg,
        color,
        border: `1px solid ${border}`,
      }}
    >
      <Icon name="arrow-left" size={13} strokeWidth={2.4} />
      {label}
    </button>
  );
}
