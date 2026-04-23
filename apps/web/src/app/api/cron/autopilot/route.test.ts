import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the Autopilot cron route (audit Task 12, overnight Task E).
// Focus on the plumbing — auth, env guards, empty-DB happy path, and
// the JSON shape of the response. Deeper SQL-behavior tests would
// require reconstructing the whole drizzle + inner-join mock tree,
// which is high cost for a route Gili will curl-verify by hand.

const resendSendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/email/client", () => ({
  FROM_ADDRESS: "test@skitza.app",
  getResend: () => ({ emails: { send: resendSendMock } }),
  SITE_URL: "https://test.skitza.app",
}));

// Single shared state for the 3 DB queries the route makes in order:
//   1. SELECT from invoices JOIN producers (unpaid-reminder)
//   2. SELECT from projects JOIN producers (request-testimonial)
//   3. UPDATE projects ... RETURNING (auto-archive)
// We control each one via a FIFO queue drained by the mock builder.
type UnpaidRow = {
  invoiceId: string;
  customerEmail: string;
  customerName: string | null;
  producerId: string;
  producerDisplayName: string | null;
  producerAutopilot: boolean;
};
type ProjectRow = { id: string };

let unpaidRowsQueue: UnpaidRow[] = [];
let testimonialRowsQueue: ProjectRow[] = [];
let archivedRowsQueue: ProjectRow[] = [];
// Call counter for the two selects — simpler than trying to infer
// order from queue emptiness (which breaks when a queue is empty by
// design, e.g. testing testimonial sweep with no unpaid rows).
let selectCallCount = 0;

// Track update + invoice-stamp calls so tests can assert side-effects.
const invoiceStampMock = vi.fn(() => Promise.resolve());
const archiveUpdateMock = vi.fn(() => Promise.resolve(archivedRowsQueue));

const dbMock = {
  // select returns a builder whose terminal .where(...) resolves to
  // the next queue item. The route runs two selects in fixed order
  // (unpaid sweep, then testimonial sweep). We key on call index.
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => {
          const call = selectCallCount++;
          if (call === 0) {
            return Promise.resolve(unpaidRowsQueue);
          }
          return Promise.resolve(testimonialRowsQueue);
        },
      }),
    }),
  }),
  // update handles both the invoice stamp + the auto-archive update.
  // Invoice stamp has .set().where() → resolves; auto-archive has
  // .set().from().where().returning() → resolves with archivedRowsQueue.
  update: () => ({
    set: () => ({
      where: () => invoiceStampMock(),
      from: () => ({
        where: () => ({
          returning: () => archiveUpdateMock(),
        }),
      }),
    }),
  }),
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  invoices: {
    id: { _name: "id" },
    status: { _name: "status" },
    createdAt: { _name: "created_at" },
    reminderSentAt: { _name: "reminder_sent_at" },
    customerEmail: { _name: "customer_email" },
    customerName: { _name: "customer_name" },
    producerId: { _name: "producer_id" },
  },
  producers: {
    id: { _name: "id" },
    displayName: { _name: "display_name" },
    autopilotUnpaidReminder: { _name: "autopilot_unpaid_reminder" },
    autopilotRequestTestimonial: { _name: "autopilot_request_testimonial" },
    autopilotAutoArchive: { _name: "autopilot_auto_archive" },
  },
  projects: {
    id: { _name: "id" },
    producerId: { _name: "producer_id" },
    stage: { _name: "stage" },
    updatedAt: { _name: "updated_at" },
    testimonialRequestedAt: { _name: "testimonial_requested_at" },
  },
  eq: () => ({ _kind: "eq" }),
  and: () => ({ _kind: "and" }),
  inArray: () => ({ _kind: "inArray" }),
  isNull: () => ({ _kind: "isNull" }),
  lt: () => ({ _kind: "lt" }),
}));

const buildReq = (authHeader: string | null) =>
  new Request("http://x/api/cron/autopilot", {
    method: "GET",
    ...(authHeader ? { headers: { authorization: authHeader } } : {}),
  });

