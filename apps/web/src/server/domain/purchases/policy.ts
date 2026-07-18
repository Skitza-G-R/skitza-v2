import { createHash } from "node:crypto";

import type { PurchaseCommercialSnapshot } from "@skitza/db";

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type FrozenCommercialSnapshot<Snapshot = PurchaseCommercialSnapshot> = Readonly<{
  value: DeepReadonly<Snapshot>;
  canonicalJson: string;
  digest: string;
}>;

function canonicalValue(value: unknown, ancestors: WeakSet<object>): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Commercial snapshot numbers must be finite");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error("Commercial snapshots must contain only JSON-safe values");
  }
  if (ancestors.has(value)) {
    throw new Error("Commercial snapshots must contain only JSON-safe acyclic values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: CanonicalJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new Error("Commercial snapshots must contain only JSON-safe dense arrays");
        }
        result.push(canonicalValue(value[index], ancestors));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Commercial snapshots must contain only JSON-safe plain objects");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error("Commercial snapshots must contain only JSON-safe string keys");
    }

    const record = value as Record<string, unknown>;
    const result = Object.create(null) as Record<string, CanonicalJsonValue>;
    const keys = Object.keys(record).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const key of keys) {
      result[key] = canonicalValue(record[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeCommercialSnapshot(snapshot: unknown): string {
  return JSON.stringify(canonicalValue(snapshot, new WeakSet()));
}

export function digestCommercialSnapshot(snapshot: unknown): string {
  return sha256(canonicalizeCommercialSnapshot(snapshot));
}

function freezeCanonicalValue<Value>(value: Value): DeepReadonly<Value> {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) {
      freezeCanonicalValue(nested);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<Value>;
}

export function snapshotCommercialTerms<Snapshot>(
  snapshot: Snapshot,
): FrozenCommercialSnapshot<Snapshot> {
  const canonicalJson = canonicalizeCommercialSnapshot(snapshot);
  const value = freezeCanonicalValue(JSON.parse(canonicalJson) as Snapshot);
  return Object.freeze({ value, canonicalJson, digest: sha256(canonicalJson) });
}

/**
 * Activation is one-way. A correction can make the first installment partial
 * again, but it must never erase the time at which work was activated.
 */
export function nextMonotonicActivationAt(
  current: Date | null,
  firstInstallmentPaid: boolean,
  occurredAt: Date,
): Date | null {
  if (current) return current;
  return firstInstallmentPaid ? occurredAt : null;
}

export type PurchaseAccessScope = Readonly<{
  purchaseId: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
}>;

export type DownloadActor =
  | Readonly<{ kind: "producer"; producerId: string }>
  | Readonly<{
      kind: "artist";
      producerId: string;
      clientContactId: string;
    }>;

export type VersionAccessScope = Readonly<{
  versionId: string;
  purchaseId: string;
  producerId: string;
  projectId: string;
  audioStored: boolean;
}>;

export type VersionDownloadOverride = Readonly<{
  purchaseId: string;
  versionId: string;
  enabled: boolean;
}>;

export type VersionDownloadDecision =
  | Readonly<{
      allowed: true;
      reason: "producer_owner" | "purchase_fully_paid" | "version_override";
    }>
  | Readonly<{
      allowed: false;
      reason: "scope_mismatch" | "not_owner" | "audio_unavailable" | "payment_required";
    }>;

export function purchaseScopeMatches(
  purchase: Pick<PurchaseAccessScope, "producerId" | "projectId" | "clientContactId">,
  scope: Readonly<{
    producerId: string;
    projectId: string;
    clientContactId: string;
  }>,
): boolean {
  return (
    purchase.producerId === scope.producerId &&
    purchase.projectId === scope.projectId &&
    purchase.clientContactId === scope.clientContactId
  );
}

export function decideVersionDownload(
  input: Readonly<{
    actor: DownloadActor;
    purchase: PurchaseAccessScope;
    version: VersionAccessScope;
    fullyPaid: boolean;
    override: VersionDownloadOverride | null;
  }>,
): VersionDownloadDecision {
  const { actor, purchase, version } = input;
  if (
    version.purchaseId !== purchase.purchaseId ||
    version.producerId !== purchase.producerId ||
    version.projectId !== purchase.projectId
  ) {
    return { allowed: false, reason: "scope_mismatch" };
  }
  if (!version.audioStored) {
    return { allowed: false, reason: "audio_unavailable" };
  }
  if (actor.producerId !== purchase.producerId) {
    return { allowed: false, reason: "not_owner" };
  }
  if (actor.kind === "producer") {
    return { allowed: true, reason: "producer_owner" };
  }
  if (actor.clientContactId !== purchase.clientContactId) {
    return { allowed: false, reason: "not_owner" };
  }
  if (input.fullyPaid) {
    return { allowed: true, reason: "purchase_fully_paid" };
  }
  if (
    input.override?.enabled === true &&
    input.override.purchaseId === purchase.purchaseId &&
    input.override.versionId === version.versionId
  ) {
    return { allowed: true, reason: "version_override" };
  }
  return { allowed: false, reason: "payment_required" };
}
