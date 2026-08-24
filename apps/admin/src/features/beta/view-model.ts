import type { BetaInvitee } from "@skitza/db";

// SK-273 — serialization + display helpers shared by the Beta server view
// and its client controls. Dates cross the server/client boundary as ISO
// strings and are formatted in UTC so server render stays deterministic.

export type BetaInviteeStatus = "active" | "invited" | "pending" | "signed_up";

export type BetaInviteeView = Readonly<{
  activatedAt: string | null;
  email: string;
  invitedAt: string | null;
  name: string | null;
  signedUpAt: string | null;
  status: BetaInviteeStatus;
  wave: number;
}>;

export function serializeBetaInvitee(row: BetaInvitee): BetaInviteeView {
  return {
    activatedAt: row.activatedAt?.toISOString() ?? null,
    email: row.email,
    invitedAt: row.invitedAt?.toISOString() ?? null,
    name: row.name,
    signedUpAt: row.signedUpAt?.toISOString() ?? null,
    status: row.status,
    wave: row.wave,
  };
}

export const BETA_STATUS_LABELS: Readonly<Record<BetaInviteeStatus, string>> = {
  active: "Active",
  invited: "Invited",
  pending: "Pending",
  signed_up: "Signed up",
};

export function betaStatusTone(
  status: BetaInviteeStatus,
): "info" | "muted" | "success" | "warning" {
  if (status === "active") return "success";
  if (status === "signed_up") return "info";
  if (status === "invited") return "warning";
  return "muted";
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export function formatBetaDate(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return DATE_FORMAT.format(parsed);
}

export function groupBetaInviteesByWave(
  invitees: readonly BetaInviteeView[],
): readonly (readonly [number, readonly BetaInviteeView[]])[] {
  const waves = new Map<number, BetaInviteeView[]>();
  for (const invitee of invitees) {
    const bucket = waves.get(invitee.wave) ?? [];
    bucket.push(invitee);
    waves.set(invitee.wave, bucket);
  }
  return [...waves.entries()].sort(([a], [b]) => a - b);
}

export function countBetaStatuses(
  invitees: readonly BetaInviteeView[],
): Readonly<Record<BetaInviteeStatus, number>> {
  const counts: Record<BetaInviteeStatus, number> = {
    active: 0,
    invited: 0,
    pending: 0,
    signed_up: 0,
  };
  for (const invitee of invitees) counts[invitee.status] += 1;
  return counts;
}
