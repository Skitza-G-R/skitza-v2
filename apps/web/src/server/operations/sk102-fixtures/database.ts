import {
  asc,
  availabilityBlocks,
  bookingTransitionEvents,
  bookings,
  clientContacts,
  eq,
  notifications,
  paymentProofs,
  portfolioTracks,
  privateOffers,
  producerNotes,
  producers,
  products,
  projectTracks,
  projects,
  purchaseInstallments,
  purchaseRequests,
  purchaseSessionAllowances,
  sql,
  trackComments,
  trackVersions,
  type Db,
  type PaymentPlan,
  type ProductRoyaltyTerms,
} from "@skitza/db";

import { emailHashFor } from "~/server/artist/identity";
import { computeStoredAudioIdentityFingerprint } from "~/server/domain/song-management/service";
import { buildPrivateOfferSnapshot } from "~/server/domain/private-offers/service";
import { purchaseLedgerRepository } from "~/server/domain/purchase-ledger/db";
import {
  cancelPurchase,
  pauseProjectForOverdueInstallment,
  reconcilePurchaseLedger,
  recordConfirmedPurchasePayment,
} from "~/server/domain/purchase-ledger/service";
import { purchaseInstallmentDueLabel } from "~/server/domain/purchases/ledger";
import { digestCommercialSnapshot } from "~/server/domain/purchases/policy";
import { purchaseRepositoryForTransaction } from "~/server/domain/purchases/db";
import { acceptPurchase } from "~/server/domain/purchases/service";
import {
  buildStorePurchaseSnapshot,
  type StoreProductCommercialInput,
} from "~/server/domain/store-products/service";

import {
  SK102_APPLICATION_TABLES,
  SK102_FIXTURE_NAMES,
  sk102FixtureUuid,
  sk102SinkEmail,
  type Sk102FixtureIdentity,
  type Sk102FixtureSlot,
} from "./contract";
import type { Sk102StoredObject } from "./storage";

type FixtureProduct = Readonly<{
  id: string;
  producerId: string;
  row: StoreProductCommercialInput & { position: number };
}>;

type AcceptedFixture = Readonly<{
  alias: string;
  producerId: string;
  clientContactId: string;
  projectId: string;
  product: FixtureProduct;
  purchaseId: string;
  requestId: string;
  acceptedAt: Date;
  installments: readonly (typeof purchaseInstallments.$inferSelect)[];
}>;

export type Sk102DatabaseSeedResult = Readonly<{
  producerId: string;
  audioVersionId: string;
  pendingProofConfirmId: string;
  pendingProofRejectId: string;
  artistProofPurchaseId: string;
  rejectedProofPurchaseId: string;
  pendingBookingId: string;
  reminderButtonName: string;
}>;

export type Sk102ObjectIdentity = Readonly<{
  key: string;
  objectEtag: string;
  sizeBytes: number;
}>;

export type Sk102SeedObjectIdentities = Readonly<{
  audio: Sk102ObjectIdentity;
  secondaryAudio: Sk102ObjectIdentity;
  pendingProofConfirm: Sk102ObjectIdentity;
  pendingProofReject: Sk102ObjectIdentity;
  rejectedProof: Sk102ObjectIdentity;
  confirmedProof: Sk102ObjectIdentity;
}>;

export const SK102_DATABASE_ADVISORY_LOCK = "skitza:sk102:fixtures:v1";

export type Sk102MigrationLedgerEntry = Readonly<{
  filename: string;
  digest: string;
}>;

export const SK102_EXPECTED_MIGRATION_LEDGER: readonly Sk102MigrationLedgerEntry[] = Object.freeze([
  {
    filename: "0027_purchase_foundation.sql",
    digest: "7cd77f778f677d89ebfeeac3cc0eefed8ff5cfb0c0f68c2991733edd16ba5112",
  },
  {
    filename: "0028_stable_client_ownership.sql",
    digest: "f2bb0cbeece464fb41ead75d3fd283f765c53c1e61675fc0b43a843650f1e0a9",
  },
  {
    filename: "0029_private_offer_recipient_identity.sql",
    digest: "42756687f2af3bdb31e60a0cd62f1cc05277a1237c6b07ad2bf2ab4e5c91a2bf",
  },
  {
    filename: "0030_song_release_state.sql",
    digest: "abb2aea0e909aee563b71cf70a54dc429628035d9e2744abc7f44fbc03596a90",
  },
  {
    filename: "0031_purchase_ledger_runtime.sql",
    digest: "fd9bee14abfbc7c15ce62d25bced695d5a9ea062e1cc41a234cdcc3a1bd6171c",
  },
  {
    filename: "0032_purchase_session_allowance.sql",
    digest: "e7435f31d7580930e16f5afb51bfd9a4bcae7a29642f802861e65085585856f7",
  },
  {
    filename: "0033_purchase_version_download_overrides.sql",
    digest: "4cd3a4872ad97f95ea24c4e9a554b4ef387501a1a97444fb1fb78ed1cd31e083",
  },
  {
    filename: "0034_song_public_access.sql",
    digest: "a96d19aafcb88da1df61de70ae1a73e653251a636cc5a583d0e22d07e6d24ed6",
  },
]);

export function assertSk102MigrationLedger(entries: readonly Sk102MigrationLedgerEntry[]): void {
  if (
    entries.length !== SK102_EXPECTED_MIGRATION_LEDGER.length ||
    entries.some((entry, index) => {
      const expected = SK102_EXPECTED_MIGRATION_LEDGER[index];
      return !expected || entry.filename !== expected.filename || entry.digest !== expected.digest;
    })
  ) {
    throw new Error("SK102_FIXTURE_SCHEMA_MISMATCH");
  }
}

export function sk102TruncateStatement(): string {
  const quoted = SK102_APPLICATION_TABLES.map((table) => `public."${table}"`).join(", ");
  return `TRUNCATE TABLE ${quoted} RESTART IDENTITY`;
}

export function sk102EmptyReadbackStatement(): string {
  const checks = SK102_APPLICATION_TABLES.map(
    (table) => `SELECT EXISTS (SELECT 1 FROM public."${table}" LIMIT 1) AS "hasRows"`,
  ).join(" UNION ALL ");
  return `SELECT count(*)::int AS "nonemptyTableCount" FROM (${checks}) AS "approvedTables" WHERE "hasRows"`;
}

