import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@skitza/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sk102FixturePng, sk102FixtureWav } from "./assets";
import { parseSk102FixtureArguments } from "./cli-contract";
import {
  SK102_APPLICATION_TABLES,
  SK102_FIXTURE_COVERAGE,
  SK102_PROJECT_SORT_ORDERS,
  SK102_REPOSITORY_ROOT,
  resolveSk102GeneratedPath,
  sk102FixtureUuid,
  sk102SinkEmail,
  validateSk102FixtureIdentity,
} from "./contract";
import {
  SK102_EXPECTED_MIGRATION_LEDGER,
  assertSk102FixtureSchema,
  assertSk102MigrationLedger,
  sk102EmptyReadbackStatement,
  sk102ProjectPosition,
  sk102SeedObjectPlan,
  sk102TruncateStatement,
} from "./database";
import {
  buildSk102FixtureManifest,
  removeSk102GeneratedFiles,
  writeSk102FixtureManifest,
} from "./manifest";
import {
  assertSk102ConfinedLocalPath,
  assertSk102ConfinedLocalPathSync,
  removeSk102AuthState,
  removeSk102BrowserEvidence,
  sk102AuthStateDirectory,
  sk102BrowserEvidenceDirectory,
} from "./local-state";
import { runSk102CleanupSteps, validateSk102BrowserRunLeaseToken } from "./workflow";

const temporaryDirectories: string[] = [];
const migrationDirectory = fileURLToPath(
  new URL("../../../../../../packages/db/drizzle/", import.meta.url),
);

