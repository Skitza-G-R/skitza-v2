/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — shared shell. Wraps any tab body in the .dt-root
// scope, mounts the Sidebar + global FloatingPlayer + Cmd-K palette.
//
// Ported from the mockup's ProducerApp (chrome="sidebar" branch only).

import { type ReactNode, useEffect, useState } from "react";

import "./design-test.css";

import { CommandPalette, type PaletteData } from "./command-palette";
import { FloatingPlayer } from "./floating-player";
import { Sidebar, type Producer } from "./shell";

type DesignShellProps = {
  producer: Producer;
  children: ReactNode;
  /** Optional palette data — when present, the Cmd-K palette searches
   * across projects/tracks/clients. When absent (route hasn't fetched
   * it yet), the palette still opens with just the tab list. */
  paletteData?: PaletteData;
};

const EMPTY_PALETTE: PaletteData = { projects: [], tracks: [], clients: [] };

export function DesignShell({ producer, children, paletteData }: DesignShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global ⌘K / Ctrl+K binding + "/" shortcut (when not in an input).
  // Esc inside the palette is handled by the palette itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const inField =
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((s) => !s);
      } else if (e.key === "/" && !inField && !paletteOpen) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [paletteOpen]);

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

      <Sidebar
        producer={producer}
        todayPreview={null}
        onOpenPalette={() => setPaletteOpen(true)}
      />

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
      {paletteOpen && (
        <CommandPalette
          data={paletteData ?? EMPTY_PALETTE}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