export async function assertSk102FixtureDatabaseEmpty(db: Db): Promise<void> {
  const result = await db.execute<{ nonemptyTableCount: number }>(
    sql.raw(sk102EmptyReadbackStatement()),
  );
  if (result.rows[0]?.nonemptyTableCount !== 0) {
    throw new Error("SK102_FIXTURE_DATABASE_CLEANUP_INCOMPLETE");
  }
}

export async function assertSk102FixtureSchema(db: Db): Promise<void> {
  const result = await db.execute<{
    applicationTableCount: number;
    approvedApplicationTableCount: number;
    triggerCount: number;
    legacyTableCount: number;
  }>(sql`
    select
      (
        select count(*)::int
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
      ) as "applicationTableCount",
      (
        select count(*)::int
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          and relation.relname = any(${[...SK102_APPLICATION_TABLES]}::text[])
      ) as "approvedApplicationTableCount",
      (
        select count(*)::int from pg_trigger
        where not tgisinternal and tgenabled = 'O'
          and tgname in (
            'purchase_acceptances_append_only',
            'purchase_installments_protect_terms',
            'track_versions_protect_identity',
            'bookings_protect_identity',
            'song_public_access_events_append_only'
          )
      ) as "triggerCount",
      (
        select count(*)::int
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          and relation.relname in ('stripe_customers', 'invoices', 'waitlist')
      ) as "legacyTableCount"
  `);
  const marker = result.rows[0];
  if (
    marker?.applicationTableCount !== SK102_APPLICATION_TABLES.length ||
    marker.approvedApplicationTableCount !== SK102_APPLICATION_TABLES.length ||
    marker.triggerCount !== 5 ||
    marker.legacyTableCount !== 0
  ) {
    throw new Error("SK102_FIXTURE_SCHEMA_MISMATCH");
  }
  const ledger = await db.execute<Sk102MigrationLedgerEntry>(sql`
    select "filename", "digest"
    from "skitza_migrations"."applied"
    order by "filename"
  `);
  assertSk102MigrationLedger(ledger.rows);
}

export async function truncateSk102FixtureDatabase(db: Db): Promise<void> {
  await assertSk102FixtureSchema(db);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${SK102_DATABASE_ADVISORY_LOCK}, 0))`,
    );
    await tx.execute(sql.raw(sk102TruncateStatement()));
  });
  await assertSk102FixtureDatabaseEmpty(db);
}

function anchorTime(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new Error("SK102_FIXTURE_TIME_INVALID");
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

function offset(anchor: Date, days: number, hours = 0): Date {
  return new Date(anchor.getTime() + (days * 24 + hours) * 60 * 60 * 1_000);
}

const ROYALTIES: ProductRoyaltyTerms = {
  master: { mode: "none" },
  composition: { mode: "none" },
};

function fixtureProduct(
  id: string,
  producerId: string,
  input: {
    name: string;
    position: number;
    priceCents: number;
    durationMin?: number;
    sessionCount?: number;
    kind?: string;
    plans?: PaymentPlan[];
    active?: boolean;
    archivedAt?: Date | null;
    pricingModel?: "flat" | "per_song";
    volumeTiers?: { minQty: number; pricePerUnitCents: number }[] | null;
  },
): FixtureProduct {
  return {
    id,
    producerId,
    row: {
      name: input.name,
      description: "A deterministic SK-102 browser fixture.\n---\nrevisions: 2",
      kind: input.kind ?? "mix",
      pricingModel: input.pricingModel ?? "flat",
      priceCents: input.priceCents,
      currency: "USD",
      volumeTiers: input.volumeTiers ?? null,
      hourlyRateCents: null,
      durationMin: input.durationMin ?? 0,
      sessionCount: input.sessionCount ?? 0,
      deliverables: ["Stereo WAV", "Stems"],
      locationType: "studio",
      bufferMinutes: 15,
      minLeadHours: 0,
      paymentPlans: input.plans ?? [{ kind: "full" }],
      royaltyTerms: ROYALTIES,
      agreementText: "SK-102 isolated browser fixture terms.",
      active: input.active ?? true,
      archivedAt: input.archivedAt ?? null,
      position: input.position,
    },
  };
}

function fixtureProductInsertRow(product: FixtureProduct, createdAt: Date) {
  return {
    id: product.id,
    producerId: product.producerId,
    ...product.row,
    volumeTiers: product.row.volumeTiers?.map((tier) => ({ ...tier })) ?? null,
    deliverables: product.row.deliverables ? [...product.row.deliverables] : null,
    paymentPlans: product.row.paymentPlans.map((plan) => ({ ...plan })),
    createdAt,
  };
}

function requestDigest(alias: string): string {
  return digestCommercialSnapshot({ kind: "sk102-fixture-request-v1", alias });
}

async function createAcceptedFixture(
  db: Db,
  input: {
    slot: Sk102FixtureSlot;
    alias: string;
    producerId: string;
    clientContactId: string;
    artistClerkUserId: string;
    artistEmail: string;
    projectId: string;
    product: FixtureProduct;
    plan: PaymentPlan;
    acceptedAt: Date;
    requestedSongQty?: number | null;
  },
): Promise<AcceptedFixture> {
  const requestId = sk102FixtureUuid(input.slot, `${input.alias}.request`);
  const snapshot = buildStorePurchaseSnapshot({
    product: input.product.row,
    requestedSongQty: input.requestedSongQty ?? null,
    taxMode: "tax_free",
    taxRatePct: 18,
    selectedPaymentPlan: input.plan,
  });
  const result = await db.transaction(async (tx) => {
    await tx.insert(purchaseRequests).values({
      id: requestId,
      producerId: input.producerId,
      clientContactId: input.clientContactId,
      productId: input.product.id,
      projectId: input.projectId,
      operationKey: `sk102:${input.alias}:request`,
      operationDigest: requestDigest(input.alias),
      refNumber: `SK102-${input.alias.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
      status: "approved",
      artistName: SK102_FIXTURE_NAMES.artist,
      artistEmail: input.artistEmail,
      requestedSongQty: input.requestedSongQty ?? null,
      brief: `SK-102 ${input.alias} browser fixture`,
      statusChangedAt: input.acceptedAt,
      approvedAt: input.acceptedAt,
      createdAt: offset(input.acceptedAt, -1),
      updatedAt: input.acceptedAt,
    });
    const accepted = await acceptPurchase(purchaseRepositoryForTransaction(tx), {
      producerId: input.producerId,
      projectId: input.projectId,
      clientContactId: input.clientContactId,
      source: {
        kind: snapshot.snapshot.session === null ? "store_product" : "session_product",
        productId: input.product.id,
        privateOfferId: null,
        purchaseRequestId: requestId,
      },
      acceptedByClerkUserId: input.artistClerkUserId,
      operationKey: `sk102:${input.alias}:accept`,
      totalCents: snapshot.snapshot.totalCents,
      plan: input.plan,
      commercialSnapshot: snapshot.snapshot,
      acceptedAt: input.acceptedAt,
    });
    await tx
      .update(purchaseRequests)
      .set({
        status: "converted",
        statusChangedAt: input.acceptedAt,
        convertedAt: input.acceptedAt,
        updatedAt: input.acceptedAt,
      })
      .where(eq(purchaseRequests.id, requestId));
    return accepted;
  });
  const installments = await db
    .select()
    .from(purchaseInstallments)
    .where(eq(purchaseInstallments.purchaseId, result.purchase.id))
    .orderBy(asc(purchaseInstallments.position));
  return {
    alias: input.alias,
    producerId: input.producerId,
    clientContactId: input.clientContactId,
    projectId: input.projectId,
    product: input.product,
    purchaseId: result.purchase.id,
    requestId,
    acceptedAt: input.acceptedAt,
    installments,
  };
}

