import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SK102_REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../../../", import.meta.url)),
);

export const SK102_FIXTURE_NAMES = Object.freeze({
  studioA: "Fixture Studio A",
  studioB: "Fixture Studio B",
  artist: "Fixture Artist",
  uninvitedClient: "Fixture Uninvited",
  projects: [
    "Fixture Project A",
    "Fixture Project B",
    "Fixture Project C",
    "Fixture Project 0",
  ] as const,
  audioSong: "Fixture Song",
  products: ["Fixture Product A", "Fixture Product B", "Fixture Session"] as const,
  pendingProofFile: "fixture-proof.png",
});

const [PROJECT_A, PROJECT_B, PROJECT_C, PROJECT_COMPLETED] = SK102_FIXTURE_NAMES.projects;
export const SK102_PROJECT_SORT_ORDERS = Object.freeze({
  custom: [PROJECT_A, PROJECT_B, PROJECT_C, PROJECT_COMPLETED] as const,
  recent: [PROJECT_COMPLETED, PROJECT_C, PROJECT_A, PROJECT_B] as const,
  deadline: [PROJECT_A, PROJECT_B, PROJECT_C, PROJECT_COMPLETED] as const,
  balance: [PROJECT_A, PROJECT_B, PROJECT_C, PROJECT_COMPLETED] as const,
  progress: [PROJECT_COMPLETED, PROJECT_A, PROJECT_B, PROJECT_C] as const,
  joined: [PROJECT_COMPLETED, PROJECT_C, PROJECT_B, PROJECT_A] as const,
  name: [PROJECT_COMPLETED, PROJECT_A, PROJECT_B, PROJECT_C] as const,
});

export const SK102_FIXTURE_COVERAGE = Object.freeze({
  projectLifecycle: ["waiting_for_payment", "active", "paused", "completed", "canceled"] as const,
  purchaseLifecycle: ["waiting_for_payment", "active", "canceled"] as const,
  requestLifecycle: ["pending", "approved", "declined", "converted"] as const,
  privateOfferLifecycle: ["draft", "sent", "accepted", "declined", "expired", "canceled"] as const,
  proofLifecycle: ["pending", "confirmed", "rejected"] as const,
  producerPaymentBuckets: ["needs_review", "due_or_overdue", "upcoming", "history"] as const,
  artistPaymentBuckets: ["waiting", "active", "history"] as const,
  bookingLifecycle: [
    "pending_approval",
    "confirmed",
    "rejected",
    "cancelled",
    "completed",
    "no_show",
  ] as const,
  browserActions: [
    "navigation",
    "saves",
    "sorting",
    "reordering",
    "invitations",
    "payment_reminders",
    "audio_uploads",
    "booking",
    "store",
    "payment_proofs",
    "artist_approval",
    "multi_studio",
  ] as const,
});

export const SK102_APPLICATION_TABLES = Object.freeze([
  "song_public_access_events",
  "song_public_links",
  "version_approval_events",
  "purchase_download_override_events",
  "booking_transition_events",
  "bookings",
  "purchase_session_allowances",
  "project_payment_pause_events",
  "purchase_reminder_logs",
  "purchase_reminder_deliveries",
  "purchase_cancellations",
  "purchase_waivers",
  "purchase_payment_corrections",
  "purchase_payments",
  "payment_proofs",
  "purchase_acceptances",
  "purchase_installments",
  "track_comments",
  "notifications",
  "track_versions",
  "project_tracks",
  "purchases",
  "private_offers",
  "purchase_requests",
  "projects",
  "client_contacts",
  "availability_blackouts",
  "availability_blocks",
  "producer_notes",
  "producer_external_links",
  "portfolio_tracks",
  "products",
  "producers",
] as const);

export type Sk102FixtureSlot = "desktop" | "phone390" | "phone360";

export const SK102_BROWSER_RUN_LEASE_ENV = "SKITZA_E2E_RUN_LEASE_TOKEN";
export const SK102_BROWSER_RUN_ADMITTED_ENV = "SKITZA_E2E_RUN_LEASE_ADMITTED";

