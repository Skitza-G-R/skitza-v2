import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "00000000-0000-0000-0000-0000000000a1";
const PRODUCER_SLUG = "ada-lovelace";
const LINK_ID = "00000000-0000-0000-0000-0000000000b1";
const VIEW_ID = "00000000-0000-0000-0000-0000000000c1";
const TOKEN = "encoded.signature";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");

// Marker objects so the dbMock can branch on which table a select/insert
// targets. Same pattern as apps/web/src/server/trpc/routers/__tests__/magic-link.test.ts.
const magicLinksMarker = { __table: "magic_links" };
const magicLinkViewsMarker = { __table: "magic_link_views" };
const producersMarker = { __table: "producers" };

type Row = Record<string, unknown>;
const linkLookupMock = vi.fn<() => Promise<Row[]>>();
const viewInsertMock = vi.fn<() => Promise<Array<{ id: string }>>>();

// Test-side captures so individual cases can assert what drizzle saw.
let lastViewInsertValues: Row | undefined;
let lastWhereArgs: unknown;

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      // Only the magic_links lookup uses select() in this handler.
      if (table === magicLinksMarker) {
        return {
          innerJoin: () => ({
            where: (cond: unknown) => {
              lastWhereArgs = cond;
              return { limit: () => linkLookupMock() };
            },
          }),
        };
      }
      throw new Error(`unexpected select().from(${String(table)})`);
    },
  }),
  insert: (table: unknown) => {
    if (table !== magicLinkViewsMarker) {
      throw new Error(`unexpected insert(${String(table)})`);
    }
    return {
      values: (vals: Row) => {
        lastViewInsertValues = vals;
        return {
          returning: () => viewInsertMock(),
        };
      },
    };
  },
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  magicLinks: magicLinksMarker,
  magicLinkViews: magicLinkViewsMarker,
  producers: producersMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

class MagicTokenInvalidStub extends Error {
  public override readonly name = "MagicTokenInvalid";
}
const verifyMagicTokenMock = vi.fn();
vi.mock("~/lib/magic-links/token", () => ({
  verifyMagicToken: (token: string) => verifyMagicTokenMock(token) as unknown,
  MagicTokenInvalid: MagicTokenInvalidStub,
}));

// next/server: stub NextResponse so we can introspect the redirect target
// and 404 status without needing the real Web Response semantics.
type RedirectMarker = { __kind: "redirect"; url: string; status: number };
type NotFoundMarker = { __kind: "notfound"; status: number };
const nextResponseRedirectMock = vi.fn(
  (url: URL | string, init?: number | { status?: number }): RedirectMarker => ({
    __kind: "redirect",
    url: typeof url === "string" ? url : url.toString(),
    status: typeof init === "number" ? init : init?.status ?? 307,
  }),
);
vi.mock("next/server", () => ({
  NextResponse: Object.assign(
    function NextResponse(_body: BodyInit | null, init?: { status?: number }): NotFoundMarker {
      return { __kind: "notfound", status: init?.status ?? 200 };
    },
    {
      redirect: (url: URL | string, init?: number | { status?: number }) =>
        nextResponseRedirectMock(url, init),
    },
  ),
}));

const buildRequest = (
  headers: Record<string, string> = {
    "x-forwarded-for": "1.2.3.4",
    "user-agent": "vitest",
    referer: "https://from.test/intro",
  },
): Request =>
  new Request(`http://test/m/${TOKEN}`, { headers });

const buildContext = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

const importHandler = async () => {
  const mod = await import("../route");
  return mod.GET;
};