async function payInstallment(
  db: Db,
  fixture: AcceptedFixture,
  position: number,
  actorId: string,
  paidAt: Date,
  proofId: string | null = null,
): Promise<void> {
  const installment = fixture.installments.find((candidate) => candidate.position === position);
  if (!installment) throw new Error("SK102_FIXTURE_INSTALLMENT_MISSING");
  await recordConfirmedPurchasePayment(purchaseLedgerRepository(db), {
    producerId: fixture.producerId,
    purchaseId: fixture.purchaseId,
    installmentId: installment.id,
    operationKey: `sk102:${fixture.alias}:payment:${String(position)}`,
    source: proofId === null ? "manual" : "proof",
    proofId,
    amountCents: installment.amountCents,
    currency: installment.currency,
    paidAt,
    occurredAt: paidAt,
    actorId,
    note: "SK-102 isolated fixture payment",
  });
}

function proofKey(slot: Sk102FixtureSlot, alias: string): string {
  const digest = digestCommercialSnapshot({ kind: "sk102-proof-object-v1", slot, alias });
  return `proof-evidence/${digest.replace(/^sha256:/, "")}`;
}

export function sk102SeedObjectPlan(
  slot: Sk102FixtureSlot,
  producerAId: string,
  producerBId: string,
): readonly Sk102StoredObject[] {
  const audioVersionId = sk102FixtureUuid(slot, "audio.version.final");
  const secondaryVersionId = sk102FixtureUuid(slot, "secondary.version.final");
  return [
    {
      alias: "audio",
      bucket: "audio",
      key: `producers/${producerAId}/tracks/${audioVersionId}/sk102-fixture.wav`,
      contentType: "audio/wav",
      asset: "audio",
    },
    {
      alias: "secondaryAudio",
      bucket: "audio",
      key: `producers/${producerBId}/tracks/${secondaryVersionId}/sk102-fixture.wav`,
      contentType: "audio/wav",
      asset: "audio",
    },
    ...(
      ["pendingProofConfirm", "pendingProofReject", "rejectedProof", "confirmedProof"] as const
    ).map((alias) => ({
      alias,
      bucket: "docs" as const,
      key: proofKey(slot, alias),
      contentType: "image/png" as const,
      asset: "proof" as const,
    })),
  ];
}

function identityFor(
  objects: ReadonlyMap<string, Sk102ObjectIdentity>,
  alias: keyof Sk102SeedObjectIdentities,
): Sk102ObjectIdentity {
  const identity = objects.get(alias);
  if (!identity) throw new Error("SK102_FIXTURE_OBJECT_IDENTITY_MISSING");
  return identity;
}

export function sk102ObjectIdentities(
  objects: ReadonlyMap<string, Sk102ObjectIdentity>,
): Sk102SeedObjectIdentities {
  return {
    audio: identityFor(objects, "audio"),
    secondaryAudio: identityFor(objects, "secondaryAudio"),
    pendingProofConfirm: identityFor(objects, "pendingProofConfirm"),
    pendingProofReject: identityFor(objects, "pendingProofReject"),
    rejectedProof: identityFor(objects, "rejectedProof"),
    confirmedProof: identityFor(objects, "confirmedProof"),
  };
}

type SeedInput = Readonly<{
  slot: Sk102FixtureSlot;
  identity: Sk102FixtureIdentity;
  objects: Sk102SeedObjectIdentities;
  now?: Date;
}>;

type FixtureIds = Readonly<{
  producerA: string;
  producerB: string;
  artistA: string;
  artistB: string;
  uninvited: string;
  productA: string;
  productB: string;
  sessionProduct: string;
  productBStudio: string;
  projects: Readonly<{
    audio: string;
    due: string;
    upcoming: string;
    proofConfirm: string;
    proofReject: string;
    rejectedProof: string;
    artistUpload: string;
    history: string;
    canceled: string;
    paused: string;
    completed: string;
    booking: string;
    studioB: string;
    invite: string;
  }>;
}>;

function fixtureIds(slot: Sk102FixtureSlot): FixtureIds {
  const project = (alias: string) => sk102FixtureUuid(slot, `project.${alias}`);
  return {
    producerA: sk102FixtureUuid(slot, "producer.a"),
    producerB: sk102FixtureUuid(slot, "producer.b"),
    artistA: sk102FixtureUuid(slot, "contact.artist.a"),
    artistB: sk102FixtureUuid(slot, "contact.artist.b"),
    uninvited: sk102FixtureUuid(slot, "contact.uninvited"),
    productA: sk102FixtureUuid(slot, "product.a"),
    productB: sk102FixtureUuid(slot, "product.b"),
    sessionProduct: sk102FixtureUuid(slot, "product.session"),
    productBStudio: sk102FixtureUuid(slot, "product.studio-b"),
    projects: {
      audio: project("audio"),
      due: project("due"),
      upcoming: project("upcoming"),
      proofConfirm: project("proof-confirm"),
      proofReject: project("proof-reject"),
      rejectedProof: project("rejected-proof"),
      artistUpload: project("artist-upload"),
      history: project("history"),
      canceled: project("canceled"),
      paused: project("paused"),
      completed: project("completed"),
      booking: project("booking"),
      studioB: project("studio-b"),
      invite: project("invite"),
    },
  };
}