export function validateSk102BrowserRunLeaseToken(value: string | undefined): string {
  const token = value?.trim();
  if (
    !token ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(token)
  ) {
    throw new Error("SK102_BROWSER_RUN_LEASE_INVALID");
  }
  return token;
}

export function parseSk102FixtureSlot(value: string): Sk102FixtureSlot {
  if (value === "desktop" || value === "phone390" || value === "phone360") return value;
  throw new Error("SK102_FIXTURE_SLOT_INVALID");
}

/** Stable logical IDs without committing provider identities or database-generated IDs. */
export function sk102FixtureUuid(slot: Sk102FixtureSlot, alias: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(alias)) {
    throw new Error("SK102_FIXTURE_ALIAS_INVALID");
  }
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`skitza:sk102:fixture:v1\0${slot}\0${alias}`)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type Sk102FixtureIdentity = Readonly<{
  producerClerkUserId: string;
  artistClerkUserId: string;
  producerEmail: string;
  artistEmail: string;
  sinkEmailDomain: string;
}>;

function normalizedEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    throw new Error("SK102_FIXTURE_EMAIL_INVALID");
  }
  return normalized;
}

export function validateSk102FixtureIdentity(input: Sk102FixtureIdentity): Sk102FixtureIdentity {
  const producerClerkUserId = input.producerClerkUserId.trim();
  const artistClerkUserId = input.artistClerkUserId.trim();
  const sinkEmailDomain = input.sinkEmailDomain.trim().toLowerCase();
  const producerEmail = normalizedEmail(input.producerEmail);
  const artistEmail = normalizedEmail(input.artistEmail);
  if (
    producerClerkUserId.length < 5 ||
    artistClerkUserId.length < 5 ||
    producerClerkUserId === artistClerkUserId
  ) {
    throw new Error("SK102_FIXTURE_CLERK_IDENTITY_INVALID");
  }
  if (producerEmail === artistEmail) {
    throw new Error("SK102_FIXTURE_EMAIL_IDENTITY_INVALID");
  }
  if (
    !/^[a-z0-9.-]+$/.test(sinkEmailDomain) ||
    sinkEmailDomain.includes("..") ||
    !producerEmail.endsWith(`@${sinkEmailDomain}`) ||
    !artistEmail.endsWith(`@${sinkEmailDomain}`)
  ) {
    throw new Error("SK102_FIXTURE_EMAIL_NOT_SINK_SCOPED");
  }
  const clerkTestSuffix = `+clerk_test@${sinkEmailDomain}`;
  if (!producerEmail.endsWith(clerkTestSuffix) || !artistEmail.endsWith(clerkTestSuffix)) {
    throw new Error("SK102_FIXTURE_CLERK_TEST_EMAIL_REQUIRED");
  }
  return Object.freeze({
    producerClerkUserId,
    artistClerkUserId,
    producerEmail,
    artistEmail,
    sinkEmailDomain,
  });
}

export function sk102SinkEmail(label: string, domain: string): string {
  if (!/^[a-z0-9][a-z0-9.+_-]{0,62}$/.test(label) || !/^[a-z0-9.-]+$/.test(domain)) {
    throw new Error("SK102_FIXTURE_EMAIL_INVALID");
  }
  return `${label}@${domain}`;
}

const GENERATED_ROOT = ".skitza/e2e";

export function resolveSk102GeneratedPath(cwd: string, requested: string): string {
  if (!requested.trim()) throw new Error("SK102_FIXTURE_PATH_INVALID");
  const root = resolve(cwd, GENERATED_ROOT);
  const target = isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested);
  const child = relative(root, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("SK102_FIXTURE_PATH_INVALID");
  }
  return target;
}

export function sk102DefaultManifestPath(slot: Sk102FixtureSlot): string {
  return `${GENERATED_ROOT}/${slot}.json`;
}
