import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertSk102ConfinedLocalPathSync } from "../../src/server/operations/sk102-fixtures/local-state";

export const E2E_SLOTS = ["desktop", "phone390", "phone360"] as const;
export type E2ESlot = (typeof E2E_SLOTS)[number];

export type BrowserFixtureManifest = Readonly<{
  schemaVersion: 1;
  slot: E2ESlot;
  producer: Readonly<{
    studioName: string;
    uninvitedClientName: string;
    projectNames: readonly [string, string, string, ...string[]];
    projectSortOrders: Readonly<
      Record<
        "custom" | "recent" | "deadline" | "balance" | "progress" | "joined" | "name",
        readonly [string, string, string, ...string[]]
      >
    >;
    audioSongPath: string;
    audioSongName: string;
    audioVersionLabel: string;
    storeFirstName: string;
    storeSecondName: string;
    storeEditableName: string;
  }>;
  artist: Readonly<{
    studioAName: string;
    studioBName: string;
    studioBMarker: string;
    storeProductName: string;
  }>;
  payments: Readonly<{
    artistProofUploadPath: string;
    rejectedProofReplacementPath: string;
    pendingProofRejectPath: string;
    pendingProofConfirmPath: string;
    reminderButtonName: string;
  }>;
  booking: Readonly<{
    artistBookPath: string;
    producerPendingBookingPath: string;
    pendingArtistName: string;
  }>;
  files: Readonly<{
    audioPath: string;
    proofPath: string;
    replacementProofPath: string;
  }>;
}>;

const WEB_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const REPOSITORY_ROOT = path.resolve(WEB_ROOT, "../..");
export const GENERATED_ROOT = path.resolve(REPOSITORY_ROOT, ".skitza/e2e");

