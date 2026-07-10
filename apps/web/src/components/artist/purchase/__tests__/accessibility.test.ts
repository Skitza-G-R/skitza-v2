import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isArtistPurchasePath } from "../../artist-shell-route";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "..", "..");
const readSrc = (...parts: string[]) => readFileSync(join(srcRoot, ...parts), "utf8");

const globalsSrc = readSrc("app", "globals.css");
const shellSrc = readSrc("components", "artist", "artist-app-shell.tsx");
const paymentSrc = readSrc("components", "artist", "purchase", "payment-instructions-screen.tsx");
const proofSrc = readSrc("components", "artist", "purchase", "upload-proof-screen.tsx");
const statusSrc = readSrc("components", "artist", "home", "purchase-status-card.tsx");
const reviewSrc = readSrc("components", "artist", "purchase", "review-agree-screen.tsx");
const sentSrc = readSrc("components", "artist", "purchase", "request-sent-screen.tsx");
const productSrc = readSrc("components", "artist", "purchase", "product-detail-screen.tsx");
const stickySrc = readSrc("components", "artist", "sticky-nav.tsx");

type Rgb = readonly [number, number, number];

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return (
    0.2126 * channelLuminance(color[0]) +
    0.7152 * channelLuminance(color[1]) +
    0.0722 * channelLuminance(color[2])
  );
}

function contrast(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
    Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
    Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
  ];
}

function token(block: string, name: string): Rgb {
  const match = block.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`));
  if (!match) throw new Error(`Missing numeric token --${name}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const rootStart = globalsSrc.indexOf(":root {");
const darkStart = globalsSrc.indexOf('  [data-theme="chrome-dark"],\n  [data-theme="dark"] {');
const darkEnd = globalsSrc.indexOf(
  '  [data-theme="chrome-dark"], [data-theme="dark"] { color-scheme: dark; }',
  darkStart,
);
const lightTokens = globalsSrc.slice(rootStart, darkStart);
const darkTokens = globalsSrc.slice(darkStart, darkEnd);

describe("artist purchase accessibility contract", () => {
  it("removes normal artist chrome from purchase routes and exposes a skip-link target", () => {
    expect(isArtistPurchasePath("/artist/purchase/product-1")).toBe(true);
    expect(isArtistPurchasePath("/artist/purchase/product-1/pay/proof")).toBe(true);
    expect(isArtistPurchasePath("/artist/store")).toBe(false);
    expect(shellSrc.match(/<ArtistShellChrome>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(shellSrc).toMatch(/<main[\s\S]*?id="main-content"[\s\S]*?tabIndex=\{-1\}/);
  });

  it.each([
    ["light", lightTokens],
    ["dark", darkTokens],
  ] as const)("keeps %s semantic text and control tokens at AA contrast", (_theme, block) => {
    const background = token(block, "bg-background");
    const elevated = token(block, "bg-elevated");
    const sidebar = token(block, "bg-sidebar");
    const brand = token(block, "brand-primary");
    const success = token(block, "fg-success");
    const danger = token(block, "fg-danger");
    const warning = token(block, "fg-warning");

    expect(
      contrast(token(block, "brand-primary-text"), composite(brand, elevated, 0.16)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(token(block, "fg-success-text"), composite(success, elevated, 0.14)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(token(block, "fg-danger-text"), composite(danger, elevated, 0.12)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(token(block, "fg-warning-text"), composite(warning, elevated, 0.1)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(block, "fg-onsidebar"), sidebar)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(block, "focus-ring"), background)).toBeGreaterThanOrEqual(3);
    expect(contrast(token(block, "focus-ring"), elevated)).toBeGreaterThanOrEqual(3);
    expect(contrast(token(block, "focus-ring"), sidebar)).toBeGreaterThanOrEqual(3);
    expect(contrast(token(block, "border-control"), elevated)).toBeGreaterThanOrEqual(3);
    expect(
      contrast(token(block, "fg-on-success"), token(block, "fg-success-text")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("announces copy and upload status changes without moving focus", () => {
    expect(paymentSrc).toMatch(/role="status"[\s\S]*?aria-live="polite"/);
    expect(paymentSrc).toMatch(/Copied: \$\{label\}/);
    expect(paymentSrc).toMatch(/Copy manually: \$\{label\}/);
    expect(paymentSrc).toMatch(/buttonRef\.current\?\.focus\(\)/);
    expect(proofSrc).toMatch(/role="status"[\s\S]*?aria-live="polite"/);
    expect(proofSrc).toMatch(/aria-valuetext=/);
  });

  it("exposes booking progress state and semantic content collections", () => {
    expect(statusSrc).toMatch(/aria-current=\{state === "active"/);
    expect(statusSrc).toMatch(/current step/);
    expect(statusSrc).toMatch(/completed/);
    expect(productSrc).toMatch(/<ul className="flex list-none flex-col/);
    expect(reviewSrc).toMatch(/<ol className="list-none/);
    expect(reviewSrc).toMatch(/<h3/);
    expect(sentSrc).toMatch(/<ol className="relative list-none"/);
    expect(sentSrc).toMatch(/aria-current=\{i === 1 \? "step"/);
    expect(proofSrc).toMatch(/<ul className="flex list-none flex-col/);
  });

  it("gates every purchase animation for reduced-motion users", () => {
    expect(reviewSrc).toMatch(/animate-spin[^"]*motion-reduce:animate-none/);
    expect(proofSrc.match(/motion-reduce:animate-none/g)?.length).toBeGreaterThanOrEqual(2);
    expect(proofSrc).toMatch(/motion-reduce:transition-none/);
    expect(stickySrc).toMatch(/sk-sticky-nav-backing/);
    expect(stickySrc).toMatch(/sk-sticky-nav-title/);
    expect(globalsSrc).toMatch(/\.skip-to-content\s*\{\s*transition: none !important;\s*\}/);
    expect(globalsSrc).toMatch(/\.sk-sticky-nav-backing\s*\{\s*transition: none !important;\s*\}/);
    expect(globalsSrc).toMatch(/\.sk-sticky-nav-title\s*\{\s*transform: none !important;\s*\}/);
  });

  it("guarantees a 44px home purchase action", () => {
    expect(statusSrc).toMatch(/sk-cta-press[^"]*min-h-11/);
  });

  it("gives every purchase stage a unique document title", () => {
    const pages = [
      ["[productId]", "Product details"],
      ["[productId]/agree", "Review and agree"],
      ["[productId]/sent", "Request sent"],
      ["[productId]/pay", "Choose a payment plan"],
      ["[productId]/pay/instructions", "Payment instructions"],
      ["[productId]/pay/proof", "Upload payment proof"],
    ] as const;

    for (const [path, title] of pages) {
      const page = readSrc("app", "(artist)", "artist", "purchase", path, "page.tsx");
      expect(page).toContain(`export const metadata: Metadata = { title: "${title}" };`);
    }
  });
});
