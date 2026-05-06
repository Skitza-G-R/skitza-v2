import { describe, it, expect } from "vitest";

import {
  PORTFOLIO_PLATFORMS,
  isValidLinkUrl,
  linkRowError,
  toLinksPayload,
  EXTERNAL_LINK_INPUT_CLASS,
  type ExternalLinksFormState,
  type PortfolioPlatformKey,
} from "../external-links-editor";

// Story 06 — Onboarding portfolio external-links editor.
//
// The editor renders 3 platform inputs (Spotify / YouTube / Instagram).
// All 3 are optional; lenient http(s)-prefix validation; on save, the
// component hands a normalized payload to the server action.
//
// The repo runs vitest in `node` env (no jsdom) so this file pins the
// pure helpers exported by external-links-editor.tsx — same pattern as
// progress-bar.test.tsx + action-bar.test.tsx (Story 02). The React
// component is a thin shell around these helpers, so pinning them here
// covers the contract that matters: the 3 platforms exposed, the
// validation rule, the serialization shape that the server action
// consumes.

describe("PORTFOLIO_PLATFORMS — exposed enum (Story 06 acceptance)", () => {
  it("exposes exactly 3 platforms (Spotify / YouTube / Instagram) — not the full 7-member enum", () => {
    expect(PORTFOLIO_PLATFORMS).toHaveLength(3);
    expect(PORTFOLIO_PLATFORMS.map((p) => p.key)).toEqual([
      "spotify",
      "youtube",
      "instagram_reels",
    ]);
  });

  it("uses the canonical DB enum value 'instagram_reels' (not 'instagram') — wire-format must match schema.ts:767", () => {
    const ig = PORTFOLIO_PLATFORMS.find((p) => p.key === "instagram_reels");
    expect(ig).toBeDefined();
  });

  it("each platform supplies a producer-facing label + placeholder URL", () => {
    for (const p of PORTFOLIO_PLATFORMS) {
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.placeholder).toBe("string");
      expect(p.placeholder).toMatch(/^https:\/\//);
    }
  });
});

describe("isValidLinkUrl — lenient http(s) check (acceptance: 'no regex hell')", () => {
  it("returns true for empty string (empty means 'delete this platform's row')", () => {
    expect(isValidLinkUrl("")).toBe(true);
  });

  it("returns true for whitespace-only string (treated as empty after trim)", () => {
    expect(isValidLinkUrl("   ")).toBe(true);
    expect(isValidLinkUrl("\t\n")).toBe(true);
  });

  it("returns true for any non-empty string starting with https://", () => {
    expect(isValidLinkUrl("https://open.spotify.com/artist/abc")).toBe(true);
    expect(isValidLinkUrl("https://youtube.com/@adastudios")).toBe(true);
    expect(isValidLinkUrl("https://instagram.com/adastudios")).toBe(true);
  });

  it("returns true for any non-empty string starting with http:// (lenient)", () => {
    // Architecture: 'must start with http:// or https:// if non-empty'.
    // Plain HTTP is increasingly rare but the spec is explicit — so we
    // honour it rather than silently upgrade the rule.
    expect(isValidLinkUrl("http://example.com/foo")).toBe(true);
  });

  it("returns false for non-empty strings missing http(s):// prefix", () => {
    expect(isValidLinkUrl("open.spotify.com/artist/abc")).toBe(false);
    expect(isValidLinkUrl("youtube.com/@x")).toBe(false);
    expect(isValidLinkUrl("just-some-text")).toBe(false);
    // Common typo — http: with no slashes — must fail.
    expect(isValidLinkUrl("http:/example.com")).toBe(false);
  });

  it("rejects javascript: / data: schemes (defense against non-web URLs)", () => {
    // The acceptance criterion is 'must start with http:// or https://'.
    // Any other scheme — including javascript: / data: / file: — fails
    // the check, which is the safest reading of the spec.
    expect(isValidLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isValidLinkUrl("data:text/html,<h1>x</h1>")).toBe(false);
    expect(isValidLinkUrl("ftp://example.com/x")).toBe(false);
  });
});

