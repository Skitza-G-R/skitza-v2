import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "producer-uuid-1";
const OTHER_PRODUCER_ID = "producer-uuid-2";
const LINK_ID = "00000000-0000-0000-0000-000000000010";
const ISSUED_TOKEN = "fake.issued.token";

// Marker objects so dbMock can branch on which table the caller hit.
// Mirrors the portfolio actions test pattern.
const producersMarker = { __table: "producers" };
const magicLinksMarker = { __table: "magic_links" };
const magicLinkViewsMarker = { __table: "magic_link_views" };

type Row = Record<string, unknown>;
const producerSelectMock = vi.fn<() => Promise<Array<{ id: string }>>>();
const linkSelectByIdMock = vi.fn<() => Promise<Array<Row>>>();
const linkInsertReturningMock = vi.fn<() => Promise<Row[]>>();
const linkUpdateReturningMock = vi.fn<() => Promise<Row[]>>();
const revalidatePathMock = vi.fn<(path: string) => void>();

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === producersMarker) {
        return { where: () => ({ limit: () => producerSelectMock() }) };
      }
      // magicLinks by-id lookup; aggregating procs aren't reached here.
      return {
        where: () => ({ limit: () => linkSelectByIdMock() }),
      };
    },
  }),
  insert: () => ({
    values: () => ({ returning: () => linkInsertReturningMock() }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({ returning: () => linkUpdateReturningMock() }),
    }),
  }),
};

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: mockUserId }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  magicLinks: magicLinksMarker,
  magicLinkViews: magicLinkViewsMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  desc: (col: unknown) => ({ desc: col }),
  sql: () => ({ sql: true }),
}));
vi.mock("~/lib/magic-links/token", () => ({
  issueMagicToken: () => ISSUED_TOKEN,
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => { revalidatePathMock(path); },
}));

beforeEach(() => {
  mockUserId = "user_test_1";
  producerSelectMock.mockReset().mockResolvedValue([{ id: PRODUCER_ID }]);
  linkSelectByIdMock.mockReset().mockResolvedValue([]);
  linkInsertReturningMock.mockReset().mockResolvedValue([
    {
      id: LINK_ID,
      producerId: PRODUCER_ID,
      leadId: null,
      target: "portfolio",
      tokenHash: "deadbeef",
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      revokedAt: null,
      createdAt: new Date("2026-04-16T00:00:00Z"),
    },
  ]);
  linkUpdateReturningMock.mockReset().mockResolvedValue([
    {
      id: LINK_ID,
      producerId: PRODUCER_ID,
      revokedAt: new Date("2026-04-16T01:00:00Z"),
    },
  ]);
  revalidatePathMock.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
  process.env.SITE_URL = "https://skitza.test";
});

describe("issueLeadLink", () => {
  it("returns the URL + linkId on success and revalidates the leads path", async () => {
    const { issueLeadLink } = await import("../actions");
    const res = await issueLeadLink({ target: "portfolio", ttlHours: 24 });
    expect(res).toEqual({
      ok: true,
      data: { url: `https://skitza.test/m/${ISSUED_TOKEN}`, linkId: LINK_ID },
    });
    expect(linkInsertReturningMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/leads");
  });

  it("rejects ttlHours over the 720 max via zod", async () => {
    const { issueLeadLink } = await import("../actions");
    const res = await issueLeadLink({ target: "portfolio", ttlHours: 1000 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ttlHours/i);
    expect(linkInsertReturningMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns an unauthorized error when no userId", async () => {
    mockUserId = null;
    const { issueLeadLink } = await import("../actions");
    const res = await issueLeadLink({ target: "portfolio", ttlHours: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign in/i);
    expect(linkInsertReturningMock).not.toHaveBeenCalled();
  });
});

describe("revokeLeadLink", () => {
  it("revokes an owned link and revalidates", async () => {
    linkSelectByIdMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        revokedAt: null,
      },
    ]);
    const { revokeLeadLink } = await import("../actions");
    const res = await revokeLeadLink({ id: LINK_ID });
    expect(res).toEqual({ ok: true });
    expect(linkUpdateReturningMock).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/leads");
  });

  it("returns a forbidden error when the link belongs to another producer", async () => {
    linkSelectByIdMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        producerId: OTHER_PRODUCER_ID,
        revokedAt: null,
      },
    ]);
    const { revokeLeadLink } = await import("../actions");
    const res = await revokeLeadLink({ id: LINK_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/access/i);
    expect(linkUpdateReturningMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("deriveStatus", () => {
  const NOW = new Date("2026-04-16T12:00:00Z");

  it("returns 'revoked' when revokedAt is set, regardless of expiry", async () => {
    const { deriveStatus } = await import("../status");
    expect(
      deriveStatus(
        { revokedAt: new Date("2026-04-15T00:00:00Z"), expiresAt: new Date("2099-01-01T00:00:00Z") },
        NOW,
      ),
    ).toBe("revoked");
  });

  it("returns 'expired' when expiresAt is in the past", async () => {
    const { deriveStatus } = await import("../status");
    expect(
      deriveStatus({ revokedAt: null, expiresAt: new Date("2026-04-15T00:00:00Z") }, NOW),
    ).toBe("expired");
  });

  it("returns 'active' when not revoked and not expired", async () => {
    const { deriveStatus } = await import("../status");
    expect(
      deriveStatus({ revokedAt: null, expiresAt: new Date("2099-01-01T00:00:00Z") }, NOW),
    ).toBe("active");
  });
});
