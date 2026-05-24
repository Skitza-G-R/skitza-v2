import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../last-upload-card.tsx"),
  "utf-8",
);

describe("LastUploadCard", () => {
  it("is a client component (uses player)", () => {
    expect(SRC).toMatch(/^"use client"/m);
  });

  it("imports ProducerArt and player helpers", () => {
    expect(SRC).toMatch(/import\s*\{\s*ProducerArt\s*\}/);
    expect(SRC).toMatch(/playerPlay/);
    expect(SRC).toMatch(/useNowPlaying/);
  });

  it("does NOT call tRPC directly", () => {
    expect(SRC).not.toMatch(/useMutation/);
    expect(SRC).not.toMatch(/api\.[a-zA-Z]+\.[a-zA-Z]+\.useMutation/);
  });

  it("renders the LAST UPLOAD eyebrow", () => {
    expect(SRC).toMatch(/LAST\s*UPLOAD/);
  });

  it("renders a NEW badge gated by unread", () => {
    expect(SRC).toMatch(/unread\s*&&/);
    expect(SRC).toMatch(/>NEW</);
  });

  it("renders an Open library button linking to the project page", () => {
    expect(SRC).toMatch(/Open\s*library/);
    expect(SRC).toMatch(/\/artist\/music\//);
  });

  it("renders an empty-state when latestMix is null", () => {
    expect(SRC).toMatch(/Nothing\s*new/);
  });
});
