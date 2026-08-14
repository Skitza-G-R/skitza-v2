import { createHash } from "node:crypto";

import { ClerkIdentityRelinkError, type ClerkIdentityRelinkManifest } from "./manifest";

type ClerkProviderEmail = Readonly<{
  email_address?: unknown;
  verification?: Readonly<{ status?: unknown }> | null;
}>;

type ClerkProviderUser = Readonly<{
  id?: unknown;
  banned?: unknown;
  locked?: unknown;
  email_addresses?: unknown;
}>;

export interface ClerkRelinkProviderReader {
  readonly getInstanceId: () => Promise<string>;
  readonly getUser: (userId: string) => Promise<ClerkProviderUser>;
}

export type ClerkRelinkProviderReaders = Readonly<{
  source: ClerkRelinkProviderReader;
  target: ClerkRelinkProviderReader;
}>;

function normalizedVerifiedEmailHashes(user: ClerkProviderUser): Set<string> {
  if (!Array.isArray(user.email_addresses)) {
    throw new ClerkIdentityRelinkError("RELINK_PROVIDER_EVIDENCE_MISMATCH");
  }
  const hashes = new Set<string>();
  for (const candidate of user.email_addresses as ClerkProviderEmail[]) {
    if (
      candidate.verification?.status !== "verified" ||
      typeof candidate.email_address !== "string"
    ) {
      continue;
    }
    const normalized = candidate.email_address.trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) continue;
    hashes.add(`sha256:${createHash("sha256").update(normalized).digest("hex")}`);
  }
  return hashes;
}

async function verifyExactUser(
  reader: ClerkRelinkProviderReader,
  expectedUserId: string,
  expectedEmailHash: string,
): Promise<void> {
  const user = await reader.getUser(expectedUserId);
  if (
    user.id !== expectedUserId ||
    user.banned !== false ||
    user.locked !== false ||
    !normalizedVerifiedEmailHashes(user).has(expectedEmailHash)
  ) {
    throw new ClerkIdentityRelinkError("RELINK_PROVIDER_EVIDENCE_MISMATCH");
  }
}

/**
 * Fetches only the twelve exact user IDs in the private manifest. It never
 * lists or searches users by email, and it proves the same verified hash in
 * both instances before any database staging can run.
 */
export async function verifyClerkRelinkProviderEvidence(
  readers: ClerkRelinkProviderReaders,
  manifest: ClerkIdentityRelinkManifest,
): Promise<void> {
  const [sourceInstanceId, targetInstanceId] = await Promise.all([
    readers.source.getInstanceId(),
    readers.target.getInstanceId(),
  ]);
  if (
    sourceInstanceId !== manifest.sourceClerkInstanceId ||
    targetInstanceId !== manifest.targetClerkInstanceId
  ) {
    throw new ClerkIdentityRelinkError("RELINK_PROVIDER_EVIDENCE_MISMATCH");
  }

  await Promise.all(
    manifest.principals.flatMap((principal) => [
      verifyExactUser(readers.source, principal.canonicalClerkUserId, principal.verifiedEmailHash),
      verifyExactUser(
        readers.target,
        principal.targetProviderClerkUserId,
        principal.verifiedEmailHash,
      ),
    ]),
  );
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function clerkBackendRequest(
  secretKey: string,
  fetcher: FetchLike,
  path: string,
): Promise<unknown> {
  return fetcher(`https://api.clerk.com/v1${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "Clerk-API-Version": "2025-11-10",
      accept: "application/json",
    },
    redirect: "error",
  }).then(async (response) => {
    if (!response.ok) {
      throw new ClerkIdentityRelinkError("RELINK_PROVIDER_EVIDENCE_MISMATCH");
    }
    return response.json() as Promise<unknown>;
  });
}

function providerRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClerkIdentityRelinkError("RELINK_PROVIDER_EVIDENCE_MISMATCH");
  }
  return value as Record<string, unknown>;
}

/** Uses the exact Backend API contract bundled with Clerk 3.2.11. */
export function createClerkRelinkProviderReader(
  secretKey: string,
  fetcher: FetchLike = fetch,
): ClerkRelinkProviderReader {
  if (!secretKey.trim()) {
    throw new ClerkIdentityRelinkError("RELINK_PROVIDER_EVIDENCE_MISMATCH");
  }
  return Object.freeze({
    async getInstanceId() {
      const instance = providerRecord(await clerkBackendRequest(secretKey, fetcher, "/instance"));
      if (typeof instance.id !== "string") {
        throw new ClerkIdentityRelinkError("RELINK_PROVIDER_EVIDENCE_MISMATCH");
      }
      return instance.id;
    },
    async getUser(userId: string) {
      return providerRecord(
        await clerkBackendRequest(secretKey, fetcher, `/users/${encodeURIComponent(userId)}`),
      );
    },
  });
}