function schemaDb(ledger: readonly { filename: string; digest: string }[]): Db {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          applicationTableCount: SK102_APPLICATION_TABLES.length,
          approvedApplicationTableCount: SK102_APPLICATION_TABLES.length,
          triggerCount: 5,
          legacyTableCount: 0,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: ledger });
  return { execute } as unknown as Db;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("SK-102 fixture contract", () => {
  it("creates stable logical ids while keeping viewport slots isolated", () => {
    expect(sk102FixtureUuid("desktop", "producer.a")).toBe(
      sk102FixtureUuid("desktop", "producer.a"),
    );
    expect(sk102FixtureUuid("desktop", "producer.a")).not.toBe(
      sk102FixtureUuid("phone390", "producer.a"),
    );
    expect(() => sk102FixtureUuid("desktop", "../escape")).toThrow("SK102_FIXTURE_ALIAS_INVALID");
  });

  it("accepts only opaque v4 browser-run lease tokens", () => {
    expect(validateSk102BrowserRunLeaseToken("123e4567-e89b-42d3-a456-426614174000")).toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    for (const value of [undefined, "", "not-a-token", "123e4567-e89b-12d3-a456-426614174000"]) {
      expect(() => validateSk102BrowserRunLeaseToken(value)).toThrow(
        "SK102_BROWSER_RUN_LEASE_INVALID",
      );
    }
  });

  it("requires separate Clerk users and sink-scoped addresses", () => {
    expect(
      validateSk102FixtureIdentity({
        producerClerkUserId: "user_producer_fixture",
        artistClerkUserId: "user_artist_fixture",
        producerEmail: "producer+clerk_test@example.com",
        artistEmail: "artist+clerk_test@example.com",
        sinkEmailDomain: "example.com",
      }),
    ).toMatchObject({ producerEmail: "producer+clerk_test@example.com" });
    expect(() =>
      validateSk102FixtureIdentity({
        producerClerkUserId: "same-user",
        artistClerkUserId: "same-user",
        producerEmail: "producer@example.com",
        artistEmail: "artist@example.com",
        sinkEmailDomain: "example.com",
      }),
    ).toThrow("SK102_FIXTURE_CLERK_IDENTITY_INVALID");
    expect(sk102SinkEmail("invite+clerk_test_desktop", "example.com")).toBe(
      "invite+clerk_test_desktop@example.com",
    );
  });

  it("rejects ordinary sink addresses before fixture mutation", () => {
    const valid = {
      producerClerkUserId: "user_producer_fixture",
      artistClerkUserId: "user_artist_fixture",
      producerEmail: "producer+clerk_test@example.com",
      artistEmail: "artist+clerk_test@example.com",
      sinkEmailDomain: "example.com",
    };
    expect(() => {
      validateSk102FixtureIdentity({ ...valid, producerEmail: "producer@example.com" });
    }).toThrow("SK102_FIXTURE_CLERK_TEST_EMAIL_REQUIRED");
    expect(() => {
      validateSk102FixtureIdentity({ ...valid, artistEmail: "artist@example.com" });
    }).toThrow("SK102_FIXTURE_CLERK_TEST_EMAIL_REQUIRED");
  });

  it("rejects identical normalized fixture emails before mutation", () => {
    expect(() => {
      validateSk102FixtureIdentity({
        producerClerkUserId: "user_producer_fixture",
        artistClerkUserId: "user_artist_fixture",
        producerEmail: "fixture+clerk_test@example.com",
        artistEmail: " FIXTURE+CLERK_TEST@EXAMPLE.COM ",
        sinkEmailDomain: "example.com",
      });
    }).toThrow("SK102_FIXTURE_EMAIL_IDENTITY_INVALID");
  });

  it("pins cleanup to the complete 33-table application inventory", () => {
    expect(SK102_APPLICATION_TABLES).toHaveLength(33);
    expect(new Set(SK102_APPLICATION_TABLES).size).toBe(SK102_APPLICATION_TABLES.length);
    const statement = sk102TruncateStatement();
    for (const table of SK102_APPLICATION_TABLES) {
      expect(statement).toContain(`public."${table}"`);
    }
    expect(statement).toContain("RESTART IDENTITY");
    expect(statement).not.toMatch(/CASCADE|DELETE|skitza_migrations/iu);
  });

  it("pins the complete migration ledger to the exact current SQL digests", async () => {
    expect(SK102_EXPECTED_MIGRATION_LEDGER.map(({ filename }) => filename)).toEqual([
      "0027_purchase_foundation.sql",
      "0028_stable_client_ownership.sql",
      "0029_private_offer_recipient_identity.sql",
      "0030_song_release_state.sql",
      "0031_purchase_ledger_runtime.sql",
      "0032_purchase_session_allowance.sql",
      "0033_purchase_version_download_overrides.sql",
      "0034_song_public_access.sql",
    ]);
    const observed = await Promise.all(
      SK102_EXPECTED_MIGRATION_LEDGER.map(async ({ filename }) => ({
        filename,
        digest: createHash("sha256")
          .update(await readFile(resolve(migrationDirectory, filename)))
          .digest("hex"),
      })),
    );
    expect(observed).toEqual(SK102_EXPECTED_MIGRATION_LEDGER);
    expect(() => {
      assertSk102MigrationLedger(observed);
    }).not.toThrow();
    await expect(assertSk102FixtureSchema(schemaDb(observed))).resolves.toBeUndefined();
  });

  it("rejects missing, extra, or digest-mismatched migration ledger rows", async () => {
    const expected = SK102_EXPECTED_MIGRATION_LEDGER;
    const invalidLedgers = [
      expected.slice(0, -1),
      [...expected, { filename: "0035_unapproved.sql", digest: "0".repeat(64) }],
      expected.map((entry, index) => (index === 3 ? { ...entry, digest: "f".repeat(64) } : entry)),
    ];
    for (const ledger of invalidLedgers) {
      expect(() => {
        assertSk102MigrationLedger(ledger);
      }).toThrow("SK102_FIXTURE_SCHEMA_MISMATCH");
      await expect(assertSk102FixtureSchema(schemaDb(ledger))).rejects.toThrow(
        "SK102_FIXTURE_SCHEMA_MISMATCH",
      );
    }
  });

  it("proves every approved application table is empty after cleanup", () => {
    const statement = sk102EmptyReadbackStatement();
    for (const table of SK102_APPLICATION_TABLES) {
      expect(statement).toContain(`public."${table}"`);
    }
    expect(statement.match(/SELECT EXISTS/gu)).toHaveLength(SK102_APPLICATION_TABLES.length);
    expect(statement).toContain('WHERE "hasRows"');
    expect(statement).not.toMatch(/CASCADE|DELETE|TRUNCATE|skitza_migrations/iu);
  });

  it("keeps the three reorder fixtures contiguous ahead of other studio A projects", () => {
    expect([
      sk102ProjectPosition("audio", 0),
      sk102ProjectPosition("due", 1),
      sk102ProjectPosition("upcoming", 2),
    ]).toEqual([0, 10, 20]);
    expect(sk102ProjectPosition("proof-confirm", 3)).toBeGreaterThan(20);
    expect(sk102ProjectPosition("studioB", 12)).toBe(0);
    expect(SK102_PROJECT_SORT_ORDERS.custom).not.toEqual(SK102_PROJECT_SORT_ORDERS.name);
    expect(SK102_PROJECT_SORT_ORDERS.recent).not.toEqual(SK102_PROJECT_SORT_ORDERS.deadline);
    expect(SK102_PROJECT_SORT_ORDERS.progress[0]).toBe("Fixture Project 0");
    expect(SK102_PROJECT_SORT_ORDERS).toEqual({
      custom: ["Fixture Project A", "Fixture Project B", "Fixture Project C", "Fixture Project 0"],
      recent: ["Fixture Project 0", "Fixture Project C", "Fixture Project A", "Fixture Project B"],
      deadline: [
        "Fixture Project A",
        "Fixture Project B",
        "Fixture Project C",
        "Fixture Project 0",
      ],
      balance: ["Fixture Project A", "Fixture Project B", "Fixture Project C", "Fixture Project 0"],
      progress: [
        "Fixture Project 0",
        "Fixture Project A",
        "Fixture Project B",
        "Fixture Project C",
      ],
      joined: ["Fixture Project 0", "Fixture Project C", "Fixture Project B", "Fixture Project A"],
      name: ["Fixture Project 0", "Fixture Project A", "Fixture Project B", "Fixture Project C"],
    });
  });

  it("declares every lifecycle and browser action required by SK-102", () => {
    expect(SK102_FIXTURE_COVERAGE.projectLifecycle).toEqual([
      "waiting_for_payment",
      "active",
      "paused",
      "completed",
      "canceled",
    ]);
    expect(SK102_FIXTURE_COVERAGE.privateOfferLifecycle).toHaveLength(6);
    expect(SK102_FIXTURE_COVERAGE.bookingLifecycle).toHaveLength(6);
    expect(SK102_FIXTURE_COVERAGE.browserActions).toContain("multi_studio");
    expect(SK102_FIXTURE_COVERAGE.browserActions).toContain("payment_proofs");
  });

  it("creates valid isolated audio and opaque proof object plans", () => {
    const plan = sk102SeedObjectPlan(
      "desktop",
      sk102FixtureUuid("desktop", "producer.a"),
      sk102FixtureUuid("desktop", "producer.b"),
    );
    expect(plan.map((object) => object.alias)).toEqual([
      "audio",
      "secondaryAudio",
      "pendingProofConfirm",
      "pendingProofReject",
      "rejectedProof",
      "confirmedProof",
    ]);
    expect(plan.filter((object) => object.bucket === "docs")).toHaveLength(4);
    expect(
      plan
        .filter((object) => object.bucket === "docs")
        .every((object) => /^proof-evidence\/[0-9a-f]{64}$/u.test(object.key)),
    ).toBe(true);
  });

  it("parses only the bounded slot and manifest flags", () => {
    expect(parseSk102FixtureArguments(["--slot", "phone360"])).toEqual({
      slot: "phone360",
      manifestPath: ".skitza/e2e/phone360.json",
    });
    expect(
      parseSk102FixtureArguments(["--slot", "desktop", "--manifest", ".skitza/e2e/custom.json"]),
    ).toMatchObject({ slot: "desktop", manifestPath: ".skitza/e2e/custom.json" });
    expect(() => parseSk102FixtureArguments(["--slot", "tablet"])).toThrow(
      "SK102_FIXTURE_SLOT_INVALID",
    );
    expect(() => parseSk102FixtureArguments(["--slot", "desktop", "--slot", "phone390"])).toThrow(
      "SK102_FIXTURE_ARGUMENT_INVALID",
    );
  });
});

