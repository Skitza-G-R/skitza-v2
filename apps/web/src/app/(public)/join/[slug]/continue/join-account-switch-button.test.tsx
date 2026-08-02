/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn<(options?: { redirectUrl?: string }) => Promise<void>>();

vi.mock("~/components/audio/app-media-runtime", () => ({
  useSafeSignOut: () => signOutMock,
}));

import { JoinAccountSwitchButton } from "./join-account-switch-button";

describe("JoinAccountSwitchButton", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a failed account switch retryable and explains the failure", async () => {
    signOutMock.mockRejectedValueOnce(new Error("Clerk unavailable"));
    const user = userEvent.setup();
    render(<JoinAccountSwitchButton slug="northline-studio" action="book" />);

    const button = screen.getByRole("button", {
      name: "Sign out and choose account",
    });
    await user.click(button);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't sign out. Try again.",
    );
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(signOutMock).toHaveBeenCalledWith({
      redirectUrl: "/sign-in?redirect_url=%2Fjoin%2Fnorthline-studio%2Fcontinue%3Faction%3Dbook",
    });
  });

  it("shows progress and prevents repeat clicks while sign-out is pending", async () => {
    signOutMock.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const user = userEvent.setup();
    render(<JoinAccountSwitchButton slug="northline-studio" action="unlock" />);

    await user.click(screen.getByRole("button", { name: "Sign out and choose account" }));

    const pendingButton = screen.getByRole("button", { name: "Signing out…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(pendingButton);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});