function projectTitle(alias: string): string {
  if (alias === "audio") return SK102_FIXTURE_NAMES.projects[0];
  if (alias === "due") return SK102_FIXTURE_NAMES.projects[1];
  if (alias === "upcoming") return SK102_FIXTURE_NAMES.projects[2];
  if (alias === "completed") return SK102_FIXTURE_NAMES.projects[3];
  return `Fixture ${alias.replaceAll("-", " ")}`;
}

export function sk102ProjectPosition(alias: string, fallbackIndex: number): number {
  if (alias === "audio") return 0;
  if (alias === "due") return 10;
  if (alias === "upcoming") return 20;
  if (alias === "studioB") return 0;
  return 30 + fallbackIndex * 10;
}

async function seedBaseRows(
  db: Db,
  input: SeedInput,
  ids: FixtureIds,
  anchor: Date,
): Promise<Readonly<Record<"a" | "b" | "session" | "studioB", FixtureProduct>>> {
  const productA = fixtureProduct(ids.productA, ids.producerA, {
    name: SK102_FIXTURE_NAMES.products[0],
    position: 0,
    priceCents: 120_000,
    plans: [{ kind: "full" }, { kind: "split_50_50" }, { kind: "monthly", installments: 3 }],
  });
  const productB = fixtureProduct(ids.productB, ids.producerA, {
    name: SK102_FIXTURE_NAMES.products[1],
    position: 10,
    priceCents: 90_000,
    plans: [{ kind: "full" }, { kind: "monthly", installments: 3 }],
  });
  const session = fixtureProduct(ids.sessionProduct, ids.producerA, {
    name: SK102_FIXTURE_NAMES.products[2],
    position: 20,
    priceCents: 60_000,
    durationMin: 60,
    sessionCount: 12,
    kind: "session",
    plans: [{ kind: "full" }],
  });
  const studioB = fixtureProduct(ids.productBStudio, ids.producerB, {
    name: "Fixture Studio B Product",
    position: 0,
    priceCents: 70_000,
    plans: [{ kind: "full" }],
  });
  const uninvitedEmail = sk102SinkEmail(
    `uninvited+clerk_test_${input.slot}`,
    input.identity.sinkEmailDomain,
  );
  const sortableEmail = sk102SinkEmail(
    `sortable+clerk_test_${input.slot}`,
    input.identity.sinkEmailDomain,
  );

  await db.transaction(async (tx) => {
    await tx.insert(producers).values([
      {
        id: ids.producerA,
        clerkUserId: input.identity.producerClerkUserId,
        email: input.identity.producerEmail,
        displayName: SK102_FIXTURE_NAMES.studioA,
        slug: `sk102-${input.slot}-studio-a`,
        timezone: "Asia/Jerusalem",
        defaultCurrency: "USD",
        plan: "pro",
        autoConfirmBookings: false,
        serviceRoles: ["producer", "mixing", "mastering"],
        paymentDetails: {
          bankTransfer: "SK-102 isolated test ledger only",
          note: "No real payment processor is connected.",
        },
        genres: ["Pop", "Electronic"],
        releasedSummary: "Fixture releases",
        streamsSummary: "Fixture streams",
        responseHours: 24,
        createdAt: offset(anchor, -90),
        updatedAt: anchor,
      },
      {
        id: ids.producerB,
        clerkUserId: `sk102-studio-b-${input.slot}`,
        email: sk102SinkEmail(`studio-b+clerk_test_${input.slot}`, input.identity.sinkEmailDomain),
        displayName: SK102_FIXTURE_NAMES.studioB,
        slug: `sk102-${input.slot}-studio-b`,
        timezone: "Asia/Jerusalem",
        defaultCurrency: "USD",
        autoConfirmBookings: false,
        paymentDetails: { note: "SK-102 isolated test ledger only" },
        createdAt: offset(anchor, -80),
        updatedAt: anchor,
      },
    ]);

    await tx
      .insert(products)
      .values(
        [productA, productB, session, studioB].map((entry) =>
          fixtureProductInsertRow(entry, offset(anchor, -60)),
        ),
      );
    const archivedProduct = fixtureProduct(
      sk102FixtureUuid(input.slot, "product.archived"),
      ids.producerA,
      {
        name: "Fixture Archived Product",
        position: 30,
        priceCents: 50_000,
        active: false,
        archivedAt: offset(anchor, -5),
      },
    );
    await tx.insert(products).values(fixtureProductInsertRow(archivedProduct, offset(anchor, -70)));

    await tx.insert(clientContacts).values([
      {
        id: ids.artistA,
        producerId: ids.producerA,
        emailHash: emailHashFor(input.identity.artistEmail),
        email: input.identity.artistEmail,
        name: SK102_FIXTURE_NAMES.artist,
        clerkUserId: input.identity.artistClerkUserId,
        tags: ["fixture", "priority"],
        notes: "Primary SK-102 artist fixture",
        position: 20,
        firstSeenAt: offset(anchor, -70),
        lastSeenAt: anchor,
      },
      {
        id: ids.artistB,
        producerId: ids.producerB,
        emailHash: emailHashFor(input.identity.artistEmail),
        email: input.identity.artistEmail,
        name: SK102_FIXTURE_NAMES.artist,
        clerkUserId: input.identity.artistClerkUserId,
        tags: ["fixture", "second-studio"],
        position: 0,
        firstSeenAt: offset(anchor, -65),
        lastSeenAt: offset(anchor, -1),
      },
      {
        id: ids.uninvited,
        producerId: ids.producerA,
        emailHash: emailHashFor(uninvitedEmail),
        email: uninvitedEmail,
        name: SK102_FIXTURE_NAMES.uninvitedClient,
        clerkUserId: null,
        invitedAt: null,
        tags: ["fixture", "invite"],
        position: 0,
        firstSeenAt: offset(anchor, -4),
        lastSeenAt: offset(anchor, -4),
      },
      {
        id: sk102FixtureUuid(input.slot, "contact.sortable"),
        producerId: ids.producerA,
        emailHash: emailHashFor(sortableEmail),
        email: sortableEmail,
        name: "Fixture Sortable Client",
        tags: ["fixture"],
        position: 10,
        firstSeenAt: offset(anchor, -20),
        lastSeenAt: offset(anchor, -3),
      },
    ]);

    const projectRows = Object.entries(ids.projects).map(([alias, id], index) => {
      const studioBProject = alias === "studioB";
      const inviteProject = alias === "invite";
      return {
        id,
        producerId: studioBProject ? ids.producerB : ids.producerA,
        clientContactId: studioBProject ? ids.artistB : inviteProject ? ids.uninvited : ids.artistA,
        title: projectTitle(alias),
        clientName: inviteProject
          ? SK102_FIXTURE_NAMES.uninvitedClient
          : SK102_FIXTURE_NAMES.artist,
        clientEmail: inviteProject ? uninvitedEmail : input.identity.artistEmail,
        artistName: inviteProject
          ? SK102_FIXTURE_NAMES.uninvitedClient
          : SK102_FIXTURE_NAMES.artist,
        artistEmail: inviteProject ? uninvitedEmail : input.identity.artistEmail,
        notes: `SK-102 ${alias} lifecycle fixture`,
        position: sk102ProjectPosition(alias, index),
        workflowStage: index % 2 === 0 ? ("mixing" as const) : ("production" as const),
        deadlineAt: offset(anchor, 14 + index),
        lifecycleStatus: "waiting_for_payment" as const,
        lifecycleChangedAt: offset(anchor, -45 + index),
        createdAt: offset(anchor, -45 + index),
        updatedAt: anchor,
      };
    });
    await tx.insert(projects).values(projectRows);

    await tx.insert(availabilityBlocks).values(
      [ids.producerA, ids.producerB].flatMap((producerId) =>
        Array.from({ length: 7 }, (_, weekday) => ({
          id: sk102FixtureUuid(
            input.slot,
            `availability.${producerId === ids.producerA ? "a" : "b"}.${String(weekday)}`,
          ),
          producerId,
          weekday,
          startMin: 8 * 60,
          endMin: 20 * 60,
        })),
      ),
    );
    await tx.insert(producerNotes).values({
      id: sk102FixtureUuid(input.slot, "producer-note.a"),
      producerId: ids.producerA,
      body: "SK-102 deterministic browser fixture note",
      createdAt: offset(anchor, -1),
      updatedAt: offset(anchor, -1),
    });
  });
  return { a: productA, b: productB, session, studioB };
}