beforeEach(() => {
  resendSendMock.mockReset().mockResolvedValue(undefined);
  invoiceStampMock.mockClear();
  archiveUpdateMock.mockClear().mockImplementation(() =>
    Promise.resolve(archivedRowsQueue),
  );
  unpaidRowsQueue = [];
  testimonialRowsQueue = [];
  archivedRowsQueue = [];
  selectCallCount = 0;
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
    unpaidRowsQueue = [];
    testimonialRowsQueue = [];
    archivedRowsQueue = [];
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      unpaidReminder: { eligible: number; sent: number; errored: number };
      requestTestimonial: { eligible: number; deferred: string };
      autoArchive: { archived: number };
    };
    expect(body.ok).toBe(true);
    expect(body.unpaidReminder).toEqual({
      eligible: 0,
      sent: 0,
      errored: 0,
    });
    expect(body.requestTestimonial.eligible).toBe(0);
    expect(body.requestTestimonial.deferred).toContain("capture page");
    expect(body.autoArchive.archived).toBe(0);
    // No email sent, no invoice stamped, no archive update fired.
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(invoiceStampMock).not.toHaveBeenCalled();
  });
});

describe("/api/cron/autopilot — unpaid-reminder behavior", () => {
  it("sends an email and stamps reminder_sent_at for each eligible invoice", async () => {
    unpaidRowsQueue = [
      {
        invoiceId: "inv-1",
        customerEmail: "ada@example.com",
        customerName: "Ada",
        producerId: "prod-1",
        producerDisplayName: "Gili Asraf",
        producerAutopilot: true,
      },
      {
        invoiceId: "inv-2",
        customerEmail: "ben@example.com",
        customerName: null, // triggers "there" fallback in greeting
        producerId: "prod-1",
        producerDisplayName: "Gili Asraf",
        producerAutopilot: true,
      },
    ];

    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      unpaidReminder: { eligible: number; sent: number; errored: number };
    };
    expect(body.unpaidReminder.eligible).toBe(2);
    expect(body.unpaidReminder.sent).toBe(2);
    expect(body.unpaidReminder.errored).toBe(0);

    // Two emails + two stamps. Idempotency guaranteed because each
    // row now has a non-null reminder_sent_at on the next tick.
    expect(resendSendMock).toHaveBeenCalledTimes(2);
    expect(invoiceStampMock).toHaveBeenCalledTimes(2);

    // Email subjects include the producer display name.
    const subjects = resendSendMock.mock.calls.map(
      (call) => (call[0] as { subject: string }).subject,
    );
    expect(subjects[0]).toContain("Gili Asraf");
    expect(subjects[1]).toContain("Gili Asraf");
  });

  it("skips rows with no customerEmail (corrupt data safety)", async () => {
    unpaidRowsQueue = [
      {
        invoiceId: "inv-3",
        customerEmail: null as unknown as string, // simulate missing
        customerName: "Ghost",
        producerId: "prod-1",
        producerDisplayName: "Gili Asraf",
        producerAutopilot: true,
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      unpaidReminder: { eligible: number; sent: number; errored: number };
    };
    // eligible = 1 (passed the DB filter); sent = 0 (skipped on
    // email null-check before Resend)
    expect(body.unpaidReminder.eligible).toBe(1);
    expect(body.unpaidReminder.sent).toBe(0);
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(invoiceStampMock).not.toHaveBeenCalled();
  });

  it("counts errored sends separately (doesn't block the sweep)", async () => {
    unpaidRowsQueue = [
      {
        invoiceId: "inv-ok",
        customerEmail: "ok@example.com",
        customerName: "OK",
        producerId: "prod-1",
        producerDisplayName: "Gili",
        producerAutopilot: true,
      },
      {
        invoiceId: "inv-fail",
        customerEmail: "fail@example.com",
        customerName: "Fail",
        producerId: "prod-1",
        producerDisplayName: "Gili",
        producerAutopilot: true,
      },
    ];
    // First call succeeds, second throws.
    resendSendMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("resend down"));

    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      unpaidReminder: { eligible: number; sent: number; errored: number };
    };
    expect(body.unpaidReminder.eligible).toBe(2);
    expect(body.unpaidReminder.sent).toBe(1);
    expect(body.unpaidReminder.errored).toBe(1);
    // Only the successful send stamped reminder_sent_at.
    expect(invoiceStampMock).toHaveBeenCalledTimes(1);
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
    expect(invoiceStampMock).not.toHaveBeenCalled();
  });
});

describe("/api/cron/autopilot — auto-archive behavior", () => {
  it("reports the count of archived projects returned by UPDATE ... RETURNING", async () => {
    archivedRowsQueue = [{ id: "p1" }, { id: "p2" }];
    const { GET } = await import("./route");
    const res = await GET(buildReq("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      autoArchive: { archived: number };
    };
    expect(body.autoArchive.archived).toBe(2);
    expect(archiveUpdateMock).toHaveBeenCalledOnce();
  });
});
