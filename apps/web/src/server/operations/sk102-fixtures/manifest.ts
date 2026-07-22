import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { sk102FixturePng, sk102FixtureWav } from "./assets";
import {
  resolveSk102GeneratedPath,
  SK102_FIXTURE_NAMES,
  SK102_PROJECT_SORT_ORDERS,
  type Sk102FixtureSlot,
} from "./contract";
import { assertSk102ConfinedLocalPath, prepareSk102ConfinedDirectory } from "./local-state";

// Kept structurally identical to e2e/support/manifest.ts without importing
// Playwright-owned code into the server-only fixture command.
export type Sk102FixtureManifest = Readonly<{
  schemaVersion: 1;
  slot: Sk102FixtureSlot;
  producer: {
    studioName: string;
    uninvitedClientName: string;
    projectNames: readonly [string, string, string, ...string[]];
    projectSortOrders: typeof SK102_PROJECT_SORT_ORDERS;
    audioSongPath: string;
    audioSongName: string;
    audioVersionLabel: string;
    storeFirstName: string;
    storeSecondName: string;
    storeEditableName: string;
  };
  artist: {
    studioAName: string;
    studioBName: string;
    studioBMarker: string;
    storeProductName: string;
  };
  payments: {
    artistProofUploadPath: string;
    rejectedProofReplacementPath: string;
    pendingProofRejectPath: string;
    pendingProofConfirmPath: string;
    reminderButtonName: string;
  };
  booking: {
    artistBookPath: string;
    producerPendingBookingPath: string;
    pendingArtistName: string;
  };
  files: { audioPath: string; proofPath: string; replacementProofPath: string };
}>;

export type Sk102ManifestRows = Readonly<{
  producerId: string;
  audioVersionId: string;
  pendingProofConfirmId: string;
  pendingProofRejectId: string;
  artistProofPurchaseId: string;
  rejectedProofPurchaseId: string;
  pendingBookingId: string;
  reminderButtonName: string;
}>;

export function buildSk102FixtureManifest(
  slot: Sk102FixtureSlot,
  rows: Sk102ManifestRows,
  files: { audioPath: string; proofPath: string; replacementProofPath: string },
): Sk102FixtureManifest {
  const studio = `studio=${encodeURIComponent(rows.producerId)}`;
  return Object.freeze({
    schemaVersion: 1,
    slot,
    producer: {
      studioName: SK102_FIXTURE_NAMES.studioA,
      uninvitedClientName: SK102_FIXTURE_NAMES.uninvitedClient,
      projectNames: SK102_PROJECT_SORT_ORDERS.custom,
      projectSortOrders: SK102_PROJECT_SORT_ORDERS,
      audioSongPath: `/dashboard/music/${encodeURIComponent(rows.audioVersionId)}`,
      audioSongName: SK102_FIXTURE_NAMES.audioSong,
      audioVersionLabel: `SK-102 ${slot} upload`,
      storeFirstName: SK102_FIXTURE_NAMES.products[0],
      storeSecondName: SK102_FIXTURE_NAMES.products[1],
      storeEditableName: SK102_FIXTURE_NAMES.products[1],
    },
    artist: {
      studioAName: SK102_FIXTURE_NAMES.studioA,
      studioBName: SK102_FIXTURE_NAMES.studioB,
      studioBMarker: "Fixture Studio B Product",
      storeProductName: SK102_FIXTURE_NAMES.products[0],
    },
    payments: {
      artistProofUploadPath: `/artist/payments/${encodeURIComponent(rows.artistProofPurchaseId)}/proof?${studio}`,
      rejectedProofReplacementPath: `/artist/payments/${encodeURIComponent(rows.rejectedProofPurchaseId)}/proof?${studio}`,
      pendingProofRejectPath: `/dashboard/payments/${encodeURIComponent(rows.pendingProofRejectId)}`,
      pendingProofConfirmPath: `/dashboard/payments/${encodeURIComponent(rows.pendingProofConfirmId)}`,
      reminderButtonName: rows.reminderButtonName,
    },
    booking: {
      artistBookPath: `/artist/book?${studio}`,
      producerPendingBookingPath: `/dashboard/calendar?booking=${encodeURIComponent(rows.pendingBookingId)}`,
      pendingArtistName: SK102_FIXTURE_NAMES.artist,
    },
    files: { ...files },
  });
}

