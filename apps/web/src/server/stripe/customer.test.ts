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
      clientContactId: "client_1",
      clientEmail: "dan@example.com",
      clientName: "Dan Cohen",
    });
    expect(result).toBe("cus_existing");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates new Customer + join row when none exists", async () => {
    const insertValues = vi.fn().mockReturnThis();
    const insertOnConflict = vi.fn().mockReturnThis();
    const insertReturning = vi.fn().mockResolvedValue([
      { stripeCustomerId: "cus_new" },  // winner returns its own id
    ]);
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),  // no existing
      insert: vi.fn().mockReturnValue({
        values: insertValues.mockReturnValue({
          onConflictDoNothing: insertOnConflict.mockReturnValue({
            returning: insertReturning,
          }),
        }),
      }),
    };
    mockCreate.mockResolvedValue({ id: "cus_new" });

    const result = await getOrCreateStripeCustomer({
      db: db as never,
      producerId: "prod_1",
      clientContactId: "client_1",
      clientEmail: "dan@example.com",
      clientName: "Dan Cohen",
    });
    expect(result).toBe("cus_new");
    expect(mockCreate).toHaveBeenCalledWith(
      { email: "dan@example.com", name: "Dan Cohen", metadata: { producerId: "prod_1", clientContactId: "client_1" } },
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        producerId: "prod_1",
        clientContactId: "client_1",
        stripeCustomerId: "cus_new",
      }),
    );
  });

  it("lost race on conflict → re-selects winner's Customer id", async () => {
    const insertReturning = vi.fn().mockResolvedValue([]);  // empty = conflict hit
    const insertOnConflict = vi.fn().mockReturnValue({ returning: insertReturning });
    const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: insertOnConflict });

    // First select (no existing) returns [], second select (winner lookup) returns [winner]
    const limitCalls = vi.fn()
      .mockResolvedValueOnce([])            // initial existence check
      .mockResolvedValueOnce([{ stripeCustomerId: "cus_winner" }]);  // race re-select

    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: limitCalls,
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };
    mockCreate.mockResolvedValue({ id: "cus_ours_orphaned" });

    const result = await getOrCreateStripeCustomer({
      db: db as never,
      producerId: "prod_1",
      clientContactId: "client_1",
      clientEmail: "dan@example.com",
      clientName: "Dan Cohen",
    });

    expect(result).toBe("cus_winner");  // winner, not our orphaned one
    expect(mockCreate).toHaveBeenCalledTimes(1);  // we did attempt Stripe create
    expect(limitCalls).toHaveBeenCalledTimes(2);  // initial check + winner re-read
  });

  it("Stripe create failure: does NOT insert into DB", async () => {
    const insertValues = vi.fn();
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };
    mockCreate.mockRejectedValue(new Error("connect account archived"));

    await expect(
      getOrCreateStripeCustomer({
        db: db as never,
        producerId: "prod_1",
        clientContactId: "client_1",
        clientEmail: "dan@example.com",
        clientName: "Dan Cohen",
      })
    ).rejects.toThrow(/connect account archived/);

    // Critical invariant: no DB row inserted on Stripe failure
    expect(db.insert).not.toHaveBeenCalled();
  });
});
