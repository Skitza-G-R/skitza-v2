import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const historySource = readFileSync(join(process.cwd(), "src/server/artist/history.ts"), "utf8");
const pastStudioPage = readFileSync(
  join(process.cwd(), "src/app/(artist)/artist/settings/studios/[producerId]/page.tsx"),
  "utf8",
);
const versionPage = readFileSync(
  join(
    process.cwd(),
    "src/app/(artist)/artist/settings/studios/[producerId]/music/[trackId]/versions/[versionId]/page.tsx",
  ),
  "utf8",
);
const proofPage = readFileSync(
  join(
    process.cwd(),
    "src/app/(artist)/artist/settings/studios/[producerId]/proofs/[proofId]/page.tsx",
  ),
  "utf8",
);
const sessionPage = readFileSync(
  join(
    process.cwd(),
    "src/app/(artist)/artist/settings/studios/[producerId]/sessions/[sessionId]/page.tsx",
  ),
  "utf8",
);
const roleSource = readFileSync(join(process.cwd(), "src/server/auth/role.ts"), "utf8");
const proofServiceSource = readFileSync(
  join(process.cwd(), "src/server/domain/payment-proofs/service.ts"),
  "utf8",
);

describe("Past-studio exact historical access contract", () => {
  it("binds every detail read to the signed-in artist, producer, type, and exact id", () => {
    expect(historySource).toMatch(
      /eq\(artistHistoricalAccessGrants\.artistClerkUserId, input\.clerkUserId\)/,
    );
    expect(historySource).toMatch(
      /eq\(artistHistoricalAccessGrants\.producerId, input\.producerId\)/,
    );
    expect(historySource).toContain(
      'eq(artistHistoricalAccessGrants.resourceType, "track_version")',
    );
    expect(historySource).toContain(
      "eq(artistHistoricalAccessGrants.resourceId, input.versionId)",
    );
    expect(historySource).toContain(
      'eq(artistHistoricalAccessGrants.resourceType, "payment_proof")',
    );
    expect(historySource).toContain(
      "eq(artistHistoricalAccessGrants.resourceId, input.proofId)",
    );
    expect(historySource).toContain(
      'eq(artistHistoricalAccessGrants.resourceType, "booking")',
    );
    expect(historySource).toContain(
      "eq(artistHistoricalAccessGrants.resourceId, input.sessionId)",
    );
  });

  it("separates playback grants from exact-version download grants", () => {
    expect(historySource).toContain(
      'resourceType: "track_version_download"',
    );
    expect(historySource).toMatch(
      /input\.download[\s\S]*resourceType: "track_version_download"[\s\S]*resourceId: row\.versionId/,
    );
    expect(versionPage).toContain(
      'controlsList={data.version.downloadUrl ? undefined : "nodownload"}',
    );
    expect(versionPage).toMatch(
      /data\.version\.downloadUrl \?[\s\S]*Download this version/,
    );
  });

  it("keeps every detail standing and mutation-free with an exact Past-studio Back link", () => {
    for (const source of [versionPage, proofPage, sessionPage]) {
      expect(source).toContain("<PastStudioRecordShell");
      expect(source).toContain(
        "`/artist/settings/studios/${encodeURIComponent(producerId)}`",
      );
      expect(source).not.toMatch(/mutation|server action|Upload|Reschedule|Cancel session/);
    }
    expect(pastStudioPage).toContain("/music/${encodeURIComponent(song.id)}/versions/");
    expect(pastStudioPage).toContain("/proofs/${encodeURIComponent(proof.id)}");
    expect(pastStudioPage).toContain("/sessions/${encodeURIComponent(session.id)}");
  });

  it("keeps zero-active-studio history reachable without creating a switcher studio", () => {
    expect(roleSource).toContain("pastStudioGrant");
    expect(roleSource).toContain(
      "contact !== undefined || pastStudioGrant !== undefined",
    );
    expect(roleSource).not.toMatch(
      /pastStudioGrant[\s\S]{0,180}(initialStudioId|artist\.studios)/,
    );
  });

  it("rechecks the exact historical proof and studio grants before private evidence", () => {
    expect(proofServiceSource).toMatch(
      /artistHistoricalAccessGrants[\s\S]*resourceType, "payment_proof"[\s\S]*resourceId, paymentProofs\.id/,
    );
    expect(proofServiceSource).toMatch(
      /resourceType, "studio"[\s\S]*resourceId, historical\.producerId/,
    );
  });
});