function assertSanitizedManifest(manifest: Sk102FixtureManifest): void {
  const serialized = JSON.stringify(manifest);
  if (
    /(?:clerk|secret|password|token|storageKey|databaseUrl|@)/i.test(serialized) ||
    serialized.includes("proof-evidence/") ||
    serialized.includes("producers/")
  ) {
    throw new Error("SK102_FIXTURE_MANIFEST_SENSITIVE");
  }
}

export async function writeSk102FixtureManifest(
  cwd: string,
  requestedPath: string,
  manifest: Sk102FixtureManifest,
): Promise<string> {
  assertSanitizedManifest(manifest);
  const target = resolveSk102GeneratedPath(cwd, requestedPath);
  const assetDirectory = resolve(dirname(target), `${manifest.slot}-assets`);
  await prepareSk102ConfinedDirectory(cwd, assetDirectory);

  const audioPath = resolve(assetDirectory, "fixture-audio.wav");
  const proofPath = resolve(assetDirectory, "fixture-proof.png");
  const replacementProofPath = resolve(assetDirectory, "fixture-replacement-proof.png");
  await Promise.all(
    [audioPath, proofPath, replacementProofPath].map((path) =>
      assertSk102ConfinedLocalPath(cwd, path),
    ),
  );
  await writeFile(audioPath, sk102FixtureWav(), { mode: 0o600 });
  await writeFile(proofPath, sk102FixturePng(), { mode: 0o600 });
  await writeFile(replacementProofPath, sk102FixturePng(), { mode: 0o600 });
  await Promise.all(
    [audioPath, proofPath, replacementProofPath].map((path) =>
      assertSk102ConfinedLocalPath(cwd, path),
    ),
  );

  const materialized: Sk102FixtureManifest = {
    ...manifest,
    files: {
      audioPath: relative(cwd, audioPath),
      proofPath: relative(cwd, proofPath),
      replacementProofPath: relative(cwd, replacementProofPath),
    },
  };
  assertSanitizedManifest(materialized);
  await prepareSk102ConfinedDirectory(cwd, dirname(target));
  const temporary = `${target}.tmp`;
  await Promise.all([
    assertSk102ConfinedLocalPath(cwd, target),
    assertSk102ConfinedLocalPath(cwd, temporary),
  ]);
  await writeFile(temporary, `${JSON.stringify(materialized, null, 2)}\n`, { mode: 0o600 });
  await assertSk102ConfinedLocalPath(cwd, temporary);
  await rename(temporary, target);
  await assertSk102ConfinedLocalPath(cwd, target);
  return target;
}

export async function removeSk102GeneratedFiles(
  cwd: string,
  requestedPath: string,
  expectedSlot?: Sk102FixtureSlot,
): Promise<void> {
  const target = resolveSk102GeneratedPath(cwd, requestedPath);
  const slot = expectedSlot ?? target.match(/(?:^|\/)(desktop|phone390|phone360)[.]json$/)?.[1];
  await assertSk102ConfinedLocalPath(cwd, target);
  await rm(target, { force: true });
  await assertSk102ConfinedLocalPath(cwd, `${target}.tmp`);
  await rm(`${target}.tmp`, { force: true });
  if (slot) {
    const assetDirectory = resolve(dirname(target), `${slot}-assets`);
    await assertSk102ConfinedLocalPath(cwd, assetDirectory);
    await rm(assetDirectory, { recursive: true, force: true });
  }
}
