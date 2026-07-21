import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("SK-44 private Music delivery wiring", () => {
  it("reads artist permission from the protected backend and uses the exact purchase route", () => {
    const artistPage = read("src/app/(artist)/artist/music/song/[versionId]/page.tsx");
    const sharedSongPage = read("src/components/music/song-page.tsx");

    expect(artistPage).toContain("caller.audioDelivery.artistEntitlement");
    expect(artistPage).toContain("purchaseId: version.purchaseId");
    expect(sharedSongPage).toContain(
      "/api/audio/download/${activeVersion.delivery.purchaseId}/${activeVersion.id}",
    );
    expect(sharedSongPage).toContain("presentVersionDelivery(activeVersion.delivery)");
  });

  it("changes early access for only the producer-selected exact version", () => {
    const producerPage = read("src/app/(producer)/dashboard/music/[versionId]/page.tsx");
    const producerActions = read("src/app/(producer)/dashboard/music/[versionId]/actions.ts");
    const sharedSongPage = read("src/components/music/song-page.tsx");

    expect(producerPage).toContain("caller.audioDelivery.overrideState");
    expect(producerPage).toContain("setDownloadOverride: l3SetDownloadOverride");
    expect(producerActions).toContain("c.caller.audioDelivery.setDownloadOverride");
    expect(sharedSongPage).toContain("versionId: targetVersion.id");
    expect(sharedSongPage).toContain(
      "expectedUnpaidAmountCents: targetVersion.delivery.remainingCents",
    );
    expect(sharedSongPage).toContain(
      "This unlocks only the selected audio version before full payment",
    );
  });

  it("keeps deleted audio out of play and download actions", () => {
    const sharedSongPage = read("src/components/music/song-page.tsx");

    expect(sharedSongPage).toContain('"audio_deleted"');
    expect(sharedSongPage).toContain("activeVersionPlayable &&");
    expect(sharedSongPage).toContain('delivery.key !== "deleted"');
  });
});
