import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { protectValue, sha256Digest } from "./canonical";
import { Sk90ResetSafetyError } from "./errors";
import {
  assertPrivateExecutionEnvelope,
  bindPrivateExecutionEnvelope,
  readPrivateExecutionEnvelope,
  recomputePrivateEnvelopeTokens,
  writePrivateExecutionEnvelope,
} from "./private-envelope";

const HMAC_KEY = "private-envelope-test-key-that-is-long-enough";
const directories: string[] = [];

async function privateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sk90-envelope-"));
  directories.push(directory);
  return directory;
}

function envelope() {
  const providerReferences = Array.from({ length: 7 }, (_, index) => {
    const stripe = index < 3;
    return {
      sourceKind: stripe
        ? ("producer_stripe_account" as const)
        : ("booking_tranzila_confirmation" as const),
      ownerId: `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
      providerValue: `test-provider-${index.toString()}`,
      provider: stripe ? ("stripe" as const) : ("tranzila" as const),
      mode: "test" as const,
      attested: true as const,
      chargeEnabled: false as const,
      externalCharge: false as const,
      liveSchedule: false as const,
    };
  });
  return bindPrivateExecutionEnvelope(
    {
      artifactDigest: sha256Digest("artifact"),
      manifestDigest: sha256Digest("manifest"),
      targetPolicyDigest: sha256Digest("policy"),
      rows: [
        {
          category: "projects",
          table: "projects",
          id: "raw-row-id",
          payload: { status: "mock", total: 0 },
        },
      ],
      storageReferences: [
        {
          bucketRole: "audio",
          key: "raw/private/object-key",
          referencedBy: "reset",
        },
      ],
      storageObjects: [
        {
          bucketRole: "audio",
          key: "raw/private/object-key",
          ownership: "reset_exclusive",
          sizeBytes: 123,
          contentFingerprint: sha256Digest("object-bytes"),
          metadataFingerprint: sha256Digest("object-metadata"),
        },
      ],
      providerReferences,
    },
    HMAC_KEY,
  );
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("SK-90 private execution envelope", () => {
  it("recomputes the exact manifest row and storage token domains", () => {
    const tokens = recomputePrivateEnvelopeTokens(envelope(), HMAC_KEY);
    expect(tokens.rows).toEqual([
      {
        category: "projects",
        table: "projects",
        protectedId: protectValue(HMAC_KEY, "row-id\0projects\0raw-row-id"),
        protectedContent: protectValue(
          HMAC_KEY,
          'row-content\0projects\0{"status":"mock","total":0}',
        ),
      },
    ]);
    expect(tokens.storageReferences).toEqual([
      {
        bucketRole: "audio",
        protectedKey: protectValue(HMAC_KEY, "storage-key\0audio\0raw/private/object-key"),
        referencedBy: "reset",
      },
    ]);
    expect(tokens.storageObjects).toEqual([
      {
        bucketRole: "audio",
        protectedKey: protectValue(HMAC_KEY, "storage-key\0audio\0raw/private/object-key"),
        ownership: "reset_exclusive",
        sizeBytes: 123,
        contentFingerprint: sha256Digest("object-bytes"),
        metadataFingerprint: sha256Digest("object-metadata"),
      },
    ]);
    expect(tokens.providerReferences).toHaveLength(7);
    expect(tokens.providerReferences).toContainEqual({
      token: protectValue(
        HMAC_KEY,
        [
          "provider-reference",
          "producer_stripe_account",
          "00000000-0000-4000-8000-000000000001",
          "test-provider-0",
        ].join("\0"),
      ),
      provider: "stripe",
      mode: "test",
      attested: true,
      chargeEnabled: false,
      externalCharge: false,
      liveSchedule: false,
    });
  });

  it("binds raw rows and keys to exact artifact, manifest, and policy digests", () => {
    const exact = envelope();
    expect(
      assertPrivateExecutionEnvelope(exact, HMAC_KEY, {
        artifactDigest: exact.artifactDigest,
        manifestDigest: exact.manifestDigest,
        targetPolicyDigest: exact.targetPolicyDigest,
      }),
    ).toEqual(exact);

    const firstRow = exact.rows[0];
    if (!firstRow) throw new Error("test fixture requires one row");
    expect(() =>
      assertPrivateExecutionEnvelope(
        { ...exact, rows: [{ ...firstRow, id: "substituted" }] },
        HMAC_KEY,
      ),
    ).toThrow(expect.objectContaining({ code: "ARTIFACT_BINDING_MISMATCH" }));
    expect(() =>
      assertPrivateExecutionEnvelope(exact, HMAC_KEY, {
        artifactDigest: exact.artifactDigest,
        manifestDigest: sha256Digest("other-manifest"),
        targetPolicyDigest: exact.targetPolicyDigest,
      }),
    ).toThrow(expect.objectContaining({ code: "ARTIFACT_BINDING_MISMATCH" }));
  });

  it("atomically persists and replaces only an owner-only regular file", async () => {
    const directory = await privateDirectory();
    const path = join(directory, "private-envelope.json");
    const exact = envelope();
    await writePrivateExecutionEnvelope(path, exact, HMAC_KEY);
    expect(await readPrivateExecutionEnvelope(path, HMAC_KEY)).toEqual(exact);

    const replacement = bindPrivateExecutionEnvelope(
      { ...exact, manifestDigest: sha256Digest("replacement-manifest") },
      HMAC_KEY,
    );
    await writePrivateExecutionEnvelope(path, replacement, HMAC_KEY);
    expect(await readPrivateExecutionEnvelope(path, HMAC_KEY)).toEqual(replacement);

    await chmod(path, 0o644);
    await expect(readPrivateExecutionEnvelope(path, HMAC_KEY)).rejects.toMatchObject({
      code: "PHASE_STATE_INVALID",
    } satisfies Partial<Sk90ResetSafetyError>);
  });

  it("refuses a symlink without reading or replacing its target", async () => {
    const directory = await privateDirectory();
    const target = join(directory, "target.json");
    const linked = join(directory, "private-envelope.json");
    await writeFile(target, "do-not-touch", { mode: 0o600 });
    await symlink(target, linked);

    await expect(readPrivateExecutionEnvelope(linked, HMAC_KEY)).rejects.toMatchObject({
      code: "PHASE_STATE_INVALID",
    });
    await expect(writePrivateExecutionEnvelope(linked, envelope(), HMAC_KEY)).rejects.toMatchObject(
      { code: "PHASE_STATE_INVALID" },
    );
  });
});