describe("linkRowError — surfaces error string for UI", () => {
  it("returns null for empty input (no error to show)", () => {
    expect(linkRowError("")).toBeNull();
    expect(linkRowError("   ")).toBeNull();
  });

  it("returns null for valid http(s) URL", () => {
    expect(linkRowError("https://open.spotify.com/artist/abc")).toBeNull();
    expect(linkRowError("http://example.com")).toBeNull();
  });

  it("returns a non-empty error string for malformed URL", () => {
    const err = linkRowError("open.spotify.com");
    expect(err).not.toBeNull();
    expect(typeof err).toBe("string");
    expect((err as string).length).toBeGreaterThan(0);
    // Producer-facing copy must mention the http(s):// requirement so
    // the fix is obvious without reading docs.
    expect((err as string)).toMatch(/http/i);
  });
});

describe("toLinksPayload — serialise form state → server-action input", () => {
  // T8 — form state is now { url, title } per platform. Payload sent
  // to saveExternalLinks(...) is { links: [{platform, url, title}, ...] }.
  // Empty URLs must STILL be in the payload so the server can DELETE
  // any existing row.

  it("emits 3 entries (one per exposed platform) even when all fields are empty", () => {
    const state: ExternalLinksFormState = {
      spotify: { url: "", title: "" },
      youtube: { url: "", title: "" },
      instagram_reels: { url: "", title: "" },
    };
    const payload = toLinksPayload(state);
    expect(payload.links).toHaveLength(3);
    expect(payload.links.map((l) => l.platform).sort()).toEqual([
      "instagram_reels",
      "spotify",
      "youtube",
    ]);
    for (const l of payload.links) {
      expect(l.url).toBe("");
      expect(l.title).toBe("");
    }
  });

  it("trims whitespace on each URL and title", () => {
    const state: ExternalLinksFormState = {
      spotify: { url: "  https://open.spotify.com/artist/abc  ", title: "  Latest single  " },
      youtube: { url: "\thttps://youtube.com/@x\n", title: "" },
      instagram_reels: { url: "", title: "" },
    };
    const payload = toLinksPayload(state);
    const spotify = payload.links.find((l) => l.platform === "spotify");
    const youtube = payload.links.find((l) => l.platform === "youtube");
    expect(spotify?.url).toBe("https://open.spotify.com/artist/abc");
    expect(spotify?.title).toBe("Latest single");
    expect(youtube?.url).toBe("https://youtube.com/@x");
    expect(youtube?.title).toBe("");
  });

  it("normalises whitespace-only URLs to '' (so server treats as DELETE)", () => {
    const state: ExternalLinksFormState = {
      spotify: { url: "   ", title: "" },
      youtube: { url: "", title: "" },
      instagram_reels: { url: "\t\n", title: "" },
    };
    const payload = toLinksPayload(state);
    for (const l of payload.links) expect(l.url).toBe("");
  });

  it("preserves a mix of filled + empty rows (partial-save case)", () => {
    const state: ExternalLinksFormState = {
      spotify: { url: "https://open.spotify.com/artist/abc", title: "Studio reel" },
      youtube: { url: "", title: "" },
      instagram_reels: { url: "https://instagram.com/x", title: "" },
    };
    const payload = toLinksPayload(state);
    const map = new Map<PortfolioPlatformKey, { url: string; title: string }>();
    for (const l of payload.links) map.set(l.platform, { url: l.url, title: l.title });
    expect(map.get("spotify")).toEqual({
      url: "https://open.spotify.com/artist/abc",
      title: "Studio reel",
    });
    expect(map.get("youtube")).toEqual({ url: "", title: "" });
    expect(map.get("instagram_reels")).toEqual({
      url: "https://instagram.com/x",
      title: "",
    });
  });
});

describe("EXTERNAL_LINK_INPUT_CLASS — token-only styling + 44px tap target", () => {
  // CLAUDE.md mobile rule: every interactive control must be ≥ 44×44 px.
  // The Input primitive defaults to h-10 (40px) so the editor must
  // override to min-h-11 (44px). Pin it.
  it("uses min-h-11 for ≥ 44px tap target", () => {
    expect(EXTERNAL_LINK_INPUT_CLASS).toMatch(/min-h-11/);
  });

  it("never references hex colors (CSS-vars-only repo rule)", () => {
    expect(EXTERNAL_LINK_INPUT_CLASS).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
