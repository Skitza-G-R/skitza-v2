import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep test for the new project detail page shell. Phase 2
// rewrote this page to render <AlbumSpace /> instead of the legacy
// ProjectHeader + ProjectRoomHero + ProjectStatStrip + ProjectSubTabs
// + 5 sub-tabs stack.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "page.tsx"), "utf-8");

describe("clients-projects/[id]/page.tsx — Phase 2 rewrite to AlbumSpace", () => {
  it("imports AlbumSpace as the new top-level body", () => {
    expect(SRC).toContain("AlbumSpace");
    expect(SRC).toContain("~/components/dashboard/project/album-space");
  });

  it("renders <AlbumSpace ... /> in the body", () => {
    expect(SRC).toMatch(/<AlbumSpace/);
  });

  it("preserves auth + caller scaffolding", () => {
    expect(SRC).toContain("@clerk/nextjs/server");
    expect(SRC).toContain("appRouter.createCaller");
  });

  it("fetches project detail without the removed project-level money projection", () => {
    expect(SRC).toContain("project.detail");
    expect(SRC).not.toContain("project.money");
  });

  it("starts detail, canonical payments, and scoped Album Space bookings together", () => {
    const detailAt = SRC.indexOf("project.detail({ id })");
    const paymentsAt = SRC.indexOf("purchaseLedger.project({ projectId: id })");
    const bookingsAt = SRC.indexOf("booking.list({ projectId: id })");
    const settledStart = SRC.lastIndexOf("Promise.allSettled", detailAt);
    const settledEnd = SRC.indexOf("]);", bookingsAt);

    expect(settledStart).toBeGreaterThan(-1);
    expect(detailAt).toBeGreaterThan(settledStart);
    expect(paymentsAt).toBeGreaterThan(detailAt);
    expect(bookingsAt).toBeGreaterThan(paymentsAt);
    expect(settledEnd).toBeGreaterThan(bookingsAt);
    expect(SRC).toContain('bookingsResult.status === "fulfilled" ? bookingsResult.value : []');
  });

  it("uses the stable clientContactId for the breadcrumb without a global client list", () => {
    expect(SRC).not.toContain("clientContacts.listWithProjects");
    expect(SRC).toContain("data.project.clientContactId");
    expect(SRC).not.toContain("breadcrumbClientEmail");
  });

  it("drops the import of the old ProjectHeader", () => {
    expect(SRC).not.toContain("ProjectHeader");
    expect(SRC).not.toContain("project-header");
  });

  it("drops the import of the old ProjectRoomHero", () => {
    expect(SRC).not.toContain("ProjectRoomHero");
    expect(SRC).not.toContain("project-room-hero");
  });

  it("drops the import of the old ProjectStatStrip", () => {
    expect(SRC).not.toContain("ProjectStatStrip");
    expect(SRC).not.toContain("project-stat-strip");
  });

  it("drops the import of the old ProjectSubTabs + resolver", () => {
    expect(SRC).not.toContain("ProjectSubTabs");
    expect(SRC).not.toContain("project-sub-tabs");
    expect(SRC).not.toContain("resolveProjectSubTab");
    expect(SRC).not.toContain("project-sub-tab-shared");
  });

  it("drops the imports of legacy sub-tabs that the new IA replaces", () => {
    // The removed Files control and its legacy sub-tab stay out of the shell.
    expect(SRC).not.toContain('from "~/components/dashboard/project/sub-tabs/files-sub-tab"');
    expect(SRC).not.toContain("MusicSubTab");
    expect(SRC).not.toContain("NotesSubTab");
    expect(SRC).not.toContain("OverviewSubTab");
  });

  it("forbids non-existent CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("combines scoped sessions and project activity into one newest-first Studio Log", () => {
    expect(SRC).toContain("const sessionEntries: StudioLogEntry[]");
    expect(SRC).toContain("status: booking.status");
    expect(SRC).toContain("buildProjectActivityEntries");
    expect(SRC).toContain("[...activities, ...sessionEntries].sort");
    expect(SRC).toContain("right.ts.getTime() - left.ts.getTime()");
  });

  it("derives row playback and the existing Music player destination from version ids", () => {
    expect(SRC).toContain("const detailVersion = playable ?? historical");
    expect(SRC).toContain("/dashboard/music/${encodeURIComponent(detailVersion.id)}");
    expect(SRC).toContain("projectSongUploadHref(data.project.id, t.id)");
    expect(SRC).toContain("versionId: playable.id");
    expect(SRC).toContain("audioUrl: playable.audioUrl");
  });

  it("uses canonical producer payment buckets without merging currencies", () => {
    expect(SRC).toContain("paymentModel.producerBuckets.needs_review");
    expect(SRC).toContain("paymentModel.producerBuckets.due_or_overdue");
    expect(SRC).toContain("paymentModel.producerBuckets.history");
    expect(SRC).toContain("needsReviewPurchaseCount + dueOrOverduePurchaseCount");
    expect(SRC).not.toContain("allPaymentsBucket");
    expect(SRC).not.toContain("upcomingCount");
  });

  it("renders the compact Project Space for one-song and multi-song projects", () => {
    expect(SRC).not.toMatch(
      /redirect\([\s\S]*?`\/dashboard\/clients-projects\/\$\{[^}]+\}\/songs\/\$\{[^}]+\}`[\s\S]*?\)/,
    );
    expect(SRC).toMatch(/<AlbumSpace/);
  });

  it("keeps only a one-shot upload handoff instead of a lower song workspace", () => {
    expect(SRC).toMatch(/searchParams\?:\s*Promise<\{[\s\S]*?song\?:\s*string/);
    expect(SRC).toMatch(/searchParams\?:\s*Promise<\{[\s\S]*?upload\?:\s*string/);
    expect(SRC).toContain("const selectedTrack =");
    expect(SRC).toContain("selectedSongUpload");
    expect(SRC).toContain("songVersions");
    expect(SRC).toContain("classifySongUploadPublicExposure");
    expect(SRC).toContain("selectedSongUpload={selectedSongUpload}");
    expect(SRC).toContain('initialUploadOpen={query.upload === "1"}');
    expect(SRC).not.toContain("ProjectSongWorkspace");
    expect(SRC).not.toContain("SessionsTabSession");
    expect(SRC).not.toContain("VersionRowVersionData");
    expect(SRC).not.toContain("songSessions");
  });

  it("rejects an upload handoff for a song outside the producer-scoped project", () => {
    expect(SRC).toMatch(/if\s*\(\s*query\.song\s*&&\s*!selectedTrack\s*\)[\s\S]*?notFound\(\)/);
  });

  it("maps artist credit into AlbumSpace rows", () => {
    expect(SRC).toMatch(/artist:\s*t\.artist/);
  });

  it("shows only durable Songs and passes the current Project into AlbumSpace", () => {
    expect(SRC).toContain("const durableTracks = data.tracks.filter");
    expect(SRC).toContain("songsCount: durableTracks.length");
    expect(SRC).toContain("tracks={tracks}");
    expect(SRC).not.toContain("lockProject=1");
  });

  it("lets AppShell own the main landmark and omits the stopped Add Session flow", () => {
    expect(SRC).not.toContain("<main");
    expect(SRC).not.toContain("Add Session");
    expect(SRC).not.toContain("/artist/book");
  });

  it("releases the page-enter transform after entry so sticky tabs keep the viewport", () => {
    expect(SRC).toContain('animationFillMode: "backwards"');
  });
});
