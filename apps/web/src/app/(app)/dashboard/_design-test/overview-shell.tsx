/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — Overview shell. Mirrors the mockup's ProducerApp
// (sample-app/index.html lines 4460-4664) chrome="sidebar" branch only.
// Audio player, command palette, song overlay, mobile chrome, and
// keyboard shortcuts are deferred to later rounds — they're cross-
// cutting concerns that hang off this shell rather than living inside
// it.
//
// CSS is loaded as a side-effect import. Rules are scoped under
// `.dt-root` (see ./design-test.css) so they can't pollute global
// Skitza styles when the user navigates away from /dashboard.

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
      className="dt-root"
      data-theme="light"
      data-density="comfort"
      style={{
        display: "flex",
        flexDirection: "row",
        position: "relative",
      }}
    >
      <div className="noise-overlay" />

      <Sidebar producer={producer} todayPreview={null} />

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