beforeEach(() => {
  linkLookupMock.mockReset().mockResolvedValue([
    {
      id: LINK_ID,
      producerId: PRODUCER_ID,
      target: "portfolio",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      producerSlug: PRODUCER_SLUG,
    },
  ]);
  viewInsertMock.mockReset().mockResolvedValue([{ id: VIEW_ID }]);
  verifyMagicTokenMock.mockReset().mockReturnValue({
    producerId: PRODUCER_ID,
    target: "portfolio",
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  nextResponseRedirectMock.mockClear();
  lastViewInsertValues = undefined;
  lastWhereArgs = undefined;
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("GET /m/[token]", () => {
  it("happy-path portfolio: 302s to /join/<slug>?via=<viewId> and logs a view row", async () => {
    const GET = await importHandler();
    const res = (await GET(buildRequest(), buildContext())) as unknown as RedirectMarker;

    expect(res.__kind).toBe("redirect");
    expect(res.status).toBe(302);
    expect(res.url).toBe(`http://test/join/${PRODUCER_SLUG}?via=${VIEW_ID}`);

    expect(viewInsertMock).toHaveBeenCalledOnce();
    expect(lastViewInsertValues).toMatchObject({
      magicLinkId: LINK_ID,
      ip: "1.2.3.4",
      userAgent: "vitest",
      referer: "https://from.test/intro",
    });

    // The lookup must use the sha256 hash of the raw token. The dbMock's
    // `eq` stub captures (column, value); the column is a drizzle column
    // reference (undefined under the marker-object mock), so we only
    // assert on the value side.
    const where = lastWhereArgs as { eq?: unknown[] } | undefined;
    expect(where?.eq?.[1]).toBe(TOKEN_HASH);
  });

  // Post-Story-03 (PRD §6.6): booking-target magic links also resolve
  // to /join/<slug>. Booking-without-signup is gone; artist-side signup
  // happens on /join first and the Book tab opens inside the artist app.
  it("happy-path booking: 302s to /join/<slug>?via=<viewId> (collapsed per PRD §6.6)", async () => {
    linkLookupMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        target: "booking",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        producerSlug: PRODUCER_SLUG,
      },
    ]);
    const GET = await importHandler();
    const res = (await GET(buildRequest(), buildContext())) as unknown as RedirectMarker;
    expect(res.__kind).toBe("redirect");
    expect(res.status).toBe(302);
    expect(res.url).toBe(`http://test/join/${PRODUCER_SLUG}?via=${VIEW_ID}`);
  });

  it("MagicTokenInvalid → 404 with no DB writes", async () => {
    verifyMagicTokenMock.mockImplementationOnce(() => {
      throw new MagicTokenInvalidStub("bad sig");
    });
    const GET = await importHandler();
    const res = (await GET(buildRequest(), buildContext())) as unknown as NotFoundMarker;
    expect(res.__kind).toBe("notfound");
    expect(res.status).toBe(404);
    expect(linkLookupMock).not.toHaveBeenCalled();
    expect(viewInsertMock).not.toHaveBeenCalled();
    expect(nextResponseRedirectMock).not.toHaveBeenCalled();
  });

  it("link not found in DB → 404 (no view insert)", async () => {
    linkLookupMock.mockResolvedValueOnce([]);
    const GET = await importHandler();
    const res = (await GET(buildRequest(), buildContext())) as unknown as NotFoundMarker;
    expect(res.__kind).toBe("notfound");
    expect(res.status).toBe(404);
    expect(viewInsertMock).not.toHaveBeenCalled();
    expect(nextResponseRedirectMock).not.toHaveBeenCalled();
  });

  it("revoked link (revokedAt != null) → 404", async () => {
    linkLookupMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        target: "portfolio",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(Date.now() - 1_000),
        producerSlug: PRODUCER_SLUG,
      },
    ]);
    const GET = await importHandler();
    const res = (await GET(buildRequest(), buildContext())) as unknown as NotFoundMarker;
    expect(res.status).toBe(404);
    expect(viewInsertMock).not.toHaveBeenCalled();
  });

  it("expired link (expiresAt < now) → 404", async () => {
    linkLookupMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        target: "portfolio",
        expiresAt: new Date(Date.now() - 60_000),
        revokedAt: null,
        producerSlug: PRODUCER_SLUG,
      },
    ]);
    const GET = await importHandler();
    const res = (await GET(buildRequest(), buildContext())) as unknown as NotFoundMarker;
    expect(res.status).toBe(404);
    expect(viewInsertMock).not.toHaveBeenCalled();
  });

  it("view insert fails → still redirects (without via=) and logs error", async () => {
    viewInsertMock.mockRejectedValueOnce(new Error("db hiccup"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const GET = await importHandler();
      const res = (await GET(buildRequest(), buildContext())) as unknown as RedirectMarker;
      expect(res.__kind).toBe("redirect");
      expect(res.status).toBe(302);
      // No `via` query param when the view row was never persisted.
      expect(res.url).toBe(`http://test/join/${PRODUCER_SLUG}`);
      expect(errorSpy).toHaveBeenCalled();
      // The error log includes the link id so an operator can correlate.
      const loggedArgs = errorSpy.mock.calls[0] ?? [];
      const joined = loggedArgs.map((arg) => String(arg)).join(" ");
      expect(joined).toContain(LINK_ID);
      // Never log the raw token.
      expect(joined).not.toContain(TOKEN);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("captures only the first hop of an x-forwarded-for chain", async () => {
    const GET = await importHandler();
    await GET(
      buildRequest({
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "user-agent": "vitest",
        referer: "https://from.test/intro",
      }),
      buildContext(),
    );
    expect(lastViewInsertValues?.["ip"]).toBe("1.2.3.4");
  });

  it("unknown target (e.g. legacy 'project:<uuid>') → 404, no redirect", async () => {
    linkLookupMock.mockResolvedValueOnce([
      {
        id: LINK_ID,
        producerId: PRODUCER_ID,
        target: "project:abc",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        producerSlug: PRODUCER_SLUG,
      },
    ]);
    const GET = await importHandler();
    const res = (await GET(buildRequest(), buildContext())) as unknown as NotFoundMarker;
    expect(res.__kind).toBe("notfound");
    expect(res.status).toBe(404);
    expect(nextResponseRedirectMock).not.toHaveBeenCalled();
  });
});