function proofRow(
  slot: Sk102FixtureSlot,
  alias: string,
  fixture: AcceptedFixture,
  object: Sk102ObjectIdentity,
  status: "pending" | "confirmed" | "rejected",
  at: Date,
) {
  const installment = fixture.installments[0];
  if (!installment) throw new Error("SK102_FIXTURE_INSTALLMENT_MISSING");
  return {
    id: sk102FixtureUuid(slot, `proof.${alias}`),
    purchaseId: fixture.purchaseId,
    installmentId: installment.id,
    producerId: fixture.producerId,
    projectId: fixture.projectId,
    clientContactId: fixture.clientContactId,
    amountCents: installment.amountCents,
    currency: installment.currency,
    storageBucket: "docs" as const,
    storageKey: object.key,
    objectEtag: object.objectEtag,
    originalFileName: SK102_FIXTURE_NAMES.pendingProofFile,
    contentType: "image/png",
    sizeBytes: object.sizeBytes,
    status,
    note: "SK-102 isolated payment proof",
    rejectionNote: status === "rejected" ? "Fixture proof needs a clearer reference." : null,
    confirmedAt: status === "confirmed" ? at : null,
    rejectedAt: status === "rejected" ? at : null,
    createdAt: offset(at, -1),
  };
}

async function seedPrivateOffersAndRequests(
  db: Db,
  input: SeedInput,
  ids: FixtureIds,
  product: FixtureProduct,
  anchor: Date,
): Promise<void> {
  const draft = buildPrivateOfferSnapshot({
    name: "Fixture Private Offer",
    tagline: "Isolated browser fixture",
    service: "mix",
    deliverables: ["Stereo WAV", "Stems"],
    cashPriceCents: 80_000,
    currency: "USD",
    taxMode: "tax_free",
    taxRatePct: 18,
    includedSongSpaces: 1,
    session: null,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: ROYALTIES,
    rights: ["No master royalty", "No composition royalty"],
    enabledPaymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
    agreementText: "SK-102 isolated private offer agreement.",
  });
  const statuses = ["draft", "sent", "accepted", "declined", "expired", "canceled"] as const;
  await db.insert(privateOffers).values(
    statuses.map((status, index) => ({
      id: sk102FixtureUuid(input.slot, `offer.${status}`),
      producerId: ids.producerA,
      clientContactId: ids.artistA,
      recipientEmail: input.identity.artistEmail,
      recipientEmailHash: emailHashFor(input.identity.artistEmail),
      targetProjectId: ids.projects.audio,
      productId: product.id,
      status,
      commercialDraft: draft,
      expiresAt: status === "expired" ? offset(anchor, -1) : offset(anchor, 30 + index),
      acceptedAt: status === "accepted" ? offset(anchor, -3) : null,
      createdAt: offset(anchor, -10 + index),
      updatedAt: offset(anchor, -3 + index),
    })),
  );

  const statusesWithoutConverted = ["pending", "approved", "declined"] as const;
  await db.insert(purchaseRequests).values(
    statusesWithoutConverted.map((status, index) => {
      const changedAt = offset(anchor, -6 + index);
      return {
        id: sk102FixtureUuid(input.slot, `standalone-request.${status}`),
        producerId: ids.producerA,
        clientContactId: ids.artistA,
        productId: product.id,
        projectId: ids.projects.audio,
        operationKey: `sk102:standalone-request:${status}`,
        operationDigest: requestDigest(`standalone-${status}`),
        refNumber: `SK102-REQUEST-${status.toUpperCase()}`,
        status,
        artistName: SK102_FIXTURE_NAMES.artist,
        artistEmail: input.identity.artistEmail,
        brief: `SK-102 ${status} request fixture`,
        statusChangedAt: changedAt,
        approvedAt: status === "approved" ? changedAt : null,
        declinedAt: status === "declined" ? changedAt : null,
        createdAt: offset(changedAt, -1),
        updatedAt: changedAt,
      };
    }),
  );
}

