import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep on the funnel route pages: SK-46 swapped the mock-first
// wiring for the real BE-1 callers. These tests pin the swap so a future
// refactor can't silently fall back to placeholder data.

const here = dirname(fileURLToPath(import.meta.url));
const s3Src = readFileSync(join(here, "..", "page.tsx"), "utf8");
const s4Src = readFileSync(join(here, "..", "agree", "page.tsx"), "utf8");
const s5Src = readFileSync(join(here, "..", "sent", "page.tsx"), "utf8");
const SRC_ROOT = join(here, "..", "..", "..", "..", "..", "..");
const routerSrc = readFileSync(
  join(SRC_ROOT, "server", "trpc", "routers", "purchase.ts"),
  "utf8",
);
const actionsSrc = readFileSync(
  join(SRC_ROOT, "components", "artist", "purchase", "actions.ts"),
  "utf8",
);

describe("S3 entry page (real BE-1 data)", () => {
  it("fetches the real product and maps it for the screen", () => {
    expect(s3Src).toMatch(/caller\.artist\.store\.product\(\{ productId \}\)/);
    expect(s3Src).toMatch(/toPurchaseProduct\(row\)/);
    expect(s3Src).toMatch(/toProducer\(row\)/);
    expect(s3Src).not.toMatch(/MOCK_/);
  });

  it("resolves pendingRequest from artist.purchase.pending", () => {
    expect(s3Src).toMatch(/caller\.artist\.purchase\.pending\(\{/);
    expect(s3Src).toMatch(/pendingRequest=\{Boolean\(pending\)\}/);
  });

  it("translates NOT_FOUND/BAD_REQUEST into a 404", () => {
    expect(s3Src).toMatch(/notFound\(\)/);
  });
});

describe("S4 agree page (real BE-1 data)", () => {
  it("builds the terms from the real producer + deliverables", () => {
    expect(s4Src).toMatch(/caller\.artist\.store\.product\(\{ productId \}\)/);
    expect(s4Src).toMatch(/buildAgreementTerms\(producer\.name, product\.includes\)/);
    expect(s4Src).not.toMatch(/MOCK_/);
  });
});

describe("S5 sent page (real BE-1 data)", () => {
  it("requires ?req= and falls back to the S3 entry", () => {
    expect(s5Src).toMatch(/if \(!req\) redirect\(`\/artist\/purchase\/\$\{productId\}`\)/);
  });

  it("reads the request row and renders the server-issued ref + locked price", () => {
    expect(s5Src).toMatch(/caller\.artist\.purchase\.get\(\{ purchaseRequestId: req \}\)/);
    expect(s5Src).toMatch(/requestRef=\{request\.refNumber\}/);
    expect(s5Src).toMatch(/priceCents: request\.priceCents/);
    expect(s5Src).toMatch(/name: request\.productNameSnapshot/);
    expect(s5Src).not.toMatch(/makeRequestRef/);
  });
});

describe("artist.purchase.pending read (SK-46)", () => {
  it("exists as an artistProcedure keyed by producerId", () => {
    expect(routerSrc).toMatch(/pending: artistProcedure/);
    expect(routerSrc).toMatch(/\.input\(z\.object\(\{ producerId: z\.string\(\)\.uuid\(\) \}\)\)/);
  });

  it("only surfaces status='pending' rows for the signed-in artist's contact", () => {
    expect(routerSrc).toMatch(
      /eq\(purchaseRequests\.clientContactId, contact\.id\),\s*\n\s*eq\(purchaseRequests\.status, "pending"\)/,
    );
    expect(routerSrc).toMatch(/if \(!contact\) return \{ pending: null \}/);
  });
});

describe("requestToBookAction (server action)", () => {
  it("is a server action that wraps artist.purchase.request", () => {
    expect(actionsSrc).toMatch(/^"use server";/);
    expect(actionsSrc).toMatch(/caller\.artist\.purchase\.request\(\{/);
  });

  it("locks the product's default plan (full when offered) until BE-2 plan choice", () => {
    expect(actionsSrc).toMatch(/plans\.find\(\(p\) => p\.kind === "full"\) \?\? plans\[0\]/);
  });

  it("returns a tagged union instead of throwing at the client", () => {
    expect(actionsSrc).toMatch(/\{ ok: false, error: e\.message \}/);
    expect(actionsSrc).toMatch(/purchaseRequestId: result\.purchaseRequestId/);
  });
});
