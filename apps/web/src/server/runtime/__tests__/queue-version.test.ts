import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  artistPaymentProofQueueVersion,
  producerDashboardQueueVersion,
  producerPaymentProofQueueVersion,
  producerPurchaseRequestQueueVersion,
} from "../queue-version";

const firstId = "10000000-0000-4000-8000-000000000001";
const secondId = "10000000-0000-4000-8000-000000000002";
const here = dirname(fileURLToPath(import.meta.url));
const loaderSource = readFileSync(join(here, "..", "queue-version.ts"), "utf8");

describe("opaque queue versions", () => {
  it("is stable regardless of database row order", () => {
    expect(producerPaymentProofQueueVersion([firstId, secondId])).toBe(
      producerPaymentProofQueueVersion([secondId, firstId]),
    );
  });

  it("changes only when queue membership or scope changes", () => {
    expect(producerPaymentProofQueueVersion([firstId])).not.toBe(
      producerPaymentProofQueueVersion([firstId, secondId]),
    );
    expect(producerPaymentProofQueueVersion([firstId], firstId)).not.toBe(
      producerPaymentProofQueueVersion([firstId]),
    );
    expect(producerPurchaseRequestQueueVersion([firstId])).not.toBe(
      producerPaymentProofQueueVersion([firstId]),
    );
    expect(producerDashboardQueueVersion({ proofIds: [firstId], requestIds: [secondId] })).not.toBe(
      producerDashboardQueueVersion({ proofIds: [secondId], requestIds: [firstId] }),
    );
  });

  it("detects the first externally submitted proof from an initially empty queue", () => {
    const empty = producerPaymentProofQueueVersion([]);
    const firstExternalProof = producerPaymentProofQueueVersion([firstId]);

    expect(firstExternalProof).not.toBe(empty);
  });

  it("detects an artist proof decision without exposing proof state", () => {
    const pending = artistPaymentProofQueueVersion({
      purchaseId: firstId,
      installmentId: secondId,
      proofs: [
        {
          proofId: firstId,
          status: "pending",
          confirmedAt: null,
          rejectedAt: null,
          createdAt: new Date("2026-07-27T10:00:00.000Z"),
        },
      ],
    });
    const confirmed = artistPaymentProofQueueVersion({
      purchaseId: firstId,
      installmentId: secondId,
      proofs: [
        {
          proofId: firstId,
          status: "confirmed",
          confirmedAt: new Date("2026-07-27T10:05:00.000Z"),
          rejectedAt: null,
          createdAt: new Date("2026-07-27T10:00:00.000Z"),
        },
      ],
    });

    expect(confirmed).not.toBe(pending);
    expect(confirmed).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
    expect(confirmed).not.toContain(firstId);
    expect(confirmed).not.toContain("confirmed");
  });

  it("keeps every real loader read behind the signed-in tenant identity", () => {
    const producerProofRead = loaderSource.slice(
      loaderSource.indexOf("async function loadPendingProofIds"),
      loaderSource.indexOf("async function loadPendingRequestIds"),
    );
    const producerRequestRead = loaderSource.slice(
      loaderSource.indexOf("async function loadPendingRequestIds"),
      loaderSource.indexOf("async function loadArtistProofVersion"),
    );
    const artistProofRead = loaderSource.slice(
      loaderSource.indexOf("async function loadArtistProofVersion"),
      loaderSource.indexOf("/**\n * Lightweight revision read"),
    );

    for (const producerRead of [producerProofRead, producerRequestRead]) {
      expect(producerRead).toMatch(
        /\.innerJoin\(producers, eq\(producers\.id, [^)]+\.producerId\)\)/,
      );
      expect(producerRead).toMatch(/eq\(producers\.clerkUserId, clerkUserId\)/);
    }
    expect(artistProofRead).toMatch(/\.innerJoin\(\s*clientContacts/);
    expect(artistProofRead).toMatch(/eq\(clientContacts\.id, paymentProofs\.clientContactId\)/);
    expect(artistProofRead).toMatch(/eq\(clientContacts\.producerId, paymentProofs\.producerId\)/);
    expect(artistProofRead).toMatch(/eq\(clientContacts\.clerkUserId, clerkUserId\)/);
    expect(artistProofRead).toMatch(/isNull\(clientContacts\.archivedAt\)/);
    expect(artistProofRead).toMatch(/eq\(paymentProofs\.purchaseId, input\.purchaseId\)/);
    expect(artistProofRead).toMatch(/eq\(paymentProofs\.installmentId, input\.installmentId\)/);
    expect(loaderSource).not.toMatch(/storageKey|objectEtag|originalFileName|artistEmail/);
  });
});
