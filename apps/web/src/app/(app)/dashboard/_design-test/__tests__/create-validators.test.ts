// Pure-function validators for the design-test New Project + New
// Product modals. Each returns the first user-facing error message
// or null when the input is OK. Mirrors the server-side Zod schemas
// so the modal can show inline errors without a round-trip on every
// keystroke (the server still validates, this is just UX feedback).

import { describe, expect, it } from "vitest";

import {
  validateNewProductInput,
  validateNewProjectInput,
  validateNewSongInput,
} from "../create-validators";

describe("validateNewProjectInput", () => {
  const ok = {
    title: "Sunset Sessions",
    artistName: "Lena Cruz",
    artistEmail: "lena@example.com",
  };

  it("returns null for valid input", () => {
    expect(validateNewProjectInput(ok)).toBeNull();
  });

  it("trims whitespace before checking emptiness", () => {
    expect(validateNewProjectInput({ ...ok, title: "   " })).toMatch(/title/i);
  });

  it("requires title", () => {
    expect(validateNewProjectInput({ ...ok, title: "" })).toMatch(/title/i);
  });

  it("requires artist name", () => {
    expect(validateNewProjectInput({ ...ok, artistName: "" })).toMatch(/name/i);
  });

  it("requires artist email", () => {
    expect(validateNewProjectInput({ ...ok, artistEmail: "" })).toMatch(/email/i);
  });

  it("rejects an obviously malformed email", () => {
    expect(validateNewProjectInput({ ...ok, artistEmail: "not-an-email" })).toMatch(/email/i);
  });

  it("caps title at the server's 120-char limit", () => {
    expect(validateNewProjectInput({ ...ok, title: "x".repeat(121) })).toMatch(/title/i);
    expect(validateNewProjectInput({ ...ok, title: "x".repeat(120) })).toBeNull();
  });
});

describe("validateNewProductInput", () => {
  const ok = {
    title: "Mixing session",
    durationMin: 120,
    priceCents: 25000,
  };

  it("returns null for valid input", () => {
    expect(validateNewProductInput(ok)).toBeNull();
  });

  it("requires title", () => {
    expect(validateNewProductInput({ ...ok, title: "" })).toMatch(/title/i);
  });

  it("rejects negative or zero price", () => {
    expect(validateNewProductInput({ ...ok, priceCents: 0 })).toMatch(/price/i);
    expect(validateNewProductInput({ ...ok, priceCents: -100 })).toMatch(/price/i);
  });

  it("rejects negative or zero duration", () => {
    // 0 is reserved for pure-delivery products in the booking router
    // (no slot grid), but the design-test modal is for session-style
    // products only — durationMin must be > 0 here.
    expect(validateNewProductInput({ ...ok, durationMin: 0 })).toMatch(/duration|length/i);
    expect(validateNewProductInput({ ...ok, durationMin: -30 })).toMatch(/duration|length/i);
  });

  it("rejects duration > 24h", () => {
    expect(validateNewProductInput({ ...ok, durationMin: 25 * 60 })).toMatch(/duration|length/i);
  });

  it("requires non-integer minute values to round-trip cleanly via Math.floor in callers", () => {
    // Validator itself accepts the float; callers floor before sending.
    // This test pins that the validator doesn't reject 90.5 outright,
    // so a slider that emits floats won't be marked invalid.
    expect(validateNewProductInput({ ...ok, durationMin: 90.5 })).toBeNull();
  });
});

describe("validateNewSongInput", () => {
  const ok = {
    projectId: "11111111-1111-1111-1111-111111111111",
    title: "Sunset Drive",
  };

  it("returns null for valid input", () => {
    expect(validateNewSongInput(ok)).toBeNull();
  });

  it("requires a project to be selected", () => {
    expect(validateNewSongInput({ ...ok, projectId: "" })).toMatch(/project/i);
  });

  it("requires title", () => {
    expect(validateNewSongInput({ ...ok, title: "" })).toMatch(/title|name/i);
  });

  it("trims whitespace", () => {
    expect(validateNewSongInput({ ...ok, title: "   " })).toMatch(/title|name/i);
  });

  it("caps title at 120 chars (matches addTrack input on server)", () => {
    expect(validateNewSongInput({ ...ok, title: "x".repeat(120) })).toBeNull();
    expect(validateNewSongInput({ ...ok, title: "x".repeat(121) })).toMatch(/title|name/i);
  });
});
