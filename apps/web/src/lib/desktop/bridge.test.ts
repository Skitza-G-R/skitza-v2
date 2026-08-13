import { describe, expect, it } from "vitest";

import {
  DESKTOP_CAPABILITIES,
  desktopBridgeHasCapability,
  detectDesktopBridge,
  parseDesktopBridgeEvent,
} from "./bridge";

describe("desktop bridge v1", () => {
  it("preserves normal web behavior when no bridge exists", () => {
    expect(detectDesktopBridge(undefined)).toEqual({ kind: "web" });
  });

  it("accepts only protocol v1 with explicit string capabilities", () => {
    const supported = detectDesktopBridge({
      protocolVersion: 1,
      capabilities: [DESKTOP_CAPABILITIES.sessionValidation],
      listen: () => () => undefined,
    });
    expect(desktopBridgeHasCapability(supported, DESKTOP_CAPABILITIES.sessionValidation)).toBe(
      true,
    );
    expect(
      detectDesktopBridge({
        protocolVersion: 2,
        capabilities: [],
        listen: () => () => undefined,
      }),
    ).toEqual({ kind: "unsupported", protocolVersion: 2 });
  });

  it("parses only narrow exact high-level events", () => {
    expect(parseDesktopBridgeEvent({ type: "window-revealed" })).toEqual({
      type: "window-revealed",
    });
    expect(
      parseDesktopBridgeEvent({
        type: "social-sign-in-ticket",
        ticket: "ticket-in-memory",
      }),
    ).toEqual({
      type: "social-sign-in-ticket",
      ticket: "ticket-in-memory",
    });
    expect(
      parseDesktopBridgeEvent({
        type: "social-sign-in-ticket",
        ticket: "ticket-in-memory",
        persist: true,
      }),
    ).toBeNull();
    expect(
      parseDesktopBridgeEvent({
        type: "social-sign-in-error",
        code: "exchange-failed",
      }),
    ).toEqual({ type: "social-sign-in-error", code: "exchange-failed" });
    expect(parseDesktopBridgeEvent({ type: "social-sign-in-error", code: "raw-stack" })).toBeNull();
    expect(parseDesktopBridgeEvent({ type: "run-shell", command: "open" })).toBeNull();
  });
});
