import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("./sk195-google-sync-preview.tsx", import.meta.url), "utf8");

describe("SK-195 Google sync visual preview", () => {
  it("is dev-gated and uses only safe fixture data", () => {
    expect(page).toContain("if (!isDevGalleryAvailable()) notFound();");
    expect(`${page}\n${preview}`).not.toMatch(/\bauth\s*\(|appRouter|~\/server\/db/);
    expect(preview).not.toMatch(/eventId|etag|jobId|providerBody|accessToken|refreshToken/);
  });

  it("uses the current producer shell and exposes the session and dialog views", () => {
    expect(preview).toContain("GoogleCalendarPreview");
    expect(preview).toContain("SessionsPanel");
    expect(page).toContain('requestedView === "dialog"');
    expect(preview).toContain('calendarSync: { state: "missing" }');
    expect(preview).toContain('calendarSync: { state: "conflict" }');
  });
});