type BookingState = Readonly<{
  status: "pending_approval" | "confirmed" | "rejected" | "cancelled" | "completed" | "no_show";
  outcome: "reserved" | "cancelled_by_producer" | "cancelled_on_time" | "completed" | "no_show";
  terminalKind: "rejected" | "artist_cancelled" | "completed" | "no_show" | null;
  initialStatus: "pending_approval" | "confirmed";
}>;

const BOOKING_STATES: readonly BookingState[] = [
  {
    status: "pending_approval",
    outcome: "reserved",
    terminalKind: null,
    initialStatus: "pending_approval",
  },
  { status: "confirmed", outcome: "reserved", terminalKind: null, initialStatus: "confirmed" },
  {
    status: "rejected",
    outcome: "cancelled_by_producer",
    terminalKind: "rejected",
    initialStatus: "pending_approval",
  },
  {
    status: "cancelled",
    outcome: "cancelled_on_time",
    terminalKind: "artist_cancelled",
    initialStatus: "confirmed",
  },
  {
    status: "completed",
    outcome: "completed",
    terminalKind: "completed",
    initialStatus: "confirmed",
  },
  { status: "no_show", outcome: "no_show", terminalKind: "no_show", initialStatus: "confirmed" },
];

async function seedBookings(
  db: Db,
  input: SeedInput,
  ids: FixtureIds,
  fixture: AcceptedFixture,
  anchor: Date,
): Promise<string> {
  const [allowance] = await db
    .select()
    .from(purchaseSessionAllowances)
    .where(eq(purchaseSessionAllowances.purchaseId, fixture.purchaseId))
    .limit(1);
  if (!allowance) throw new Error("SK102_FIXTURE_SESSION_ALLOWANCE_MISSING");
  const bookingRows = BOOKING_STATES.map((state, index) => {
    const bookingId = sk102FixtureUuid(input.slot, `booking.${state.status}`);
    const startsAt = offset(anchor, index < 4 ? 7 + index : -4 + index);
    const changedAt = offset(startsAt, state.terminalKind ? -1 : -2);
    return {
      state,
      startsAt,
      changedAt,
      row: {
        id: bookingId,
        producerId: ids.producerA,
        projectId: fixture.projectId,
        purchaseId: fixture.purchaseId,
        sessionAllowanceId: allowance.id,
        artistName: SK102_FIXTURE_NAMES.artist,
        artistEmail: input.identity.artistEmail,
        artistPhone: "+972-50-000-0102",
        notes: `SK-102 ${state.status} booking fixture`,
        startsAt,
        durationMin: allowance.durationMin,
        operationKey: `sk102:booking:${state.status}`,
        operationDigest: digestCommercialSnapshot({
          kind: "sk102-booking-v1",
          status: state.status,
        }),
        status: state.status,
        statusChangedAt: changedAt,
        outcome: state.outcome,
        outcomeChangedAt: changedAt,
        createdAt: offset(startsAt, -5),
      },
    };
  });
  await db.transaction(async (tx) => {
    await tx.insert(bookings).values(bookingRows.map((entry) => entry.row));
    for (const entry of bookingRows) {
      const createdAt = offset(entry.row.createdAt, 1);
      await tx.insert(bookingTransitionEvents).values({
        id: sk102FixtureUuid(input.slot, `booking-event.${entry.state.status}.created`),
        bookingId: entry.row.id,
        producerId: ids.producerA,
        operationKey: "created",
        operationDigest: digestCommercialSnapshot({
          kind: "sk102-booking-event-v1",
          event: "created",
          status: entry.state.status,
        }),
        kind: "created",
        actorKind: "artist",
        actorId: input.identity.artistClerkUserId,
        fromStatus: null,
        toStatus: entry.state.initialStatus,
        fromOutcome: null,
        toOutcome: "reserved",
        oldStartsAt: null,
        newStartsAt: entry.startsAt,
        occurredAt: createdAt,
        createdAt,
      });
      if (entry.state.terminalKind) {
        await tx.insert(bookingTransitionEvents).values({
          id: sk102FixtureUuid(input.slot, `booking-event.${entry.state.status}.terminal`),
          bookingId: entry.row.id,
          producerId: ids.producerA,
          operationKey: "terminal",
          operationDigest: digestCommercialSnapshot({
            kind: "sk102-booking-event-v1",
            event: entry.state.terminalKind,
          }),
          kind: entry.state.terminalKind,
          actorKind: entry.state.terminalKind === "artist_cancelled" ? "artist" : "producer",
          actorId:
            entry.state.terminalKind === "artist_cancelled"
              ? input.identity.artistClerkUserId
              : input.identity.producerClerkUserId,
          fromStatus: entry.state.initialStatus,
          toStatus: entry.state.status,
          fromOutcome: "reserved",
          toOutcome: entry.state.outcome,
          oldStartsAt: entry.startsAt,
          newStartsAt: null,
          occurredAt: entry.changedAt,
          createdAt: entry.changedAt,
        });
      }
    }
  });
  return (
    bookingRows[0]?.row.id ??
    (() => {
      throw new Error("SK102_FIXTURE_BOOKING_MISSING");
    })()
  );
}

