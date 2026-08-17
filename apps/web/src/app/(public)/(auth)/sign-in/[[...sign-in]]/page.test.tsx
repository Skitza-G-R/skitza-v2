import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handoff: vi.fn<(props: { handoffToken: string; signInHref: string }) => void>(),
  signIn: vi.fn<(props: Record<string, unknown>) => void>(),
}));

vi.mock("@clerk/nextjs", () => ({
  SignIn: (props: Record<string, unknown>) => {
    mocks.signIn(props);
    return <div data-clerk-sign-in />;
  },
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        host: "skitza.app",
        "x-forwarded-host": "skitza.app",
        "x-forwarded-proto": "https",
      }),
    ),
}));

vi.mock("./invitation-sign-in-handoff", () => ({
  InvitationSignInHandoff: (props: { handoffToken: string; signInHref: string }) => {
    mocks.handoff(props);
    return <div data-invitation-sign-in-handoff />;
  },
}));

import SignInPage from "./page";

describe("sign-in invitation handoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs out the completed signup session before showing sign-in", async () => {
    const ui = await SignInPage({
      searchParams: Promise.resolve({
        invitation_complete: "1",
        invitation_handoff: "a".repeat(43),
        redirect_url: "/dashboard/calendar",
      }),
    });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("data-invitation-sign-in-handoff");
    expect(mocks.handoff).toHaveBeenCalledWith({
      handoffToken: "a".repeat(43),
      signInHref: "/sign-in?redirect_url=%2Fdashboard%2Fcalendar",
    });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("treats an unbound handoff URL as an ordinary sign-in", async () => {
    const ui = await SignInPage({
      searchParams: Promise.resolve({ invitation_complete: "1" }),
    });
    renderToStaticMarkup(ui);

    expect(mocks.handoff).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });
});
