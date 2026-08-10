import { describe, expect, it, vi } from "vitest";

import { newCalendarOperationKey } from "../calendar-operation-key";

describe("calendar operation keys", () => {
  it("uses randomUUID when the browser provides it", () => {
    const operationId = "00000000-0000-4000-8000-000000000211" as const;
    const randomUUID = vi.fn(() => operationId);

    expect(
      newCalendarOperationKey("producer-manual", {
        randomUUID,
        getRandomValues: vi.fn(),
      }),
    ).toBe(`producer-manual:${operationId}`);
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    const cryptoApi = {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      }),
    } as unknown as Crypto;

    expect(newCalendarOperationKey("producer-reschedule:session-1", cryptoApi)).toBe(
      `producer-reschedule:session-1:${"ab".repeat(16)}`,
    );
  });
});
