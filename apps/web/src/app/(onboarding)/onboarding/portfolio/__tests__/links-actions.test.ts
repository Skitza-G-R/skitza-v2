import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { UserRole } from "~/server/auth/role";

// Story 06 — saveExternalLinks server action.
//
// Contract:
//   "use server";
//   async function saveExternalLinks(input: {
//     links: { platform: "spotify" | "youtube" | "instagram_reels"; url: string }[];
//   }): Promise<void>;
//
// For each input link:
//   - url === ""      → DELETE FROM producer_external_links
//                       WHERE producer_id = ctx.producerId AND platform = link.platform
//   - url non-empty   → INSERT … ON CONFLICT (producer_id, platform)
//                       DO UPDATE SET url = EXCLUDED.url
//
// Auth-scoping rule (CLAUDE.md): every mutation's WHERE / values must
// include eq(producerExternalLinks.producerId, ctx.producerId), where
// ctx.producerId is resolved from the Clerk session via fetchUserRole
// — NEVER trusted from input.
//
// The most-overlooked branch is "empty URL → DELETE" — the QA
// checklist flags it specifically. Pin it FIRST so it can't regress
// silently to "skip empty entries" or "always upsert".

// ─── Marker objects so the dbMock can branch on which table the
// caller hit. The schema imports we mock below export these markers.
// Per-column sub-markers let findPredicate distinguish predicates by
// column (producerId vs platform); without them, both `.producerId`
// and `.platform` would resolve to undefined and findPredicate would
// always return the first eq in the and-tree.
const producerExternalLinksMarker = {
  __table: "producer_external_links",
  producerId: { __col: "producer_id" },
  platform: { __col: "platform" },
};

// Capture WHERE / values argument trees so tests can walk them via
// findPredicate. Each delete .where() and each insert .values() get
// recorded; we pin the producer-scope predicate on every call.
const deleteWhereSpy = vi.fn<(arg: unknown) => unknown>();
const insertValuesSpy = vi.fn<(arg: unknown) => unknown>();
const onConflictSpy = vi.fn<(arg: unknown) => Promise<void>>();

const deleteMock = vi.fn(() => ({
  where: (arg: unknown) => {
    deleteWhereSpy(arg);
    return Promise.resolve(undefined);
  },
}));
const insertMock = vi.fn(() => ({
  values: (arg: unknown) => {
    insertValuesSpy(arg);
    return {
      onConflictDoUpdate: (cfg: unknown) => onConflictSpy(cfg),
    };
  },
}));

const dbMock = {
  delete: deleteMock,
  insert: insertMock,
};

// Stateful Clerk + role mocks — happy-path defaults; individual tests
// override via the `let` binding below.
let mockUserId: string | null = "user_test_1";
let mockRole: UserRole = {
  kind: "producer-complete",
  producer: {
    id: "producer-uuid-1",
    displayName: "Ada Studios",
    slug: "ada-studios-abcd",
    email: "ada@example.com",
  },
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: mockUserId }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producerExternalLinks: producerExternalLinksMarker,
  // Column markers — the action's WHERE clauses hit these specific
  // columns; tests assert producerId scoping by walking the predicate
  // tree for the producerId marker.
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
}));
vi.mock("~/server/auth/role", () => ({
  fetchUserRole: () => Promise.resolve(mockRole),
}));

// Walk an arbitrarily nested and(...) tree to find an eq(<col>, <val>)
// predicate matching the requested column marker. Same helper used in
// producer-music.test.ts. Returns the matched [col, val] tuple or null.
function findPredicate(
  where: unknown,
  operator: "eq",
  columnMarker: unknown,
): unknown[] | null {
  if (!where || typeof where !== "object") return null;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const p of (where as { and: unknown[] }).and) {
      const found = findPredicate(p, operator, columnMarker);
      if (found) return found;
    }
    return null;
  }
  if (operator in where) {
    const args = (where as Record<string, unknown>)[operator];
    if (Array.isArray(args) && args[0] === columnMarker) {
      return args as unknown[];
    }
  }
  return null;
}

beforeEach(() => {
  deleteMock.mockClear();
  deleteWhereSpy.mockClear();
  insertMock.mockClear();
  insertValuesSpy.mockClear();
  onConflictSpy.mockReset().mockResolvedValue(undefined);
  mockUserId = "user_test_1";
  mockRole = {
    kind: "producer-complete",
    producer: {
      id: "producer-uuid-1",
      displayName: "Ada Studios",
      slug: "ada-studios-abcd",
      email: "ada@example.com",
    },
  };
  process.env.DATABASE_URL = "postgresql://test/test";
});

