/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn<(options?: { redirectUrl?: string }) => Promise<void>>();

vi.mock("~/components/audio/app-media-runtime", () => ({
  useSafeSignOut: () => signOutMock,
}));

import { InvitationAccountSwitchButton } from "./invitation-account-switch-button";

describe("InvitationAccountSwitchButton", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(
      {},
      "",
      "/sign-up?__clerk_ticket=secret_ticket&__clerk_status=sign_in&redirect_url=%2Fauth%2Fresolve",
    );
  });

  it("returns to the untouched local invitation URL after signing out", async () => {
    signOutMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<InvitationAccountSwitchButton />);

    await user.click(screen.getByRole("button", { name: "Sign out and accept invitation" }));

    expect(signOutMock).toHaveBeenCalledWith({
      redirectUrl:
        "/sign-up?__clerk_ticket=secret_ticket&__clerk_status=sign_in&redirect_url=%2Fauth%2Fresolve",
    });
  });

  it("keeps a failed account switch retryable", async () => {
    signOutMock.mockRejectedValueOnce(new Error("Clerk unavailable"));
    const user = userEvent.setup();
    render(<InvitationAccountSwitchButton />);

    const button = screen.getByRole("button", {
      name: "Sign out and accept invitation",
    });
    await user.click(button);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't switch accounts. Try again.",
    );
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