export async function assertSk102FixtureCoverage(db: Db, artistClerkUserId: string): Promise<void> {
  const result = await db.execute<{
    projectStates: number;
    purchaseStates: number;
    requestStates: number;
    offerStates: number;
    proofStates: number;
    bookingStates: number;
    artistStudios: number;
  }>(sql`
    select
      (select count(distinct lifecycle_status)::int from projects) as "projectStates",
      (select count(distinct lifecycle_status)::int from purchases) as "purchaseStates",
      (select count(distinct status)::int from purchase_requests) as "requestStates",
      (select count(distinct status)::int from private_offers) as "offerStates",
      (select count(distinct status)::int from payment_proofs) as "proofStates",
      (select count(distinct status)::int from bookings) as "bookingStates",
      (select count(distinct producer_id)::int from client_contacts where clerk_user_id = ${artistClerkUserId} and archived_at is null) as "artistStudios"
  `);
  const coverage = result.rows[0];
  if (
    coverage?.projectStates !== 5 ||
    coverage.purchaseStates !== 3 ||
    coverage.requestStates !== 4 ||
    coverage.offerStates !== 6 ||
    coverage.proofStates !== 3 ||
    coverage.bookingStates !== 6 ||
    coverage.artistStudios !== 2
  ) {
    throw new Error("SK102_FIXTURE_COVERAGE_INCOMPLETE");
  }
}

