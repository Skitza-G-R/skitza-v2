// Pure helper extracted from lead-link-form.tsx so the node-env test
// suite can import it without parsing JSX (vitest config sets
// environment: "node" and the .tsx file pulls in React/Next imports
// the test runner doesn't load).
export type LinkStatus = "active" | "expired" | "revoked";

export function deriveStatus(
  link: { revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): LinkStatus {
  if (link.revokedAt !== null) return "revoked";
  if (link.expiresAt < now) return "expired";
  return "active";
}
