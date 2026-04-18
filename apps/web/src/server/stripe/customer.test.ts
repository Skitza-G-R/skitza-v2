import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrCreateStripeCustomer } from "./customer";

// Mock Stripe SDK — we only test our lookup/create logic, not Stripe itself
const mockCreate = vi.fn();
vi.mock("./client", () => ({
  getStripe: () => ({ customers: { create: mockCreate } }),
}));

describe("getOrCreateStripeCustomer", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns existing Customer ID when join row exists", async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { stripeCustomerId: "cus_existing" },
      ]),
      insert: vi.fn(),
    };
    const result = await getOrCreateStripeCustomer({
      db: db as never,
      producerId: "prod_1",
      producerStripeAccountId: "acct_1",
      clientContactId: "client_1",
      clientEmail: "dan@example.com",
      clientName: "Dan Cohen",
    });
    expect(result).toBe("cus_existing");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates new Customer + join row when none exists", async () => {
    const insertValues = vi.fn().mockReturnThis();
    const insertReturning = vi.fn().mockResolvedValue([{}]);
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),  // no existing
      insert: vi.fn().mockReturnValue({
        values: insertValues,
        returning: insertReturning,
      }),
    };
    mockCreate.mockResolvedValue({ id: "cus_new" });

    const result = await getOrCreateStripeCustomer({
      db: db as never,
      producerId: "prod_1",
      producerStripeAccountId: "acct_1",
      clientContactId: "client_1",
      clientEmail: "dan@example.com",
      clientName: "Dan Cohen",
    });
    expect(result).toBe("cus_new");
    expect(mockCreate).toHaveBeenCalledWith(
      { email: "dan@example.com", name: "Dan Cohen", metadata: { producerId: "prod_1", clientContactId: "client_1" } },
      { stripeAccount: "acct_1" },
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        producerId: "prod_1",
        clientContactId: "client_1",
        stripeCustomerId: "cus_new",
      }),
    );
  });
});