describe("SK-102 generated browser assets", () => {
  it("uses a valid PCM WAV and PNG signature", () => {
    const wav = Buffer.from(sk102FixtureWav());
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(Buffer.from(sk102FixturePng()).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("writes a browser-compatible manifest without provider identities or object keys", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "sk102-fixture-test-"));
    temporaryDirectories.push(cwd);
    const requested = ".skitza/e2e/desktop.json";
    const manifest = buildSk102FixtureManifest(
      "desktop",
      {
        producerId: sk102FixtureUuid("desktop", "producer.a"),
        audioVersionId: sk102FixtureUuid("desktop", "audio.version.final"),
        pendingProofConfirmId: sk102FixtureUuid("desktop", "proof.pending-confirm"),
        pendingProofRejectId: sk102FixtureUuid("desktop", "proof.pending-reject"),
        artistProofPurchaseId: sk102FixtureUuid("desktop", "purchase.artist-upload"),
        rejectedProofPurchaseId: sk102FixtureUuid("desktop", "purchase.rejected"),
        pendingBookingId: sk102FixtureUuid("desktop", "booking.pending"),
        reminderButtonName:
          "Send payment reminder for purchase SK102-DUE-MONTHLY, installment 2: Monthly payment 2",
      },
      { audioPath: "generated", proofPath: "generated", replacementProofPath: "generated" },
    );
    const target = await writeSk102FixtureManifest(cwd, requested, manifest);
    const source = await readFile(target, "utf8");
    expect(JSON.parse(source)).toMatchObject({ schemaVersion: 1, slot: "desktop" });
    expect(JSON.parse(source)).toMatchObject({
      producer: {
        audioVersionLabel: "SK-102 desktop upload",
        projectNames: SK102_PROJECT_SORT_ORDERS.custom,
        projectSortOrders: SK102_PROJECT_SORT_ORDERS,
      },
    });
    expect(source).not.toMatch(/@|proof-evidence\/|producers\/|clerk|secret|token/iu);
    const written = JSON.parse(source) as { files: Record<string, string> };
    for (const path of Object.values(written.files)) {
      expect((await stat(join(cwd, path))).size).toBeGreaterThan(0);
    }
    await writeFile(`${target}.tmp`, "interrupted sanitized write");
    await removeSk102GeneratedFiles(cwd, requested);
    await expect(stat(target)).rejects.toThrow();
    await expect(stat(`${target}.tmp`)).rejects.toThrow();
  });

  it("rejects generated paths outside the ignored directory", () => {
    expect(() => resolveSk102GeneratedPath("/fixture", "../outside.json")).toThrow(
      "SK102_FIXTURE_PATH_INVALID",
    );
    expect(() => resolveSk102GeneratedPath("/fixture", ".skitza/e2e")).toThrow(
      "SK102_FIXTURE_PATH_INVALID",
    );
  });

  it("uses the repository root for the browser manifest contract", () => {
    const expected = resolve(SK102_REPOSITORY_ROOT, ".skitza/e2e/desktop.json");
    expect(resolveSk102GeneratedPath(SK102_REPOSITORY_ROOT, expected)).toBe(expected);
  });

  it("rejects every existing symlink component while allowing a safe missing tail", async () => {
    const root = await mkdtemp(join(tmpdir(), "sk102-local-path-test-"));
    const outside = await mkdtemp(join(tmpdir(), "sk102-local-path-outside-"));
    temporaryDirectories.push(root, outside);
    const safe = resolve(root, ".skitza/e2e/desktop.json");
    await expect(assertSk102ConfinedLocalPath(root, safe)).resolves.toBe(safe);
    expect(assertSk102ConfinedLocalPathSync(root, safe)).toBe(safe);

    await mkdir(resolve(root, ".skitza"), { recursive: true });
    await symlink(outside, resolve(root, ".skitza/e2e"));
    await expect(assertSk102ConfinedLocalPath(root, safe)).rejects.toThrow(
      "SK102_LOCAL_PATH_UNSAFE",
    );
    expect(() => assertSk102ConfinedLocalPathSync(root, safe)).toThrow("SK102_LOCAL_PATH_UNSAFE");
  });

  it("does not write or delete generated fixture files through a parent symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "sk102-generated-symlink-test-"));
    const outside = await mkdtemp(join(tmpdir(), "sk102-generated-symlink-outside-"));
    temporaryDirectories.push(root, outside);
    await mkdir(resolve(root, ".skitza"), { recursive: true });
    await mkdir(resolve(outside, "desktop-assets"), { recursive: true });
    await writeFile(resolve(outside, "desktop.json"), "outside manifest");
    await writeFile(resolve(outside, "desktop.json.tmp"), "outside temporary");
    await writeFile(resolve(outside, "desktop-assets/keep.txt"), "keep");
    await symlink(outside, resolve(root, ".skitza/e2e"));

    const manifest = buildSk102FixtureManifest(
      "desktop",
      {
        producerId: sk102FixtureUuid("desktop", "producer.a"),
        audioVersionId: sk102FixtureUuid("desktop", "audio.version.final"),
        pendingProofConfirmId: sk102FixtureUuid("desktop", "proof.pending-confirm"),
        pendingProofRejectId: sk102FixtureUuid("desktop", "proof.pending-reject"),
        artistProofPurchaseId: sk102FixtureUuid("desktop", "purchase.artist-upload"),
        rejectedProofPurchaseId: sk102FixtureUuid("desktop", "purchase.rejected"),
        pendingBookingId: sk102FixtureUuid("desktop", "booking.pending"),
        reminderButtonName: "Send payment reminder for isolated fixture",
      },
      { audioPath: "generated", proofPath: "generated", replacementProofPath: "generated" },
    );
    await expect(
      writeSk102FixtureManifest(root, ".skitza/e2e/desktop.json", manifest),
    ).rejects.toThrow("SK102_LOCAL_PATH_UNSAFE");
    await expect(
      removeSk102GeneratedFiles(root, ".skitza/e2e/desktop.json", "desktop"),
    ).rejects.toThrow("SK102_LOCAL_PATH_UNSAFE");
    await expect(readFile(resolve(outside, "desktop.json"), "utf8")).resolves.toBe(
      "outside manifest",
    );
    await expect(readFile(resolve(outside, "desktop.json.tmp"), "utf8")).resolves.toBe(
      "outside temporary",
    );
    await expect(readFile(resolve(outside, "desktop-assets/keep.txt"), "utf8")).resolves.toBe(
      "keep",
    );
  });

  it("removes only the confined browser auth directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sk102-auth-cleanup-test-"));
    temporaryDirectories.push(root);
    const authDirectory = sk102AuthStateDirectory(root);
    const sibling = resolve(root, "apps/web/playwright/keep.txt");
    await mkdir(authDirectory, { recursive: true });
    await writeFile(resolve(authDirectory, "producer.json"), "private auth state");
    await writeFile(sibling, "keep");

    await removeSk102AuthState(root);

    await expect(stat(authDirectory)).rejects.toThrow();
    await expect(readFile(sibling, "utf8")).resolves.toBe("keep");
  });

  it("does not remove auth or evidence through a parent or leaf symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "sk102-local-cleanup-test-"));
    const outside = await mkdtemp(join(tmpdir(), "sk102-local-cleanup-outside-"));
    temporaryDirectories.push(root, outside);
    await mkdir(resolve(root, "apps/web"), { recursive: true });
    await mkdir(resolve(outside, ".auth"), { recursive: true });
    await writeFile(resolve(outside, ".auth/producer.json"), "private auth state");
    await writeFile(resolve(outside, "keep.txt"), "keep");
    await symlink(outside, resolve(root, "apps/web/playwright"));

    await expect(removeSk102AuthState(root)).rejects.toThrow("SK102_LOCAL_PATH_UNSAFE");
    await expect(readFile(resolve(outside, ".auth/producer.json"), "utf8")).resolves.toBe(
      "private auth state",
    );

    await rm(resolve(root, "apps/web/playwright"));
    const evidenceTarget = sk102BrowserEvidenceDirectory(root);
    await symlink(resolve(outside, "keep.txt"), evidenceTarget);
    await expect(removeSk102BrowserEvidence(root)).rejects.toThrow("SK102_LOCAL_PATH_UNSAFE");
    await expect(readFile(resolve(outside, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("does not delete storage, database rows, or local files before schema approval", async () => {
    const emptyStorage = vi.fn().mockResolvedValue(undefined);
    const truncateDatabase = vi.fn().mockResolvedValue(undefined);
    const removeGeneratedFiles = vi.fn().mockResolvedValue(undefined);

    await expect(
      runSk102CleanupSteps({
        assertSchema: vi.fn().mockRejectedValue(new Error("SK102_FIXTURE_SCHEMA_MISMATCH")),
        emptyStorage,
        truncateDatabase,
        removeGeneratedFiles,
      }),
    ).rejects.toThrow("SK102_FIXTURE_SCHEMA_MISMATCH");
    expect(emptyStorage).not.toHaveBeenCalled();
    expect(truncateDatabase).not.toHaveBeenCalled();
    expect(removeGeneratedFiles).not.toHaveBeenCalled();
  });
});
