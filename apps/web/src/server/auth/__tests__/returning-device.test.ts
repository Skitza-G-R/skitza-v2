import { describe, expect, it } from "vitest";

import {
  RETURNING_DEVICE_COOKIE,
  returningDeviceCookieOptions,
  shouldRedirectReturningDeviceToSignIn,
  shouldStampReturningDeviceCookie,
  signInSwitchHref,
  signUpSwitchHref,
} from "../returning-device";

describe("returning-device marker", () => {
  it("uses a non-account-specific first-party cookie", () => {
    expect(RETURNING_DEVICE_COOKIE).toBe("skitza-returning");
  });

  it("stamps the marker only after Clerk confirms an authenticated user", () => {
    expect(
      shouldStampReturningDeviceCookie({
        userId: "user_123",
        cookieValue: undefined,
      }),
    ).toBe(true);
    expect(
      shouldStampReturningDeviceCookie({
        userId: null,
        cookieValue: undefined,
      }),
    ).toBe(false);
    expect(
      shouldStampReturningDeviceCookie({
        userId: "user_123",
        cookieValue: "1",
      }),
    ).toBe(false);
  });

  it("keeps the marker private, same-site, and durable for one year", () => {
    expect(returningDeviceCookieOptions(false)).toEqual({
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
    expect(returningDeviceCookieOptions(true).secure).toBe(true);
  });
});

describe("auth page switch URLs", () => {
  it("marks an explicit switch from sign-in to account creation", () => {
    expect(signUpSwitchHref()).toBe("/sign-up?intent=signup");
    expect(signUpSwitchHref("/artist/music?studio=studio-a&mode=songs")).toBe(
      "/sign-up?intent=signup&redirect_url=%2Fartist%2Fmusic%3Fstudio%3Dstudio-a%26mode%3Dsongs",
    );
  });

  it("returns join intent to the dedicated Artist signup route", () => {
    expect(
      signUpSwitchHref(
        "/join/northline-studio/continue?action=book",
      ),
    ).toBe("/sign-up/join/northline-studio");
    expect(
      signUpSwitchHref(
        "/join/northline-studio/continue?action=unlock",
      ),
    ).toBe("/sign-up/join/northline-studio/unlock");
  });

  it("preserves a safe deep link when switching back to sign-in", () => {
    expect(signInSwitchHref()).toBe("/sign-in");
    expect(signInSwitchHref("/dashboard/clients-projects?tab=clients")).toBe(
      "/sign-in?redirect_url=%2Fdashboard%2Fclients-projects%3Ftab%3Dclients",
    );
  });

  it("drops external and non-app redirect targets", () => {
    expect(signUpSwitchHref("https://evil.example/artist")).toBe("/sign-up?intent=signup");
    expect(signInSwitchHref("//evil.example/dashboard")).toBe("/sign-in");
    expect(signInSwitchHref("/")).toBe("/sign-in");
  });
});

describe("returning-device sign-up entry decision", () => {
  const returningRootEntry = {
    userId: null,
    cookieValue: "1",
    intent: undefined,
    routeSegments: undefined,
  };

  it("sends a signed-out returning device from root sign-up to sign-in", () => {
    expect(shouldRedirectReturningDeviceToSignIn(returningRootEntry)).toBe(true);
  });

  it("keeps new or unknown devices on sign-up marketing", () => {
    expect(
      shouldRedirectReturningDeviceToSignIn({
        ...returningRootEntry,
        cookieValue: undefined,
      }),
    ).toBe(false);
  });

  it("honors an explicit Create account switch on a returning device", () => {
    expect(
      shouldRedirectReturningDeviceToSignIn({
        ...returningRootEntry,
        intent: "signup",
      }),
    ).toBe(false);
  });

  it("never interrupts Clerk's nested sign-up steps", () => {
    expect(
      shouldRedirectReturningDeviceToSignIn({
        ...returningRootEntry,
        routeSegments: ["verify-email-address"],
      }),
    ).toBe(false);
  });

  it("does not send an already signed-in session back to sign-in", () => {
    expect(
      shouldRedirectReturningDeviceToSignIn({
        ...returningRootEntry,
        userId: "user_123",
      }),
    ).toBe(false);
  });
});
