import { describe, it, expect } from "vitest";
import { emailHashFor, groupStudiosForArtist } from "./identity";

describe("emailHashFor", () => {
  it("lowercases before hashing so 'Dan@x.com' === 'dan@x.com'", () => {
    expect(emailHashFor("Dan@Example.COM")).toBe(emailHashFor("dan@example.com"));
  });

  it("trims surrounding whitespace", () => {
    expect(emailHashFor(" dan@example.com ")).toBe(emailHashFor("dan@example.com"));
  });

  it("returns a 64-char hex sha256", () => {
    expect(emailHashFor("dan@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", () => {
    const a = emailHashFor("dan@example.com");
    const b = emailHashFor("dan@example.com");
    expect(a).toBe(b);
  });
});

describe("groupStudiosForArtist", () => {
  it("returns one Studio entry per unique producerId", () => {
    const rows = [
      { producerId: "p1", producerName: "Gili Asraf Studio", producerSlug: "giasraf", producerLogoUrl: null, lastSeenAt: new Date("2026-04-15") },
      { producerId: "p2", producerName: "Yossi Productions", producerSlug: "yossi", producerLogoUrl: "https://x/y.png", lastSeenAt: new Date("2026-04-18") },
    ];
    expect(groupStudiosForArtist(rows)).toEqual([
      { producerId: "p2", name: "Yossi Productions", slug: "yossi", logoUrl: "https://x/y.png" },
      { producerId: "p1", name: "Gili Asraf Studio", slug: "giasraf", logoUrl: null },
    ]);
  });

  it("dedupes rows with the same producerId (most-recent lastSeenAt wins)", () => {
    const rows = [
      { producerId: "p1", producerName: "Gili", producerSlug: "g", producerLogoUrl: null, lastSeenAt: new Date("2026-04-10") },
      { producerId: "p1", producerName: "Gili Updated", producerSlug: "g", producerLogoUrl: null, lastSeenAt: new Date("2026-04-15") },
    ];
    const out = groupStudiosForArtist(rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Gili Updated");
  });

  it("sorts by lastSeenAt desc (most recent first)", () => {
    const rows = [
      { producerId: "p1", producerName: "A", producerSlug: "a", producerLogoUrl: null, lastSeenAt: new Date("2026-01-01") },
      { producerId: "p2", producerName: "B", producerSlug: "b", producerLogoUrl: null, lastSeenAt: new Date("2026-04-01") },
      { producerId: "p3", producerName: "C", producerSlug: "c", producerLogoUrl: null, lastSeenAt: new Date("2026-02-01") },
    ];
    expect(groupStudiosForArtist(rows).map(s => s.name)).toEqual(["B", "C", "A"]);
  });

  it("returns [] for empty input", () => {
    expect(groupStudiosForArtist([])).toEqual([]);
  });
});
