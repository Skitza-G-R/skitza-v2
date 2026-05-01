"use client";

// Skitza Design Test — Overview shell. Mirrors the mockup's ProducerApp
// (sample-app.html lines 4460-4664) with the chrome="sidebar" branch only.
// Audio player, command palette, song overlay, and keyboard shortcuts are
// stripped — they belong to other tabs that aren't part of this round.
//
// CSS is loaded as a side-effect import so Next.js bundles it with this
// route. Other dashboard children inherit it because they share the parent
// layout — that's expected on this throwaway branch.
//
// Throwaway sandbox — never merges to main.

import "./design-test.css";

import { OverviewTab, type OverviewData } from "./overview-tab";
import { Sidebar, type Producer } from "./shell";

type OverviewShellProps = {
  producer: Producer;
  data: OverviewData;
};

export function OverviewShell({ producer, data }: OverviewShellProps) {
  return (
    <div
      data-theme="light"
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "row",
        background: "rgb(var(--bg-background))",
        color: "rgb(var(--fg-default))",
        fontFamily: "Outfit",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="noise-overlay" />

      {/* Chrome — sidebar variant only. todayPreview is null until session
          data wires up. Search palette is null because the mockup's Cmd-K
          palette isn't on this round. */}
      <Sidebar producer={producer} todayPreview={null} />

      {/* Body — direct OverviewTab render (no tab routing on this surface;
          the sidebar pushes real URL navigation instead). */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
          position: "relative",
          paddingBottom: 0,
        }}
      >
        <OverviewTab data={data} />
      </main>
    </div>
  );
}
