/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn<(options?: { redirectUrl?: string }) => Promise<void>>();

vi.mock("~/components/audio/app-media-runtime", () => ({
  useSafeSignOut: () => signOutMock,
}));

import { InvitationSignInHandoff } from "./invitation-sign-in-handoff";
import { INVITATION_SIGNUP_HANDOFF_KEY } from "~/components/auth/invitation-signup-marker";

const handoffToken = "a".repeat(43);

describe("InvitationSignInHandoff", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(INVITATION_SIGNUP_HANDOFF_KEY, handoffToken);
  });

  it("ends Clerk's signup session and opens a fresh sign-in", async () => {
    signOutMock.mockResolvedValueOnce(undefined);

    render(
      <InvitationSignInHandoff
        handoffToken={handoffToken}
        signInHref="/sign-in?redirect_url=%2Fdashboard%2Fcalendar"
      />,
    );

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledWith({
        redirectUrl: "/sign-in?redirect_url=%2Fdashboard%2Fcalendar",
      });
    });
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it("shows a retry when Clerk cannot end the signup session", async () => {
    signOutMock
      .mockRejectedValueOnce(new Error("Clerk unavailable"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(<InvitationSignInHandoff handoffToken={handoffToken} signInHref="/sign-in" />);

    const retry = await screen.findByRole("button", { name: "Continue to sign in" });
    expect(screen.getByRole("alert").textContent).toContain("couldn't open sign in");
    await user.click(retry);

    expect(signOutMock).toHaveBeenLastCalledWith({ redirectUrl: "/sign-in" });
    expect(signOutMock).toHaveBeenCalledTimes(2);
  });

  it("does not sign out a user who opens a crafted handoff URL", async () => {
    window.sessionStorage.clear();

    render(<InvitationSignInHandoff handoffToken={handoffToken} signInHref="/sign-in" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Reopen your Skitza invitation email",
    );
    expect(signOutMock).not.toHaveBeenCalled();
  });
});
