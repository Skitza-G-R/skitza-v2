import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
}));

vi.mock("~/server/auth/role", () => ({
  requireRole: requireRoleMock,
}));
vi.mock("~/i18n/app-i18n-provider", () => ({
  AppI18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import ArtistWelcomeLayout from "./layout";

describe("artist welcome role gate", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    requireRoleMock.mockResolvedValue({
      userId: "artist-user",
      hasProducerProfile: false,
      producerProfileStatus: "none",
      producerProfileId: null,
    });
  });

  it("requires Artist membership before rendering the welcome surface", async () => {
    const markup = renderToStaticMarkup(
      await ArtistWelcomeLayout({ children: <div>Artist welcome</div> }),
    );

    expect(requireRoleMock).toHaveBeenCalledWith("artist");
    expect(markup).toContain("Artist welcome");
  });
});
