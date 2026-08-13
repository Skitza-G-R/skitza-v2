import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const openState = readFileSync(new URL("../open-state.ts", import.meta.url), "utf8");
const booking = readFileSync(new URL("../../../trpc/routers/booking.ts", import.meta.url), "utf8");
const artwork = readFileSync(new URL("../../song-artwork/service.ts", import.meta.url), "utf8");
const firstVersion = readFileSync(
  new URL("../../../trpc/routers/first-version-upload.ts", import.meta.url),
  "utf8",
);
const multipart = readFileSync(
  new URL("../../../audio/pending-multipart-initiation.ts", import.meta.url),
  "utf8",
);
const audioRouter = readFileSync(
  new URL("../../../trpc/routers/audio.ts", import.meta.url),
  "utf8",
);

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("closed Producer upload capability boundaries", () => {
  it("locks the authoritative Producer row including closedAt", () => {
    expect(openState).toContain("closedAt: producers.closedAt");
    expect(openState).toContain("eq(producers.id, producerId)");
    expect(openState).toContain('.for("update")');
  });

  it("holds the Producer lock through agreement PDF presign and finalization", () => {
    const prepare = section(
      booking,
      "  prepareAgreementPdfUpload:",
      "\n\n  cancelAgreementPdfUpload:",
    );
    const create = section(booking, "  create: producerProcedure", "\n\n  update:");
    const update = section(
      booking,
      "  update: producerProcedure",
      "\n\n  // The user-facing remove action",
    );
    const cancel = section(
      booking,
      "  cancelAgreementPdfUpload:",
      "\n\n  create: producerProcedure",
    );

    for (const [source, storageBoundary] of [
      [prepare, "createPrivateAgreementPdfUpload"],
      [create, "finalizeAgreementPdfChange"],
      [update, "finalizeAgreementPdfChange"],
    ] as const) {
      const lock = source.indexOf("lockProducerCapabilityState");
      expect(lock).toBeGreaterThanOrEqual(0);
      expect(source).toContain("requireAgreementPdfProducerOpen");
      expect(source.indexOf(storageBoundary, lock)).toBeGreaterThan(lock);
    }
    expect(cancel).not.toContain("lockProducerCapabilityState");
  });

  it("blocks artwork issuance and replacement but permits exact completed replay", () => {
    const prepare = section(
      artwork,
      "export async function prepareProducerSongArtwork",
      "export async function completeProducerSongArtwork",
    );
    const complete = section(
      artwork,
      "export async function completeProducerSongArtwork",
      "export type AuthorizedSongArtwork",
    );

    expect(prepare.indexOf("lockProducerCapabilityState")).toBeLessThan(
      prepare.indexOf("storage.createUpload"),
    );
    const replay = complete.indexOf("current?.storageKey === finalKey");
    const open = complete.indexOf("requireSongArtworkProducerOpen", replay);
    const finalize = complete.indexOf("storage.finalizeUpload", open);
    expect(replay).toBeGreaterThanOrEqual(0);
    expect(open).toBeGreaterThan(replay);
    expect(finalize).toBeGreaterThan(open);
  });

  it("holds the Producer lock through first-version URL issuance and storage finalization", () => {
    for (const name of ["  stage:", "  prepare:"] as const) {
      const end = name === "  stage:" ? "\n\n  prepare:" : "\n\n  finalize:";
      const source = section(firstVersion, name, end);
      const presign = section(source, "presign: () =>", "compensate: async");
      const lock = presign.indexOf("lockProducerCapabilityState");
      const replay = presign.indexOf("if (lockedIntent.completedAt)", lock);
      const open = presign.indexOf("requireFirstVersionProducerOpen", replay);
      const issued = presign.indexOf("createFirstVersionUploadUrl", open);
      expect(lock).toBeGreaterThanOrEqual(0);
      expect(replay).toBeGreaterThan(lock);
      expect(open).toBeGreaterThan(replay);
      expect(issued).toBeGreaterThan(open);
    }

    for (const [name, end] of [
      ["  finalize:", "\n\n  complete:"],
      ["  complete:", "\n\n  cancel:"],
    ] as const) {
      const source = section(firstVersion, name, end);
      const completion = source.lastIndexOf("const completed = await ctx.db.transaction");
      const lock = source.indexOf("lockProducerCapabilityState", completion);
      const replay = source.indexOf("if (lockedIntent.completedAt)", lock);
      const open = source.indexOf("requireFirstVersionProducerOpen", replay);
      const finalize = source.indexOf("finalizeFirstVersionUpload", open);
      expect(completion).toBeGreaterThanOrEqual(0);
      expect(lock).toBeGreaterThan(completion);
      expect(replay).toBeGreaterThan(lock);
      expect(open).toBeGreaterThan(replay);
      expect(finalize).toBeGreaterThan(open);
    }
    expect(firstVersion.slice(firstVersion.indexOf("  cancel:"))).not.toContain(
      "lockProducerCapabilityState",
    );
  });

  it("holds the Producer lock through multipart create, part signing, and completion", () => {
    const createTransaction = multipart.slice(
      multipart.indexOf("const created = await ctx.db.transaction"),
      multipart.indexOf("const createdUploadId"),
    );
    expect(createTransaction.indexOf("lockProducerCapabilityState")).toBeLessThan(
      createTransaction.indexOf("new CreateMultipartUploadCommand"),
    );

    const authorize = section(
      multipart,
      "export async function authorizePendingMultipartPart",
      "async function discoverOwnedVersion",
    );
    expect(authorize.indexOf("lockProducerCapabilityState")).toBeLessThan(
      authorize.indexOf("return issue({ expiresAt, contentLength })"),
    );
    const signPart = section(audioRouter, "  signPart:", "\n\n  // Finalise");
    expect(signPart).toMatch(
      /authorizePendingMultipartPart\([\s\S]*getSignedUrl\([\s\S]*return \{ url \}[\s\S]*\);/,
    );

    const complete = section(audioRouter, "  completeMultipart:", "\n\n  // Persist");
    const firstReplay = complete.indexOf('decision === "already_attached"');
    const firstOpen = complete.indexOf("requireMultipartProducerOpen", firstReplay);
    const remoteCall = complete.indexOf("completeOrRecoverMultipart", firstOpen);
    const attach = complete.indexOf(".update(trackVersions)", remoteCall);
    expect(firstReplay).toBeGreaterThanOrEqual(0);
    expect(firstOpen).toBeGreaterThan(firstReplay);
    expect(remoteCall).toBeGreaterThan(firstOpen);
    expect(attach).toBeGreaterThan(remoteCall);

    const abort = audioRouter.slice(audioRouter.indexOf("  abortMultipart:"));
    expect(abort).not.toContain("lockProducerCapabilityState");
  });
});
