import { describe, expect, it } from "vitest";

import {
  initialPortfolioRows,
  nextAvailablePortfolioPlatform,
  onboardingPortfolioUrlError,
  toOnboardingPortfolioPayload,
} from "../portfolio-links";

describe("portfolio link hydration", () => {
  it("always initializes the three core platform rows", () => {
    expect(initialPortfolioRows([])).toEqual([
      { id: "link-spotify", type: "spotify", url: "", title: "" },
      { id: "link-youtube", type: "youtube", url: "", title: "" },
      {
        id: "link-instagram_reels",
        type: "instagram_reels",
        url: "",
        title: "",
      },
    ]);
  });

  it("restores saved core links, including their titles", () => {
    const rows = initialPortfolioRows([
      {
        platform: "spotify",
        url: "https://open.spotify.com/artist/saved",
        title: "Producer profile",
      },
    ]);

    expect(rows[0]).toMatchObject({
      type: "spotify",
      url: "https://open.spotify.com/artist/saved",
      title: "Producer profile",
    });
  });

  it("adds saved SoundCloud and Bandcamp rows on re-entry", () => {
    const rows = initialPortfolioRows([
      {
        platform: "soundcloud",
        url: "https://soundcloud.com/producer/mix",
        title: "Latest mix",
      },
      {
        platform: "bandcamp",
        url: "https://producer.bandcamp.com",
        title: null,
      },
    ]);

    expect(rows.slice(3)).toEqual([
      {
        id: "link-soundcloud",
        type: "soundcloud",
        url: "https://soundcloud.com/producer/mix",
        title: "Latest mix",
      },
      {
        id: "link-bandcamp",
        type: "bandcamp",
        url: "https://producer.bandcamp.com",
        title: "",
      },
    ]);
  });

  it("leaves other persisted platforms outside the onboarding payload", () => {
    const rows = initialPortfolioRows([
      {
        platform: "apple_music",
        url: "https://music.apple.com/artist/saved",
        title: "Apple Music",
      },
      {
        platform: "tidal",
        url: "https://tidal.com/artist/saved",
        title: "Tidal",
      },
    ]);
    const payload = toOnboardingPortfolioPayload(rows);

    expect(rows).toHaveLength(3);
    expect(payload.links.map((link) => link.platform)).not.toContain("apple_music");
    expect(payload.links.map((link) => link.platform)).not.toContain("tidal");
  });
});

describe("portfolio link saving", () => {
  it("accepts only an http(s) URL for the selected supported platform", () => {
    expect(
      onboardingPortfolioUrlError("spotify", "https://open.spotify.com/artist/abc"),
    ).toBeNull();
    expect(onboardingPortfolioUrlError("bandcamp", "https://artist.bandcamp.com")).toBeNull();
    expect(onboardingPortfolioUrlError("spotify", "javascript:alert(1)")).toMatch(
      /valid Spotify link/,
    );
    expect(onboardingPortfolioUrlError("spotify", "https://youtube.com/watch?v=abc")).toMatch(
      /valid Spotify link/,
    );
  });

  it("preserves the saved URL and title when Continue is pressed untouched", () => {
    const rows = initialPortfolioRows([
      {
        platform: "soundcloud",
        url: "  https://soundcloud.com/producer/mix  ",
        title: "  Latest mix  ",
      },
    ]);
    const payload = toOnboardingPortfolioPayload(rows);

    expect(payload.links.find((link) => link.platform === "soundcloud")).toEqual({
      platform: "soundcloud",
      url: "https://soundcloud.com/producer/mix",
      title: "Latest mix",
    });
  });

  it("emits an empty entry when a supported saved row is removed", () => {
    const rows = initialPortfolioRows([
      {
        platform: "soundcloud",
        url: "https://soundcloud.com/producer/mix",
        title: "Latest mix",
      },
    ]).filter((row) => row.type !== "soundcloud");
    const payload = toOnboardingPortfolioPayload(rows);

    expect(payload.links.find((link) => link.platform === "soundcloud")).toEqual({
      platform: "soundcloud",
      url: "",
      title: "",
    });
  });

  it("offers each supported platform once, then stops", () => {
    const coreRows = initialPortfolioRows([]);
    expect(nextAvailablePortfolioPlatform(coreRows)).toBe("soundcloud");

    const withSoundCloud = [
      ...coreRows,
      {
        id: "link-soundcloud",
        type: "soundcloud" as const,
        url: "",
        title: "",
      },
    ];
    expect(nextAvailablePortfolioPlatform(withSoundCloud)).toBe("bandcamp");

    expect(
      nextAvailablePortfolioPlatform([
        ...withSoundCloud,
        {
          id: "link-bandcamp",
          type: "bandcamp",
          url: "",
          title: "",
        },
      ]),
    ).toBeNull();
  });
});
