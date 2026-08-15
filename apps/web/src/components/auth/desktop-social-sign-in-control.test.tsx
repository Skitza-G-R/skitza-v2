import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { SkitzaDesktopBridgeV1 } from "~/lib/desktop/bridge";
import {
  listenForDesktopSocialSignInErrors,
  startDesktopGoogleSignIn,
} from "./desktop-social-sign-in-control";

describe("desktop system-browser social sign-in control", () => {
  it("asks the narrow native bridge for the one configured provider", async () => {
    const startSocialSignIn = vi.fn();
    const bridge = {
      protocolVersion: 1,
      capabilities: ["social-auth-v1"],
      listen: vi.fn(() => () => undefined),
      startSocialSignIn,
    } satisfies SkitzaDesktopBridgeV1;

    await startDesktopGoogleSignIn(bridge);

    expect(startSocialSignIn).toHaveBeenCalledOnce();
    expect(startSocialSignIn).toHaveBeenCalledWith("google");
  });

  it("hides WebView OAuth only when the versioned capability is present", () => {
    const source = readFileSync(
      new URL("./desktop-social-sign-in-control.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("DESKTOP_CAPABILITIES.socialAuth");
    expect(source).toContain("[&_.cl-socialButtonsBlock]:hidden");
    expect(source).toContain('startSocialSignIn("google")');
    expect(source).not.toMatch(/open\(|location|href|localStorage|sessionStorage|console\./);
  });

  it("turns an allowed native failure into a generic error signal only", () => {
    let listener: (event: unknown) => void = () => undefined;
    const unlisten = vi.fn();
    const bridge = {
      protocolVersion: 1,
      capabilities: ["social-auth-v1"],
      listen: vi.fn((next: (event: unknown) => void) => {
        listener = next;
        return unlisten;
      }),
      startSocialSignIn: vi.fn(),
    } satisfies SkitzaDesktopBridgeV1;
    const onError = vi.fn();

    const unsubscribe = listenForDesktopSocialSignInErrors(bridge, onError);
    listener({ type: "social-sign-in-error", code: "exchange-failed" });
    listener({ type: "social-sign-in-error", code: "raw-native-details" });
    unsubscribe();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("renders one accessible generic message without exposing native codes", () => {
    const source = readFileSync(
      new URL("./desktop-social-sign-in-control.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('role="alert"');
    expect(source).toContain("Could not complete sign-in. Please try again.");
    expect(source).not.toContain("event.code");
  });
});
