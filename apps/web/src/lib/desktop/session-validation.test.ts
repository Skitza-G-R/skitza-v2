import { beforeEach, describe, expect, it } from "vitest";

import { DESKTOP_CAPABILITIES, type SkitzaDesktopBridgeV1 } from "./bridge";
import {
  DESKTOP_PRIVATE_CACHE_VALIDATION_MAX_AGE_MS,
  desktopSessionCacheAccess,
  invalidateDesktopSessionValidation,
  resetDesktopSessionValidationForTests,
  updateDesktopSessionValidation,
} from "./session-validation";

const NOW = 1_786_600_000_000;
const bridge: SkitzaDesktopBridgeV1 = {
  protocolVersion: 1,
  capabilities: [DESKTOP_CAPABILITIES.sessionValidation],
  listen: () => () => undefined,
};
const desktop = { kind: "supported" as const, bridge };

describe("desktop private-cache session validation", () => {
  beforeEach(resetDesktopSessionValidationForTests);

  it("does not change normal web access when the bridge is absent", () => {
    expect(desktopSessionCacheAccess("user-a", false, NOW, { kind: "web" })).toEqual({
      kind: "web",
    });
  });

  it("allows only a live same-account validation no older than two minutes", () => {
    expect(desktopSessionCacheAccess("user-a", true, NOW, desktop)).toMatchObject({
      allowed: false,
      reason: "unknown",
    });
    updateDesktopSessionValidation({
      accountId: "user-a",
      status: "valid",
      validatedAt: NOW,
    });
    expect(desktopSessionCacheAccess("user-a", true, NOW, desktop)).toMatchObject({
      allowed: true,
      reason: "valid",
    });
    expect(desktopSessionCacheAccess("user-b", true, NOW, desktop)).toMatchObject({
      allowed: false,
      reason: "account-mismatch",
    });
    expect(
      desktopSessionCacheAccess(
        "user-a",
        true,
        NOW + DESKTOP_PRIVATE_CACHE_VALIDATION_MAX_AGE_MS + 1,
        desktop,
      ),
    ).toMatchObject({ allowed: false, reason: "stale" });
  });

  it("fails closed while offline and after suspend or revocation", () => {
    updateDesktopSessionValidation({
      accountId: "user-a",
      status: "valid",
      validatedAt: NOW,
    });
    expect(desktopSessionCacheAccess("user-a", false, NOW, desktop)).toMatchObject({
      allowed: false,
      reason: "offline",
    });
    invalidateDesktopSessionValidation("suspended");
    expect(desktopSessionCacheAccess("user-a", true, NOW, desktop)).toMatchObject({
      allowed: false,
      reason: "suspended",
    });
    invalidateDesktopSessionValidation("revoked");
    expect(desktopSessionCacheAccess("user-a", true, NOW, desktop)).toMatchObject({
      allowed: false,
      reason: "revoked",
    });
  });
});
