import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicSongPlayer } from "../public-song-player";

describe("public song guest surface", () => {
  it("shows Skitza and producer branding with version listening only", () => {
    const html = renderToStaticMarkup(
      <PublicSongPlayer
        songTitle="Guest mix"
        artist="The Artist"
        producerName="Studio Name"
        producerLogoUrl={null}
        versions={[
          {
            id: "version-new",
            label: "Version 2",
            audioUrl: "/api/audio/public/song/version-new?token=signed-token",
            durationMs: 123_000,
            uploadedAtIso: "2026-07-20T12:00:00.000Z",
            peaks: [0.2, 0.7],
          },
          {
            id: "version-old",
            label: "Version 1",
            audioUrl: "/api/audio/public/song/version-old?token=signed-token",
            durationMs: 120_000,
            uploadedAtIso: "2026-07-19T12:00:00.000Z",
            peaks: [0.1, 0.6],
          },
        ]}
      />,
    );

    expect(html).toContain("Skitza");
    expect(html).toContain("Studio Name");
    expect(html).toContain("Guest mix");
    expect(html).toContain("Version 2");
    expect(html).toContain("Version 1");
    expect(html).toContain("newest available version is selected first");
    expect(html).not.toMatch(/>\s*Download\s*</i);
    expect(html).not.toMatch(/>\s*Comments?\s*</i);
    expect(html).not.toMatch(/private comment/i);
  });

  it("wraps an unbroken valid title and gates interactive motion", () => {
    const longTitle = "S".repeat(120);
    const html = renderToStaticMarkup(
      <PublicSongPlayer
        songTitle={longTitle}
        artist={null}
        producerName="Studio Name"
        producerLogoUrl={null}
        versions={[
          {
            id: "version-new",
            label: "Version 2",
            audioUrl: "/api/audio/public/song/version-new?token=signed-token",
            durationMs: 123_000,
            uploadedAtIso: "2026-07-20T12:00:00.000Z",
            peaks: [0.2, 0.7],
          },
        ]}
      />,
    );

    expect(html).toContain(longTitle);
    expect(html).toContain("break-words");
    expect(html).toContain("motion-reduce:transform-none");
    expect(html).toContain("motion-reduce:transition-none");
  });
});
