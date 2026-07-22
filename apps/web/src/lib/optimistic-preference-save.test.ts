import { describe, expect, it, vi } from "vitest";

import { runOptimisticPreferenceSave } from "./optimistic-preference-save";

describe("runOptimisticPreferenceSave", () => {
  it("rolls back and explains an unsuccessful response", async () => {
    const events: string[] = [];

    const result = await runOptimisticPreferenceSave({
      lock: { current: false },
      save: () => Promise.resolve({ ok: false, error: "Please sign in to continue." }),
      rollback: () => events.push("rollback"),
      onError: (message) => events.push(message),
      setPending: (pending) => events.push(`pending:${String(pending)}`),
      errorLabel: "Auto-confirm",
    });

    expect(result).toBe("failed");
    expect(events).toEqual([
      "pending:true",
      "rollback",
      "Auto-confirm wasn’t saved. Please sign in to continue.",
      "pending:false",
    ]);
  });

  it("rolls back thrown failures without exposing an exception", async () => {
    const rollback = vi.fn();
    const onError = vi.fn();

    const result = await runOptimisticPreferenceSave({
      lock: { current: false },
      save: () => Promise.reject(new Error("private implementation detail")),
      rollback,
      onError,
      setPending: vi.fn(),
      errorLabel: "Cancellation window",
    });

    expect(result).toBe("failed");
    expect(rollback).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      "Cancellation window wasn’t saved. Try again.",
    );
  });

  it("ignores a conflicting save until the active save releases its lock", async () => {
    let finishFirst: ((value: { ok: true }) => void) | undefined;
    const firstSave = new Promise<{ ok: true }>((resolve) => {
      finishFirst = resolve;
    });
    const lock = { current: false };
    const secondSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    const shared = {
      lock,
      rollback: vi.fn(),
      onError: vi.fn(),
      setPending: vi.fn(),
      errorLabel: "Booking preference",
    };

    const first = runOptimisticPreferenceSave({
      ...shared,
      save: () => firstSave,
    });
    const ignored = await runOptimisticPreferenceSave({
      ...shared,
      save: secondSave,
    });

    expect(ignored).toBe("ignored");
    expect(secondSave).not.toHaveBeenCalled();

    finishFirst?.({ ok: true });
    await expect(first).resolves.toBe("saved");
    await expect(
      runOptimisticPreferenceSave({ ...shared, save: secondSave }),
    ).resolves.toBe("saved");
    expect(secondSave).toHaveBeenCalledOnce();
  });
});
