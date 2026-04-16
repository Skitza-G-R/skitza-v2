import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn().mockResolvedValue([{ id: "uuid-1" }]);
const dbMock = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: insertMock }) }) }) };

vi.mock("@skitza/db", () => ({ createDb: () => dbMock, producers: {} }));
vi.mock("svix", () => ({ Webhook: class { verify(payload: string): unknown { return JSON.parse(payload) as unknown; } } }));

beforeEach(() => {
  insertMock.mockClear();
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
    const req = new Request("http://x/api/webhooks/clerk", {
      method: "POST",
      headers: { "svix-id": "1", "svix-timestamp": "1", "svix-signature": "x" },
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
  });
});
