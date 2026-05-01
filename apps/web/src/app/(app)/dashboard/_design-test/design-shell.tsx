"use client";

// Skitza Design Test — shared shell. Wraps any tab body in the .dt-root
// scope, mounts the Sidebar + the global FloatingPlayer so they're
// available on every dashboard route.
//
// Ported from the mockup's ProducerApp (chrome="sidebar" branch only).

import { type ReactNode } from "react";

import "./design-test.css";

import { FloatingPlayer } from "./floating-player";
import { Sidebar, type Producer } from "./shell";

type DesignShellProps = {
  producer: Producer;
  children: ReactNode;
};

export function DesignShell({ producer, children }: DesignShellProps) {
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
        {children}
      </main>

      <FloatingPlayer />
    </div>
  );
}