// Pre-test smoke — the markers exported from @skitza/db carry the same
// reference identity used by the action. Re-import here so tests can
// reach into the marker object structure when asserting predicates.
// Return type narrowed to the runtime marker shape (the static type
// from @skitza/db would point at the real Drizzle pgTable, which is
// not what the mock returns).
type ExternalLinksMarker = {
  __table: string;
  producerId: unknown;
  platform: unknown;
};
async function getDbMarkers(): Promise<{ producerExternalLinks: ExternalLinksMarker }> {
  const db = await import("@skitza/db");
  return {
    producerExternalLinks: db.producerExternalLinks as unknown as ExternalLinksMarker,
  };
}

describe("saveExternalLinks — empty URL deletes the platform row (acceptance criterion 4 — most-overlooked branch)", () => {
  it("issues a DELETE for each empty-URL link (no UPSERT)", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    await saveExternalLinks({
      links: [
        { platform: "spotify", url: "" },
        { platform: "youtube", url: "" },
        { platform: "instagram_reels", url: "" },
      ],
    });
    // 3 DELETEs, 0 INSERTs.
    expect(deleteMock).toHaveBeenCalledTimes(3);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("scopes each DELETE WHERE to ctx.producerId (auth boundary — findPredicate)", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    const { producerExternalLinks } = await getDbMarkers();
    await saveExternalLinks({
      links: [{ platform: "spotify", url: "" }],
    });
    expect(deleteWhereSpy).toHaveBeenCalledTimes(1);
    const where = deleteWhereSpy.mock.calls[0]?.[0];
    // Walk the AND tree for the producerId scoping predicate.
    // producerExternalLinks.producerId is the column marker we expect.
    const producerCol = producerExternalLinks.producerId;
    const pred = findPredicate(where, "eq", producerCol);
    expect(pred).not.toBeNull();
    if (pred) expect(pred[1]).toBe("producer-uuid-1");
  });

  it("scopes each DELETE WHERE to the requested platform (so we don't delete other platforms)", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    const { producerExternalLinks } = await getDbMarkers();
    await saveExternalLinks({
      links: [{ platform: "youtube", url: "" }],
    });
    const where = deleteWhereSpy.mock.calls[0]?.[0];
    const platformCol = producerExternalLinks.platform;
    const pred = findPredicate(where, "eq", platformCol);
    expect(pred).not.toBeNull();
    if (pred) expect(pred[1]).toBe("youtube");
  });
});

describe("saveExternalLinks — non-empty URL inserts (or updates on conflict)", () => {
  it("issues an INSERT for each non-empty URL (no DELETE)", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    await saveExternalLinks({
      links: [
        { platform: "spotify", url: "https://open.spotify.com/artist/abc" },
        { platform: "youtube", url: "https://youtube.com/@adastudios" },
      ],
    });
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("scopes each INSERT values to ctx.producerId", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    await saveExternalLinks({
      links: [
        { platform: "spotify", url: "https://open.spotify.com/artist/abc" },
      ],
    });
    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    const valuesArg = insertValuesSpy.mock.calls[0]?.[0] as
      | { producerId?: string; platform?: string; url?: string }
      | undefined;
    // Must mirror the producerId derived from fetchUserRole — never
    // from input. Pin both producerId + platform + url so a refactor
    // that drops the producerId field is caught.
    expect(valuesArg?.producerId).toBe("producer-uuid-1");
    expect(valuesArg?.platform).toBe("spotify");
    expect(valuesArg?.url).toBe("https://open.spotify.com/artist/abc");
  });

  it("uses ON CONFLICT (producer_id, platform) DO UPDATE SET url=EXCLUDED.url so re-saves replace existing", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    await saveExternalLinks({
      links: [
        { platform: "spotify", url: "https://open.spotify.com/artist/abc" },
      ],
    });
    expect(onConflictSpy).toHaveBeenCalledTimes(1);
    const arg = onConflictSpy.mock.calls[0]?.[0] as
      | { target: unknown; set?: { url?: unknown } }
      | undefined;
    // The ON CONFLICT clause must overwrite the URL — this is the
    // upsert semantics. If the action skipped `set` entirely, a re-save
    // would silently no-op on existing rows.
    expect(arg?.set?.url).toBeDefined();
  });
});

