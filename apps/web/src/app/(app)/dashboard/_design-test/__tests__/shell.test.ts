import { describe, expect, it } from "vitest";

import { deriveActiveKey } from "../shell";

// Pathname → active sidebar key. Critical: /dashboard/music must map
// to "music", NOT "overview" — even though "music" startsWith "/dashboard"
// would also match. The longest-href-first sort guarantees this.

describe("deriveActiveKey", () => {
  it("returns 'overview' for the dashboard root exactly", () => {
    expect(deriveActiveKey("/dashboard")).toBe("overview");
  });

  it("returns 'projects' for /dashboard/projects and any descendants", () => {
    expect(deriveActiveKey("/dashboard/projects")).toBe("projects");
    expect(deriveActiveKey("/dashboard/projects/abc-123")).toBe("projects");
  });

  it("returns 'music' for /dashboard/music — NOT 'overview' (longest-match guard)", () => {
    expect(deriveActiveKey("/dashboard/music")).toBe("music");
    expect(deriveActiveKey("/dashboard/music/some-track")).toBe("music");
  });

  it("returns 'calendar' for /dashboard/booking (Skitza routes booking under that path)", () => {
    expect(deriveActiveKey("/dashboard/booking")).toBe("calendar");
  });

  it("returns 'settings' for /dashboard/settings + descendants", () => {
    expect(deriveActiveKey("/dashboard/settings")).toBe("settings");
    expect(deriveActiveKey("/dashboard/settings/integrations")).toBe("settings");
  });

  it("falls back to 'overview' for null pathname (SSR pre-mount)", () => {
    expect(deriveActiveKey(null)).toBe("overview");
  });

  it("falls back to 'overview' for paths outside /dashboard", () => {
    expect(deriveActiveKey("/artist")).toBe("overview");
    expect(deriveActiveKey("/")).toBe("overview");
  });
});
