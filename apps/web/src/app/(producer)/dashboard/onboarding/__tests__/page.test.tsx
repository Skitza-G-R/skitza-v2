import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((href: string) => {
  throw new Error(`__REDIRECT__:${href}`);
});

vi.mock("next/navigation", () => ({
  redirect: (href: string) => redirectMock(href),
}));

import OnboardingPage from "../page";

describe("/dashboard/onboarding", () => {
  it("redirects the legacy entry to the canonical onboarding flow", () => {
    expect(() => {
      OnboardingPage();
    }).toThrow("__REDIRECT__:/onboarding");
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
  });
});
