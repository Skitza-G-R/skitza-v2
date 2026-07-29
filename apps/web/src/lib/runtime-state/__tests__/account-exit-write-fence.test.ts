import { describe, expect, it } from "vitest";

import {
  allowAccountPrivateRuntimeWrites,
  captureAccountPrivateWriteGeneration,
  clearAccountPrivateRuntimeState,
  isAccountPrivateRuntimeWriteAllowed,
} from "../account-exit";

import { MemoryStorage } from "./memory-storage";

describe("account-private runtime write fence", () => {
  it("blocks stale and newly mounted writers until Clerk crosses into a new session", () => {
    const userId = "screen-writer-user";
    const storage = new MemoryStorage();
    const staleWriter = captureAccountPrivateWriteGeneration(userId);

    clearAccountPrivateRuntimeState(userId, storage, null);

    expect(isAccountPrivateRuntimeWriteAllowed(staleWriter)).toBe(false);
    const mountedDuringExit = captureAccountPrivateWriteGeneration(userId);
    expect(isAccountPrivateRuntimeWriteAllowed(mountedDuringExit)).toBe(false);

    allowAccountPrivateRuntimeWrites(userId);
    expect(isAccountPrivateRuntimeWriteAllowed(mountedDuringExit)).toBe(true);
  });
});
