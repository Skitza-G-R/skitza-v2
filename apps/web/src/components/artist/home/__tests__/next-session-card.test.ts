import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../next-session-card.tsx"),
  "utf-8",
);

describe("NextSessionCard (compact strip)", () => {
  it("is a server component (no client interactivity)", () => {
    expect(SRC).not.toMatch(/^"use client"/m);
  });

  it("has NO Join button", () => {
    expect(SRC).not.toMatch(/>\s*Join\s*</);
    expect(SRC).not.toMatch(/aria-label="Join"/);
  });

  it("has a single Open calendar CTA pointing to /artist/book", () => {
    expect(SRC).toMatch(/Open\s*calendar/);
    expect(SRC).toMatch(/href="\/artist\/book"/);
  });

  it("uses ProducerArt for the avatar", () => {
    expect(SRC).toMatch(/import\s*\{\s*ProducerArt\s*\}/);
  });

  it("renders TODAY badge gated by isToday helper", () => {
    expect(SRC).toMatch(/function\s+isToday/);
    expect(SRC).toMatch(/>TODAY</);
  });

  it("renders an empty state with Book a session CTA", () => {
    expect(SRC).toMatch(/No\s*session\s*booked/);
    expect(SRC).toMatch(/Book\s*a\s*session/);
  });
});
