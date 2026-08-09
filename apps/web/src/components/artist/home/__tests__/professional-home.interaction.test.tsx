// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArtistHomeAction } from "../home-priority";

const mocks = vi.hoisted(() => ({
  acknowledgeTrackVersion: vi.fn(),
  playerPlay: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/components/artist/artist-notification-actions", () => ({
  acknowledgeArtistTrackVersionAction: mocks.acknowledgeTrackVersion,
}));

vi.mock("~/components/audio/persistent-player", () => ({
  playerPlay: mocks.playerPlay,
}));

import { ProfessionalArtistHome } from "../professional-home";

const mainSession = action("session-1", "today_session", "Mix review");
const payment = action("payment-1", "payment_action", "₪600.00 due");
const newVersion = {
  ...action("version-later", "new_song", "Neon Afterglow"),
  detail: "Mix v4 · Northline Studio",
  href: "/artist/music/song/version-later?studio=studio-1",
  actionLabel: "Open song",
  isNew: true,
  audio: {
    url: "https://audio.example/version-later.mp3",
    title: "Neon Afterglow",
    subtitle: "Northline Studio",
    durationMs: null,
  },
} satisfies ArtistHomeAction;

function action(
  id: string,
  kind: ArtistHomeAction["kind"],
  title: string,
): ArtistHomeAction {
  return {
    id,
    kind,
    title,
    detail: "Action detail",
    href: `/artist/${id}`,
    actionLabel: "View",
    upcomingAt: null,
    occurredAt: new Date("2026-08-09T08:00:00.000Z"),
  };
}

beforeEach(() => {
  mocks.acknowledgeTrackVersion.mockReset();
  mocks.playerPlay.mockReset();
});

afterEach(cleanup);

describe("ProfessionalArtistHome new Version action", () => {
  it("keeps the exact new Version visible beside higher-priority session and payment content", () => {
    render(
      <ProfessionalArtistHome
        greeting="Good morning, Maya."
        studioName="Northline Studio"
        main={mainSession}
        newSong={newVersion}
        supporting={[payment]}
        welcome={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Mix review" })).not.toBeNull();
    expect(screen.getByText("₪600.00 due")).not.toBeNull();
    expect(screen.getByText("Neon Afterglow")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open song" }).getAttribute("href")).toBe(
      "/artist/music/song/version-later?studio=studio-1",
    );
  });

  it("acknowledges the exact played Version and removes only its temporary row", async () => {
    const user = userEvent.setup();
    render(
      <ProfessionalArtistHome
        greeting="Good morning, Maya."
        studioName="Northline Studio"
        main={mainSession}
        newSong={newVersion}
        supporting={[payment]}
        welcome={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Play Neon Afterglow" }));

    expect(mocks.playerPlay).toHaveBeenCalledWith({
      id: "version-later",
      audioUrl: "https://audio.example/version-later.mp3",
      title: "Neon Afterglow",
      subtitle: "Northline Studio",
      durationMs: null,
    });
    expect(mocks.acknowledgeTrackVersion).toHaveBeenCalledWith({
      trackVersionId: "version-later",
    });
    expect(screen.queryByText("Neon Afterglow")).toBeNull();
    expect(screen.getByRole("heading", { name: "Mix review" })).not.toBeNull();
    expect(screen.getByText("₪600.00 due")).not.toBeNull();
  });
});
