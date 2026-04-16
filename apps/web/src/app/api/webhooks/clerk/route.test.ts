import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn().mockResolvedValue([{ id: "uuid-1" }]);
const dbMock = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: insertMock }) }) }) };

// Toggle to simulate svix signature failure in a single test.
let verifyShouldThrow = false;

vi.mock("@skitza/db", () => ({ createDb: () => dbMock, producers: {} }));
vi.mock("svix", () => ({
  Webhook: class {
    verify(payload: string): unknown {
      if (verifyShouldThrow) throw new Error("bad sig");
      return JSON.parse(payload) as unknown;
    }
  },
}));

const buildReq = (body: string) =>
  new Request("http://x/api/webhooks/clerk", {
    method: "POST",
    headers: { "svix-id": "1", "svix-timestamp": "1", "svix-signature": "x" },
    body,
  });

beforeEach(() => {
  insertMock.mockClear();
  verifyShouldThrow = false;
  process.env.CLERK_WEBHOOK_SECRET = "test";
  process.env.DATABASE_URL = "x";
});

describe("clerk webhook", () => {
  it("creates a Producer on user.created", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_1", email_addresses: [{ email_address: "ada@x.com" }], first_name: "Ada" },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("returns 500 when CLERK_WEBHOOK_SECRET is missing", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const { POST } = await import("./route");
    const res = await POST(buildReq("{}"));
    expect(res.status).toBe(500);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid svix signature", async () => {
    verifyShouldThrow = true;
    const { POST } = await import("./route");
    const res = await POST(buildReq("{}"));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 when user.created has no email_addresses", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ type: "user.created", data: { id: "user_2", email_addresses: [] } });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 200 and skips insert for non user.created events", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ type: "user.updated", data: { id: "user_3" } });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
