import { describe, expect, it, vi } from "vitest";

import {
  requiresOnlineConfirmation,
  runRuntimeAction,
  type RuntimeActionKind,
} from "../action-policy";

describe("runtime action policy", () => {
  it.each(["booking", "payment", "availability", "live"] satisfies RuntimeActionKind[])(
    "blocks %s offline before optimistic UI or a server call",
    async (kind) => {
      const execute = vi.fn(() => Promise.resolve("confirmed"));
      const applyOptimistic = vi.fn();
      const rollback = vi.fn();

      await expect(
        runRuntimeAction({
          kind,
          online: false,
          execute,
          applyOptimistic,
          rollback,
        }),
      ).resolves.toEqual({ status: "blocked-offline" });
      expect(execute).not.toHaveBeenCalled();
      expect(applyOptimistic).not.toHaveBeenCalled();
      expect(rollback).not.toHaveBeenCalled();
      expect(requiresOnlineConfirmation(kind)).toBe(true);
    },
  );

  it("waits for online confirmation without optimistic UI for a payment", async () => {
    const applyOptimistic = vi.fn();
    await expect(
      runRuntimeAction({
        kind: "payment",
        online: true,
        execute: () => Promise.resolve("receipt"),
        applyOptimistic,
      }),
    ).resolves.toEqual({ status: "confirmed", value: "receipt" });
    expect(applyOptimistic).not.toHaveBeenCalled();
  });

  it("rolls an ordinary optimistic edit back when the server rejects it", async () => {
    const order: string[] = [];
    const error = new Error("server rejected edit");
    const result = await runRuntimeAction({
      kind: "safe-edit",
      online: true,
      applyOptimistic: () => order.push("apply"),
      execute: () => {
        order.push("execute");
        return Promise.reject(error);
      },
      rollback: () => order.push("rollback"),
    });

    expect(result).toEqual({ status: "rolled-back", error });
    expect(order).toEqual(["apply", "execute", "rollback"]);
    expect(requiresOnlineConfirmation("safe-edit")).toBe(false);
  });
});
