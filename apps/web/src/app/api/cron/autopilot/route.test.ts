import { beforeEach, describe, expect, it, vi } from "vitest";

const resendSendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/email/client", () => ({
  FROM_ADDRESS: "test@skitza.app",
  getResend: () => ({ emails: { send: resendSendMock } }),
  SITE_URL: "https://test.skitza.app",
}));

type ProjectRow = { id: string };

let testimonialRowsQueue: ProjectRow[] = [];

const dbMock = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => Promise.resolve(testimonialRowsQueue),
      }),
    }),
  }),
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: {
    id: { _name: "id" },
    autopilotRequestTestimonial: { _name: "autopilot_request_testimonial" },
  },
  projects: {
    id: { _name: "id" },
    producerId: { _name: "producer_id" },
    lifecycleStatus: { _name: "lifecycle_status" },
    testimonialRequestedAt: { _name: "testimonial_requested_at" },
  },
  eq: () => ({ _kind: "eq" }),
  and: () => ({ _kind: "and" }),
  isNull: () => ({ _kind: "isNull" }),
}));

const buildReq = (authHeader: string | null) =>
  new Request("http://x/api/cron/autopilot", {
    method: "GET",
    ...(authHeader ? { headers: { authorization: authHeader } } : {}),
  });

beforeEach(() => {
  resendSendMock.mockReset().mockResolvedValue(undefined);
  testimonialRowsQueue = [];
  process.env.CRON_SECRET = "secret123";
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("/api/cron/autopilot — auth + env guards", () => {
  it("503s when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("CRON_SECRET");
  });

  it("401s on missing Authorization header", async () => {
    const { GET } = await import("./route");
    const res = await GET(buildReq(null));
    expect(res.status).toBe(401);
  });

  it("401s on wrong bearer token", async () => {
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("503s when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.reason).toContain("DATABASE_URL");
  });
});

describe("/api/cron/autopilot — empty-DB happy path", () => {
  it("returns a 200 with zero counts when no eligible rows exist", async () => {
    testimonialRowsQueue = [];
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      unpaidReminder: { eligible: number; sent: number; errored: number; deferred: string };
      requestTestimonial: { eligible: number; deferred: string };
      autoArchive: { archived: number; deferred: string };
    };
    expect(body.ok).toBe(true);
    expect(body.unpaidReminder).toEqual({
      eligible: 0,
      sent: 0,
      errored: 0,
      deferred: "purchase-ledger reminder projection is not available in SK-90",
    });
    expect(body.requestTestimonial.eligible).toBe(0);
    expect(body.requestTestimonial.deferred).toContain("capture page");
    expect(body.autoArchive.archived).toBe(0);
    expect(body.autoArchive.deferred).toContain("song-level archive");
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe("/api/cron/autopilot — request-testimonial (detect-only for now)", () => {
  it("counts eligible projects but does NOT email or stamp (capture form not built)", async () => {
    testimonialRowsQueue = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requestTestimonial: { eligible: number; deferred: string };
    };
    expect(body.requestTestimonial.eligible).toBe(3);
    expect(body.requestTestimonial.deferred).toBeTruthy();
    // No emails sent, no DB updates stamped.
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe("/api/cron/autopilot — removed commercial behavior", () => {
  it("fails closed instead of reading invoices or mutating project archive state", async () => {
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      unpaidReminder: { eligible: number; sent: number; deferred: string };
      autoArchive: { archived: number; deferred: string };
    };
    expect(body.unpaidReminder).toMatchObject({ eligible: 0, sent: 0 });
    expect(body.unpaidReminder.deferred).toContain("purchase-ledger");
    expect(body.autoArchive.archived).toBe(0);
    expect(body.autoArchive.deferred).toContain("song-level archive");
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
