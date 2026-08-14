import { and, eq } from "drizzle-orm";

import type { Db } from "./client";
import { clerkIdentityBindings } from "./schema";

const CLERK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export type ClerkIdentityBindingState = Readonly<{
  canonicalClerkUserId: string;
  providerClerkUserId?: string;
  status: "staged" | "active" | "revoked";
}>;

export interface ClerkIdentityBindingRepository {
  readonly findProviderBindings: (input: {
    clerkInstanceId: string;
    providerClerkUserId: string;
  }) => Promise<readonly ClerkIdentityBindingState[]>;
  readonly findCanonicalBindings: (input: {
    canonicalClerkUserId: string;
    clerkInstanceId: string;
  }) => Promise<readonly ClerkIdentityBindingState[]>;
  readonly canonicalIdentityExists: (canonicalClerkUserId: string) => Promise<boolean>;
}

export class ClerkIdentityResolutionError extends Error {
  constructor(
    readonly code:
      | "INVALID_CLERK_IDENTITY"
      | "IDENTITY_BINDING_AMBIGUOUS"
      | "IDENTITY_BINDING_NOT_ACTIVE"
      | "IDENTITY_BINDING_REVOKED"
      | "IDENTITY_RELINK_REQUIRED",
  ) {
    super(code);
    this.name = "ClerkIdentityResolutionError";
  }
}

function requiredIdentifier(value: string): string {
  if (!CLERK_ID.test(value)) {
    throw new ClerkIdentityResolutionError("INVALID_CLERK_IDENTITY");
  }
  return value;
}

export function createClerkIdentityBindingRepository(
  db: Pick<Db, "select">,
): ClerkIdentityBindingRepository {
  return Object.freeze({
    async findProviderBindings(input: { clerkInstanceId: string; providerClerkUserId: string }) {
      return db
        .select({
          canonicalClerkUserId: clerkIdentityBindings.canonicalClerkUserId,
          providerClerkUserId: clerkIdentityBindings.providerClerkUserId,
          status: clerkIdentityBindings.status,
        })
        .from(clerkIdentityBindings)
        .where(
          and(
            eq(clerkIdentityBindings.clerkInstanceId, input.clerkInstanceId),
            eq(clerkIdentityBindings.providerClerkUserId, input.providerClerkUserId),
          ),
        );
    },
    async findCanonicalBindings(input: { canonicalClerkUserId: string; clerkInstanceId: string }) {
      return db
        .select({
          canonicalClerkUserId: clerkIdentityBindings.canonicalClerkUserId,
          providerClerkUserId: clerkIdentityBindings.providerClerkUserId,
          status: clerkIdentityBindings.status,
        })
        .from(clerkIdentityBindings)
        .where(
          and(
            eq(clerkIdentityBindings.clerkInstanceId, input.clerkInstanceId),
            eq(clerkIdentityBindings.canonicalClerkUserId, input.canonicalClerkUserId),
          ),
        );
    },
    async canonicalIdentityExists(canonicalClerkUserId: string) {
      const rows = await db
        .select({ id: clerkIdentityBindings.id })
        .from(clerkIdentityBindings)
        .where(eq(clerkIdentityBindings.canonicalClerkUserId, canonicalClerkUserId))
        .limit(1);
      return rows.length === 1;
    },
  });
}

function activeBinding(
  bindings: readonly ClerkIdentityBindingState[],
): ClerkIdentityBindingState | null {
  if (new Set(bindings.map((binding) => binding.canonicalClerkUserId)).size > 1) {
    throw new ClerkIdentityResolutionError("IDENTITY_BINDING_AMBIGUOUS");
  }
  const active = bindings.filter((binding) => binding.status === "active");
  if (active.length > 1) {
    throw new ClerkIdentityResolutionError("IDENTITY_BINDING_AMBIGUOUS");
  }
  if (active.length === 1) return active[0]!;
  if (bindings.some((binding) => binding.status === "staged")) {
    throw new ClerkIdentityResolutionError("IDENTITY_BINDING_NOT_ACTIVE");
  }
  if (bindings.some((binding) => binding.status === "revoked")) {
    throw new ClerkIdentityResolutionError("IDENTITY_BINDING_REVOKED");
  }
  return null;
}

export async function resolveCanonicalClerkUserId(
  repository: ClerkIdentityBindingRepository,
  input: Readonly<{
    clerkInstanceId: string;
    providerClerkUserId: string;
  }>,
): Promise<string> {
  const clerkInstanceId = requiredIdentifier(input.clerkInstanceId);
  const providerClerkUserId = requiredIdentifier(input.providerClerkUserId);
  const binding = activeBinding(
    await repository.findProviderBindings({ clerkInstanceId, providerClerkUserId }),
  );
  if (binding) return requiredIdentifier(binding.canonicalClerkUserId);
  if (await repository.canonicalIdentityExists(providerClerkUserId)) {
    throw new ClerkIdentityResolutionError("IDENTITY_RELINK_REQUIRED");
  }
  return providerClerkUserId;
}

export function resolveCanonicalClerkUserIdWithDb(
  db: Pick<Db, "select">,
  input: Readonly<{
    clerkInstanceId: string;
    providerClerkUserId: string;
  }>,
): Promise<string> {
  return resolveCanonicalClerkUserId(createClerkIdentityBindingRepository(db), input);
}

/**
 * Resolves a canonical directory/closure identity back to the active provider
 * account for one explicitly selected Clerk instance. Unknown new accounts
 * remain self-provider; known staged/revoked identities fail closed.
 */
export async function resolveActiveProviderClerkUserId(
  repository: ClerkIdentityBindingRepository,
  input: Readonly<{
    canonicalClerkUserId: string;
    clerkInstanceId: string;
  }>,
): Promise<string> {
  const canonicalClerkUserId = requiredIdentifier(input.canonicalClerkUserId);
  const clerkInstanceId = requiredIdentifier(input.clerkInstanceId);
  const binding = activeBinding(
    await repository.findCanonicalBindings({ canonicalClerkUserId, clerkInstanceId }),
  );
  if (binding?.providerClerkUserId) {
    return requiredIdentifier(binding.providerClerkUserId);
  }
  if (await repository.canonicalIdentityExists(canonicalClerkUserId)) {
    throw new ClerkIdentityResolutionError("IDENTITY_RELINK_REQUIRED");
  }
  return canonicalClerkUserId;
}

export function resolveActiveProviderClerkUserIdWithDb(
  db: Pick<Db, "select">,
  input: Readonly<{
    canonicalClerkUserId: string;
    clerkInstanceId: string;
  }>,
): Promise<string> {
  return resolveActiveProviderClerkUserId(createClerkIdentityBindingRepository(db), input);
}
