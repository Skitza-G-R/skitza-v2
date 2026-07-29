import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AlbumSpaceLoading from "../loading";

describe("AlbumSpaceLoading", () => {
  it("mirrors the compact header, four tabs, and compact song rows", () => {
    const html = renderToStaticMarkup(<AlbumSpaceLoading />);

    expect(html).not.toContain("<main");
    expect(html.match(/data-loading-slot="project-tab"/g)).toHaveLength(4);
    expect(html.match(/data-loading-slot="song-row"/g)).toHaveLength(4);
    expect(html).toContain("sticky top-0");
    expect(html).toContain("lg:top-16");
    expect(html).toContain("h-[68px]");
    expect(html).toContain("animation-fill-mode:backwards");
  });
});
