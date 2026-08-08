import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function routerSource(filename: string): string {
  return readFileSync(new URL(`../../trpc/routers/${filename}`, import.meta.url), "utf8");
}

const artist = routerSource("artist.ts");
const booking = routerSource("booking.ts");
const project = routerSource("project.ts");
const purchase = routerSource("purchase.ts");

describe("SK-112 real push event wiring", () => {
  it("maps artist-created events to exact producer items after successful writes", () => {
    expect(artist).toMatch(
      /emitCommentCreated[\s\S]*?deliverPushToProducer[\s\S]*?category: "comment"[\s\S]*?`\/dashboard\/music\/\$\{input\.trackVersionId\}`/,
    );
    expect(artist).toMatch(
      /if \(result\.created\)[\s\S]*?emitBookingRequested[\s\S]*?deliverPushToProducer[\s\S]*?category: "booking"[\s\S]*?`\/dashboard\/calendar\?booking=\$\{result\.booking\.id\}`/,
    );
    expect(purchase).toMatch(
      /if \(result\.created\)[\s\S]*?emitPurchaseRequested[\s\S]*?category: "purchase_status"[\s\S]*?`\/dashboard\/requests\/\$\{result\.request\.id\}`/,
    );
    expect(purchase).toMatch(
      /const notification = result\.notification[\s\S]*?emitProofSubmitted[\s\S]*?category: "payment"[\s\S]*?`\/dashboard\/payments\/\$\{notification\.proofId\}`/,
    );
  });

  it("maps producer decisions to exact artist items only on real transitions", () => {
    expect(booking.match(/category: "booking"/g)).toHaveLength(6);
    expect(booking.match(/`\/artist\/sessions\/\$\{result\.booking\.id\}`/g)).toHaveLength(5);
    expect(booking).toContain("`/artist/sessions/${destinationBookingId}`");

    expect(purchase).toMatch(
      /if \(result\.transition\.changed\)[\s\S]*?category: "purchase_status"[\s\S]*?`\/artist\/purchase\/\$\{request\.productId\}\/pay\?req=\$\{request\.id\}`/,
    );
    expect(purchase).toMatch(
      /if \(result\.transition\.changed\)[\s\S]*?category: "purchase_status"[\s\S]*?`\/artist\/purchase\/\$\{request\.productId\}\/sent\?req=\$\{request\.id\}`/,
    );
    expect(purchase).toMatch(
      /if \(result\.created\)[\s\S]*?category: "payment"[\s\S]*?`\/artist\/payments\/\$\{result\.purchaseId\}`/,
    );
    expect(purchase).toMatch(
      /if \(result\.changed\)[\s\S]*?category: "payment"[\s\S]*?`\/artist\/payments\/\$\{result\.purchaseId\}`/,
    );
  });

  it("maps only concrete project, song, and comment mutations", () => {
    expect(project).toMatch(
      /result\.changed &&[\s\S]*?input\.workflowStage !== undefined &&[\s\S]*?before\?\.workflowStage !== result\.project\.workflowStage[\s\S]*?category: "project_status"[\s\S]*?`\/artist\/music\/\$\{result\.project\.id\}`/,
    );
    expect(project.match(/category: "project_status"/g)).toHaveLength(4);
    expect(project).toMatch(
      /result\.changed && input\.ready[\s\S]*?category: "song_status"[\s\S]*?`\/artist\/music\/song\/\$\{input\.versionId\}`/,
    );
    expect(artist).toMatch(
      /if \(result\.changed\)[\s\S]*?deliverPushToVersionProducer[\s\S]*?category: "song_status"[\s\S]*?`\/dashboard\/music\/\$\{input\.versionId\}`/,
    );
    expect(project).toMatch(
      /deliverPushToVersionArtist[\s\S]*?category: "comment"[\s\S]*?`\/artist\/music\/song\/\$\{input\.versionId\}\?comment=\$\{row\.id\}`/,
    );
  });

  it("keeps every delivery best effort and does not log delivery data", () => {
    const sources = [artist, booking, project, purchase].join("\n");
    expect(sources).not.toMatch(/\[push\]|push delivery failed|endpoint|p256dh/);
    expect(
      sources.match(/Push is best effort and must not expose delivery details\./g)?.length,
    ).toBeGreaterThanOrEqual(12);
  });
});