export async function seedSk102FixtureDatabase(
  db: Db,
  rawInput: SeedInput,
): Promise<Sk102DatabaseSeedResult> {
  const input = { ...rawInput, identity: rawInput.identity };
  const anchor = anchorTime(input.now ?? new Date());
  const ids = fixtureIds(input.slot);
  const product = await seedBaseRows(db, input, ids, anchor);
  const accept = (
    alias: string,
    projectId: string,
    fixtureProductRow: FixtureProduct,
    plan: PaymentPlan,
    days: number,
    producerId = ids.producerA,
    clientContactId = ids.artistA,
  ) =>
    createAcceptedFixture(db, {
      slot: input.slot,
      alias,
      producerId,
      clientContactId,
      artistClerkUserId: input.identity.artistClerkUserId,
      artistEmail: input.identity.artistEmail,
      projectId,
      product: fixtureProductRow,
      plan,
      acceptedAt: offset(anchor, days),
    });

  const audio = await accept(
    "audio-final",
    ids.projects.audio,
    product.a,
    { kind: "split_50_50" },
    -14,
  );
  const due = await accept(
    "due-monthly",
    ids.projects.due,
    product.b,
    { kind: "monthly", installments: 3 },
    -40,
  );
  const upcoming = await accept(
    "upcoming-monthly",
    ids.projects.upcoming,
    product.b,
    { kind: "monthly", installments: 3 },
    -10,
  );
  const proofConfirm = await accept(
    "proof-confirm",
    ids.projects.proofConfirm,
    product.a,
    { kind: "full" },
    -5,
  );
  const proofReject = await accept(
    "proof-reject",
    ids.projects.proofReject,
    product.a,
    { kind: "full" },
    -5,
  );
  const rejectedProof = await accept(
    "proof-replacement",
    ids.projects.rejectedProof,
    product.a,
    { kind: "full" },
    -7,
  );
  const artistUpload = await accept(
    "artist-proof-upload",
    ids.projects.artistUpload,
    product.a,
    { kind: "full" },
    -2,
  );
  const history = await accept(
    "paid-history",
    ids.projects.history,
    product.a,
    { kind: "full" },
    -30,
  );
  const canceled = await accept(
    "canceled",
    ids.projects.canceled,
    product.a,
    { kind: "full" },
    -20,
  );
  const paused = await accept(
    "paused",
    ids.projects.paused,
    product.b,
    { kind: "monthly", installments: 3 },
    -45,
  );
  const completed = await accept(
    "completed",
    ids.projects.completed,
    product.a,
    { kind: "full" },
    -60,
  );
  const booking = await accept(
    "booking-session",
    ids.projects.booking,
    product.session,
    { kind: "full" },
    -21,
  );
  const studioB = await accept(
    "studio-b",
    ids.projects.studioB,
    product.studioB,
    { kind: "full" },
    -12,
    ids.producerB,
    ids.artistB,
  );

  for (const fixture of [audio, due, upcoming, paused, completed, booking, studioB]) {
    await payInstallment(
      db,
      fixture,
      1,
      input.identity.producerClerkUserId,
      offset(fixture.acceptedAt, 1),
    );
  }
  await reconcilePurchaseLedger(purchaseLedgerRepository(db), {
    producerId: due.producerId,
    purchaseId: due.purchaseId,
    asOf: anchor,
  });
  await reconcilePurchaseLedger(purchaseLedgerRepository(db), {
    producerId: upcoming.producerId,
    purchaseId: upcoming.purchaseId,
    asOf: anchor,
  });
  await reconcilePurchaseLedger(purchaseLedgerRepository(db), {
    producerId: paused.producerId,
    purchaseId: paused.purchaseId,
    asOf: anchor,
  });
  await pauseProjectForOverdueInstallment(purchaseLedgerRepository(db), {
    producerId: paused.producerId,
    purchaseId: paused.purchaseId,
    operationKey: "sk102:pause-overdue",
    reason: "SK-102 overdue fixture",
    actorId: input.identity.producerClerkUserId,
    changedAt: offset(anchor, -1),
  });
  await cancelPurchase(purchaseLedgerRepository(db), {
    producerId: canceled.producerId,
    purchaseId: canceled.purchaseId,
    operationKey: "sk102:cancel-purchase",
    reason: "SK-102 canceled fixture",
    actorId: input.identity.producerClerkUserId,
    canceledAt: offset(anchor, -19),
  });
  await db
    .update(projects)
    .set({
      lifecycleStatus: "canceled",
      lifecycleChangedAt: offset(anchor, -19),
      updatedAt: offset(anchor, -19),
    })
    .where(eq(projects.id, canceled.projectId));
  await db
    .update(projects)
    .set({
      lifecycleStatus: "completed",
      lifecycleChangedAt: offset(anchor, -2),
      updatedAt: offset(anchor, -2),
    })
    .where(eq(projects.id, completed.projectId));

  const pendingConfirmRow = proofRow(
    input.slot,
    "pending-confirm",
    proofConfirm,
    input.objects.pendingProofConfirm,
    "pending",
    offset(anchor, -2),
  );
  const pendingRejectRow = proofRow(
    input.slot,
    "pending-reject",
    proofReject,
    input.objects.pendingProofReject,
    "pending",
    offset(anchor, -2),
  );
  const rejectedRow = proofRow(
    input.slot,
    "rejected",
    rejectedProof,
    input.objects.rejectedProof,
    "rejected",
    offset(anchor, -3),
  );
  const confirmedRow = proofRow(
    input.slot,
    "confirmed",
    history,
    input.objects.confirmedProof,
    "confirmed",
    offset(anchor, -25),
  );
  await db
    .insert(paymentProofs)
    .values([pendingConfirmRow, pendingRejectRow, rejectedRow, confirmedRow]);
  await db
    .update(purchaseInstallments)
    .set({ status: "awaiting_review", updatedAt: offset(anchor, -2) })
    .where(eq(purchaseInstallments.id, pendingConfirmRow.installmentId));
  await db
    .update(purchaseInstallments)
    .set({ status: "awaiting_review", updatedAt: offset(anchor, -2) })
    .where(eq(purchaseInstallments.id, pendingRejectRow.installmentId));
  await payInstallment(
    db,
    history,
    1,
    input.identity.producerClerkUserId,
    offset(anchor, -24),
    confirmedRow.id,
  );

  const audioTrackId = sk102FixtureUuid(input.slot, "audio.track.final");
  const audioVersionId = sk102FixtureUuid(input.slot, "audio.version.final");
  const secondaryTrackId = sk102FixtureUuid(input.slot, "secondary.track.final");
  const secondaryVersionId = sk102FixtureUuid(input.slot, "secondary.version.final");
  await db.transaction(async (tx) => {
    await tx.insert(projectTracks).values([
      {
        id: audioTrackId,
        projectId: audio.projectId,
        purchaseId: audio.purchaseId,
        title: SK102_FIXTURE_NAMES.audioSong,
        artist: SK102_FIXTURE_NAMES.artist,
        position: 0,
        workflowStage: "mastering",
        createdAt: offset(anchor, -13),
      },
      {
        id: secondaryTrackId,
        projectId: studioB.projectId,
        purchaseId: studioB.purchaseId,
        title: "Fixture Studio B Song",
        artist: SK102_FIXTURE_NAMES.artist,
        position: 0,
        workflowStage: "mixing",
        createdAt: offset(anchor, -11),
      },
    ]);
    await tx.insert(trackVersions).values([
      {
        id: audioVersionId,
        trackId: audioTrackId,
        purchaseId: audio.purchaseId,
        producerId: ids.producerA,
        label: "Final mix",
        audioUrl: `/api/audio/stream/${audioVersionId}`,
        durationMs: 250,
        audioR2Key: input.objects.audio.key,
        sizeBytes: input.objects.audio.sizeBytes,
        audioObjectEtag: input.objects.audio.objectEtag,
        audioIdentityFingerprint: computeStoredAudioIdentityFingerprint(input.objects.audio),
        peaks: [0.1, 0.35, 0.65, 0.4, 0.2],
        description: "SK-102 exact final-version approval fixture",
        uploadedAt: offset(anchor, -2),
        producerMarkedFinalAt: offset(anchor, -1),
      },
      {
        id: secondaryVersionId,
        trackId: secondaryTrackId,
        purchaseId: studioB.purchaseId,
        producerId: ids.producerB,
        label: "Studio B mix",
        audioUrl: `/api/audio/stream/${secondaryVersionId}`,
        durationMs: 250,
        audioR2Key: input.objects.secondaryAudio.key,
        sizeBytes: input.objects.secondaryAudio.sizeBytes,
        audioObjectEtag: input.objects.secondaryAudio.objectEtag,
        audioIdentityFingerprint: computeStoredAudioIdentityFingerprint(
          input.objects.secondaryAudio,
        ),
        peaks: [0.2, 0.5, 0.3],
        uploadedAt: offset(anchor, -2),
      },
    ]);
    await tx.insert(trackComments).values({
      id: sk102FixtureUuid(input.slot, "audio.comment"),
      versionId: audioVersionId,
      producerId: ids.producerA,
      authorName: SK102_FIXTURE_NAMES.artist,
      authorEmail: input.identity.artistEmail,
      body: "SK-102 unresolved timestamped comment",
      timestampMs: 100,
      fromProducer: false,
      createdAt: offset(anchor, -1),
    });
    const portfolioId = sk102FixtureUuid(input.slot, "portfolio.audio");
    await tx.insert(portfolioTracks).values({
      id: portfolioId,
      producerId: ids.producerA,
      title: "Fixture Portfolio Track",
      artist: SK102_FIXTURE_NAMES.artist,
      audioUrl: `/api/audio/public/portfolio/${portfolioId}`,
      audioR2Key: input.objects.audio.key,
      sizeBytes: input.objects.audio.sizeBytes,
      durationMs: 250,
      isPublicSample: true,
      position: 0,
      createdAt: offset(anchor, -10),
    });
  });

  await seedPrivateOffersAndRequests(db, input, ids, product.a, anchor);
  const pendingBookingId = await seedBookings(db, input, ids, booking, anchor);
  await db.insert(notifications).values([
    {
      id: sk102FixtureUuid(input.slot, "notification.proof"),
      producerId: ids.producerA,
      kind: "proof_submitted",
      title: "Fixture proof needs review",
      body: "SK-102 pending proof",
      projectId: proofConfirm.projectId,
      purchaseId: proofConfirm.purchaseId,
      createdAt: offset(anchor, -2),
    },
    {
      id: sk102FixtureUuid(input.slot, "notification.booking"),
      producerId: ids.producerA,
      kind: "booking_requested",
      title: "Fixture booking request",
      body: "SK-102 pending booking",
      bookingId: pendingBookingId,
      projectId: booking.projectId,
      createdAt: offset(anchor, -1),
    },
  ]);

  await assertSk102FixtureCoverage(db, input.identity.artistClerkUserId);
  const reminderInstallment = due.installments.find((entry) => entry.position === 2);
  if (!reminderInstallment) throw new Error("SK102_FIXTURE_REMINDER_INSTALLMENT_MISSING");
  const reminderLabel = purchaseInstallmentDueLabel({ kind: "monthly", installments: 3 }, 2);
  return {
    producerId: ids.producerA,
    audioVersionId,
    pendingProofConfirmId: pendingConfirmRow.id,
    pendingProofRejectId: pendingRejectRow.id,
    artistProofPurchaseId: artistUpload.purchaseId,
    rejectedProofPurchaseId: rejectedProof.purchaseId,
    pendingBookingId,
    reminderButtonName: `Send payment reminder for purchase SK102-DUE-MONTHLY, installment 2: ${reminderLabel}`,
  };
}
