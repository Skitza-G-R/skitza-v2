import { createHash } from "node:crypto";

// Stable identity key for an email. Hashing happens for two reasons:
// (1) privacy — we never want plaintext email duplicated outside the
// `email` column itself; (2) it's cheap to index a fixed-width hex
// string. Lowercase + trim because Gmail and Clerk both treat
// "Dan@x.com" === "dan@x.com" and we follow.
//
// IMPORTANT: This is the canonical email-hash for the codebase. All
// known call sites use this helper as of commit 7b67da53. Any new
// site that hashes emails MUST use this — divergence (e.g. someone
// inlining createHash without the .trim()) silently breaks the
// artist app: different hash → no row matches → zero studios in
// the switcher.
export function emailHashFor(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// Shape of the row we expect from the artist's SELECT:
type StudioRow = {
  producerId: string;
  producerName: string;
  producerSlug: string;
  producerLogoUrl: string | null;
  lastSeenAt: Date | null;  // legacy rows or weird joins may produce null
};

export type Studio = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

// Collapse the artist's per-producer client_contacts rows into a
// deduped, recency-sorted list of Studios. The artist may have N
// rows for the same producer if they've been added multiple times
// (e.g. invited under different emails that later resolved to the
// same Clerk user) — keep only the most-recent name/logo for each.
export function groupStudiosForArtist(rows: StudioRow[]): Studio[] {
  // Map producerId -> most-recent row. Null lastSeenAt is treated as
  // "least recent" — sorts after all dated rows. On exact ties, the
  // first row encountered wins (stable for fixed input ordering).
  const byProducer = new Map<string, StudioRow>();
  for (const row of rows) {
    const existing = byProducer.get(row.producerId);
    if (!existing) {
      byProducer.set(row.producerId, row);
      continue;
    }
    const existingTime = existing.lastSeenAt?.getTime() ?? -Infinity;
    const rowTime = row.lastSeenAt?.getTime() ?? -Infinity;
    if (rowTime > existingTime) {
      byProducer.set(row.producerId, row);
    }
  }

  return [...byProducer.values()]
    .sort((a, b) => {
      const at = a.lastSeenAt?.getTime() ?? -Infinity;
      const bt = b.lastSeenAt?.getTime() ?? -Infinity;
      return bt - at;  // desc
    })
    .map((r) => ({
      producerId: r.producerId,
      name: r.producerName,
      slug: r.producerSlug,
      logoUrl: r.producerLogoUrl,
    }));
}
