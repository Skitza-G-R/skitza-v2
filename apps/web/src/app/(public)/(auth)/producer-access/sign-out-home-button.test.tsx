/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn<(options?: { redirectUrl?: string }) => Promise<void>>();

vi.mock("~/components/audio/app-media-runtime", () => ({
  useSafeSignOut: () => signOutMock,
}));

import { SignOutHomeButton } from "./sign-out-home-button";

describe("SignOutHomeButton", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ends the session and lands on the public homepage", async () => {
    signOutMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<SignOutHomeButton label="Sign out and back to homepage" />);

    await user.click(screen.getByRole("button", { name: "Sign out and back to homepage" }));

    expect(signOutMock).toHaveBeenCalledWith({ redirectUrl: "/" });
  });

  it("keeps a failed sign-out retryable", async () => {
    signOutMock.mockRejectedValueOnce(new Error("Clerk unavailable"));
    const user = userEvent.setup();
    render(<SignOutHomeButton label="Sign out" />);

    const button = screen.getByRole("button", { name: "Sign out" });
    await user.click(button);

    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t sign out");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
