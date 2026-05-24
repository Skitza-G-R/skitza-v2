import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../greeting-strip.tsx"),
  "utf-8",
);

describe("GreetingStrip", () => {
  it("exports a server component", () => {
    expect(SRC).toMatch(/export\s+function\s+GreetingStrip/);
    expect(SRC).not.toMatch(/^"use client"/m);
  });

  it("renders date eyebrow with Mono uppercase styling", () => {
    expect(SRC).toMatch(/uppercase/);
    expect(SRC).toMatch(/--font-jetbrains-mono/);
  });

  it("renders greeting with Syne", () => {
    expect(SRC).toMatch(/--font-syne/);
  });

  it("does NOT render a search input or '+ New project' CTA", () => {
    expect(SRC).not.toMatch(/<input/i);
    expect(SRC).not.toMatch(/New project/i);
  });

  it("exposes a time-of-day greeting helper", () => {
    expect(SRC).toMatch(/function\s+greetingForHour/);
  });
});