describe("saveExternalLinks — mixed batch (acceptance: both at once)", () => {
  it("handles a mixed payload (1 empty, 2 non-empty) with the right call counts", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    await saveExternalLinks({
      links: [
        { platform: "spotify", url: "https://open.spotify.com/artist/abc" },
        { platform: "youtube", url: "" },
        { platform: "instagram_reels", url: "https://instagram.com/x" },
      ],
    });
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("the producerId on every INSERT + DELETE is the same caller-scope value (no input override)", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    const { producerExternalLinks } = await getDbMarkers();
    await saveExternalLinks({
      links: [
        { platform: "spotify", url: "https://open.spotify.com/artist/abc" },
        { platform: "youtube", url: "" },
      ],
    });
    // INSERT: producerId field on values.
    const valuesArg = insertValuesSpy.mock.calls[0]?.[0] as
      | { producerId?: string }
      | undefined;
    expect(valuesArg?.producerId).toBe("producer-uuid-1");
    // DELETE: producerId predicate via findPredicate.
    const where = deleteWhereSpy.mock.calls[0]?.[0];
    const producerCol = producerExternalLinks.producerId;
    const pred = findPredicate(where, "eq", producerCol);
    expect(pred?.[1]).toBe("producer-uuid-1");
  });
});

describe("saveExternalLinks — auth invariants", () => {
  it("throws unauthorized when no userId in Clerk session", async () => {
    mockUserId = null;
    const { saveExternalLinks } = await import("../links-actions");
    await expect(
      saveExternalLinks({
        links: [{ platform: "spotify", url: "https://open.spotify.com/artist/abc" }],
      }),
    ).rejects.toThrow(/unauthorized/i);
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("throws missing DATABASE_URL when env var absent", async () => {
    delete process.env.DATABASE_URL;
    const { saveExternalLinks } = await import("../links-actions");
    await expect(
      saveExternalLinks({
        links: [{ platform: "spotify", url: "https://open.spotify.com/artist/abc" }],
      }),
    ).rejects.toThrow(/database/i);
  });

  it("rejects when caller role is 'artist' (defense vs raw HTTP POST bypass)", async () => {
    mockRole = { kind: "artist" };
    const { saveExternalLinks } = await import("../links-actions");
    await expect(
      saveExternalLinks({
        links: [{ platform: "spotify", url: "https://open.spotify.com/artist/abc" }],
      }),
    ).rejects.toThrow(/forbidden|artist/i);
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("rejects when caller role is 'orphan' (no producers row → can't scope writes)", async () => {
    mockRole = { kind: "orphan" };
    const { saveExternalLinks } = await import("../links-actions");
    await expect(
      saveExternalLinks({
        links: [{ platform: "spotify", url: "https://open.spotify.com/artist/abc" }],
      }),
    ).rejects.toThrow(/forbidden|producer/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("proceeds for both 'producer-incomplete' and 'producer-complete' (mid-flow allowed)", async () => {
    mockRole = {
      kind: "producer-incomplete",
      producer: {
        id: "producer-uuid-1",
        displayName: null,
        slug: "ada-abcd",
        email: "ada@example.com",
      },
    };
    const { saveExternalLinks } = await import("../links-actions");
    await saveExternalLinks({
      links: [{ platform: "spotify", url: "https://open.spotify.com/artist/abc" }],
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe("saveExternalLinks — input validation (zod)", () => {
  it("rejects unknown platform via zod", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    const bad = {
      links: [{ platform: "myspace", url: "https://example.com/x" }],
    } as unknown as Parameters<typeof saveExternalLinks>[0];
    await expect(saveExternalLinks(bad)).rejects.toBeInstanceOf(ZodError);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects URLs longer than 500 chars (DB column is text but UI cap is 500)", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    const tooLong = "https://example.com/" + "x".repeat(600);
    await expect(
      saveExternalLinks({
        links: [{ platform: "spotify", url: tooLong }],
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects when links is not an array", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    const bad = { links: "not-an-array" } as unknown as Parameters<
      typeof saveExternalLinks
    >[0];
    await expect(saveExternalLinks(bad)).rejects.toBeInstanceOf(ZodError);
  });

  it("accepts empty links array (no-op)", async () => {
    const { saveExternalLinks } = await import("../links-actions");
    await saveExternalLinks({ links: [] });
    expect(insertMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
