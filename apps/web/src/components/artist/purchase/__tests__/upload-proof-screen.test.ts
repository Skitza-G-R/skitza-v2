import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatShekels, paidProgress, proofStatusCopy } from "../pay-data";

// Real unit checks on the pure helpers the screen leans on (running total +
// status copy), plus source-grep on the S9 screen for the wiring that matters
// — matching the repo's existing test style (see commit-screens.test.ts).

describe("pay-data helpers used by S9", () => {
  it("derives a clamped running-total progress from paid / total", () => {
    const half = paidProgress(120000, 240000);
    expect(half.pct).toBe(50);
    expect(half.isPaidInFull).toBe(false);
    expect(half.paidLabel).toBe("₪1,200");
    expect(half.totalLabel).toBe("₪2,400");

    const full = paidProgress(240000, 240000);
    expect(full.pct).toBe(100);
    expect(full.isPaidInFull).toBe(true);

    // never overshoots when overpaid
    expect(paidProgress(300000, 240000).pct).toBe(100);
  });

  it("gives each proof status a headline + tone", () => {
    expect(proofStatusCopy("empty").tone).toBe("neutral");
    expect(proofStatusCopy("uploading").tone).toBe("pending");
    expect(proofStatusCopy("awaiting", "Gili Studio").headline).toContain(
      "Gili Studio",
    );
    expect(proofStatusCopy("rejected").tone).toBe("danger");
    expect(proofStatusCopy("paid").tone).toBe("success");
  });

  it("formats the proof amount as whole grouped shekels", () => {
    expect(formatShekels(120000)).toBe("₪1,200");
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const S9_PATH = join(here, "..", "upload-proof-screen.tsx");
const s9Src = readFileSync(S9_PATH, "utf8");

describe("upload-proof-screen.tsx (S9) wiring", () => {
  it("is a client component", () => {
    expect(s9Src).toMatch(/^"use client";/);
  });

  it("imports the running-total + status helpers from pay-data", () => {
    expect(s9Src).toMatch(/paidProgress/);
    expect(s9Src).toMatch(/proofStatusCopy/);
    expect(s9Src).toMatch(/formatShekels/);
    expect(s9Src).toMatch(/from "\.\/pay-data"/);
  });

  it("uses the funnel chrome (back arrow top-left, no tab bar)", () => {
    expect(s9Src).toMatch(/FunnelTopBar/);
    expect(s9Src).toMatch(/Upload proof/);
  });

  it("renders a real file input that accepts images + pdf", () => {
    expect(s9Src).toMatch(/type="file"/);
    // accept must include image/* and pdf (heic too)
    expect(s9Src).toMatch(/accept="[^"]*image\/\*[^"]*"/);
    expect(s9Src).toMatch(/accept="[^"]*\.pdf[^"]*"/);
  });

  it("gates Send on a file being attached (disabled until file state set)", () => {
    // the primary action's disabled prop reads the attached-file state
    expect(s9Src).toMatch(/disabled=\{[^}]*!file/);
    expect(s9Src).toMatch(/Send proof/);
  });

  it("drives the running total off paidProgress (thin bar + label)", () => {
    expect(s9Src).toMatch(/paidProgress\(/);
    expect(s9Src).toMatch(/Paid so far/);
    // the progress bar width is bound to the computed pct
    expect(s9Src).toMatch(/\.pct/);
  });

  it("shows previous proofs from props with a status chip each", () => {
    expect(s9Src).toMatch(/proofs/);
    expect(s9Src).toMatch(/proofStatusCopy\(/);
  });

  it("designs the rejected state with a re-upload affordance + producer note", () => {
    expect(s9Src).toMatch(/rejected/);
    expect(s9Src).toMatch(/[Rr]e-?upload/);
  });

  it("sending is a STUB — no server / R2 upload import (BE-2)", () => {
    expect(s9Src).not.toMatch(/createCaller/);
    expect(s9Src).not.toMatch(/presign|R2|fetch\(/);
    // a local timed stub stands in for the real upload
    expect(s9Src).toMatch(/setTimeout/);
  });
});