function fail(field: string): never {
  throw new Error(`Invalid isolated browser fixture manifest field: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) fail(field);
  return value;
}

function appPath(value: unknown, field: string): string {
  const result = text(value, field);
  if (!result.startsWith("/") || result.startsWith("//") || result.includes("\n")) fail(field);
  return result;
}

function confinedPath(root: string, candidate: string, field: string): string {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail(field);
  return candidate;
}

function fixtureFilePath(
  value: unknown,
  field: string,
  manifestPath: string,
  slot: E2ESlot,
  expectedName: string,
): string {
  const result = text(value, field);
  if (result.includes("\0")) fail(field);
  const resolved = path.isAbsolute(result)
    ? path.resolve(result)
    : path.resolve(REPOSITORY_ROOT, result);
  const assetRoot = path.resolve(path.dirname(manifestPath), `${slot}-assets`);
  confinedPath(assetRoot, resolved, field);
  assertSk102ConfinedLocalPathSync(REPOSITORY_ROOT, assetRoot);
  assertSk102ConfinedLocalPathSync(REPOSITORY_ROOT, resolved);
  if (
    path.basename(resolved) !== expectedName ||
    !existsSync(resolved) ||
    !lstatSync(resolved).isFile()
  ) {
    fail(field);
  }
  return resolved;
}

function stringList(value: unknown, field: string): readonly [string, string, string, ...string[]] {
  if (!Array.isArray(value) || value.length < 3) fail(field);
  const values = value.map((entry, index) => text(entry, `${field}[${String(index)}]`));
  const [first, second, third, ...rest] = values;
  if (!first || !second || !third) fail(field);
  return [first, second, third, ...rest];
}

function sortOrders(
  value: unknown,
  projectNames: readonly string[],
): BrowserFixtureManifest["producer"]["projectSortOrders"] {
  const source = record(value, "producer.projectSortOrders");
  const targetSet = new Set(projectNames);
  const order = (name: keyof BrowserFixtureManifest["producer"]["projectSortOrders"]) => {
    const result = stringList(source[name], `producer.projectSortOrders.${name}`);
    if (
      result.length !== targetSet.size ||
      new Set(result).size !== targetSet.size ||
      result.some((entry) => !targetSet.has(entry))
    ) {
      fail(`producer.projectSortOrders.${name}`);
    }
    return result;
  };
  return {
    custom: order("custom"),
    recent: order("recent"),
    deadline: order("deadline"),
    balance: order("balance"),
    progress: order("progress"),
    joined: order("joined"),
    name: order("name"),
  };
}

export function manifestPathForSlot(slot: E2ESlot): string {
  const template = process.env.SKITZA_E2E_MANIFEST;
  if (template) {
    const expanded = template.includes("{slot}") ? template.replaceAll("{slot}", slot) : template;
    const resolved = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(REPOSITORY_ROOT, expanded);
    confinedPath(GENERATED_ROOT, resolved, "manifest path");
    if (path.basename(resolved) !== `${slot}.json`) fail("manifest path");
    return resolved;
  }
  const directory = process.env.SKITZA_E2E_MANIFEST_DIR
    ? path.resolve(REPOSITORY_ROOT, process.env.SKITZA_E2E_MANIFEST_DIR)
    : GENERATED_ROOT;
  const resolved = path.resolve(directory, `${slot}.json`);
  confinedPath(GENERATED_ROOT, resolved, "manifest path");
  return resolved;
}

export function readBrowserFixtureManifest(slot: E2ESlot): BrowserFixtureManifest {
  const manifestPath = manifestPathForSlot(slot);
  assertSk102ConfinedLocalPathSync(REPOSITORY_ROOT, GENERATED_ROOT);
  assertSk102ConfinedLocalPathSync(REPOSITORY_ROOT, manifestPath);
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing isolated browser fixture manifest for slot ${slot}.`);
  }
  if (!lstatSync(manifestPath).isFile()) fail("manifest path");

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error(`Could not parse isolated browser fixture manifest for slot ${slot}.`);
  }

  const root = record(raw, "root");
  if (root.schemaVersion !== 1) fail("schemaVersion");
  if (root.slot !== slot) fail("slot");
  const producer = record(root.producer, "producer");
  const artist = record(root.artist, "artist");
  const payments = record(root.payments, "payments");
  const booking = record(root.booking, "booking");
  const files = record(root.files, "files");
  const projectNames = stringList(producer.projectNames, "producer.projectNames");

  return {
    schemaVersion: 1,
    slot,
    producer: {
      studioName: text(producer.studioName, "producer.studioName"),
      uninvitedClientName: text(producer.uninvitedClientName, "producer.uninvitedClientName"),
      projectNames,
      projectSortOrders: sortOrders(producer.projectSortOrders, projectNames),
      audioSongPath: appPath(producer.audioSongPath, "producer.audioSongPath"),
      audioSongName: text(producer.audioSongName, "producer.audioSongName"),
      audioVersionLabel: text(producer.audioVersionLabel, "producer.audioVersionLabel"),
      storeFirstName: text(producer.storeFirstName, "producer.storeFirstName"),
      storeSecondName: text(producer.storeSecondName, "producer.storeSecondName"),
      storeEditableName: text(producer.storeEditableName, "producer.storeEditableName"),
    },
    artist: {
      studioAName: text(artist.studioAName, "artist.studioAName"),
      studioBName: text(artist.studioBName, "artist.studioBName"),
      studioBMarker: text(artist.studioBMarker, "artist.studioBMarker"),
      storeProductName: text(artist.storeProductName, "artist.storeProductName"),
    },
    payments: {
      artistProofUploadPath: appPath(
        payments.artistProofUploadPath,
        "payments.artistProofUploadPath",
      ),
      rejectedProofReplacementPath: appPath(
        payments.rejectedProofReplacementPath,
        "payments.rejectedProofReplacementPath",
      ),
      pendingProofRejectPath: appPath(
        payments.pendingProofRejectPath,
        "payments.pendingProofRejectPath",
      ),
      pendingProofConfirmPath: appPath(
        payments.pendingProofConfirmPath,
        "payments.pendingProofConfirmPath",
      ),
      reminderButtonName: text(payments.reminderButtonName, "payments.reminderButtonName"),
    },
    booking: {
      artistBookPath: appPath(booking.artistBookPath, "booking.artistBookPath"),
      producerPendingBookingPath: appPath(
        booking.producerPendingBookingPath,
        "booking.producerPendingBookingPath",
      ),
      pendingArtistName: text(booking.pendingArtistName, "booking.pendingArtistName"),
    },
    files: {
      audioPath: fixtureFilePath(
        files.audioPath,
        "files.audioPath",
        manifestPath,
        slot,
        "fixture-audio.wav",
      ),
      proofPath: fixtureFilePath(
        files.proofPath,
        "files.proofPath",
        manifestPath,
        slot,
        "fixture-proof.png",
      ),
      replacementProofPath: fixtureFilePath(
        files.replacementProofPath,
        "files.replacementProofPath",
        manifestPath,
        slot,
        "fixture-replacement-proof.png",
      ),
    },
  };
}

export function slotFromProjectMetadata(metadata: Readonly<Record<string, unknown>>): E2ESlot {
  const slot = metadata.e2eSlot;
  if (typeof slot === "string" && E2E_SLOTS.includes(slot as E2ESlot)) return slot as E2ESlot;
  throw new Error("Playwright project is missing a valid e2eSlot metadata value.");
}
