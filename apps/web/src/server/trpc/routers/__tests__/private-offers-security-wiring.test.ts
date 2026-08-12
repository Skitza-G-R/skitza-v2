import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(join(__dirname, "../private-offers.ts"), "utf8");
const persistenceSource = readFileSync(
  join(__dirname, "../../../domain/private-offers/db.ts"),
  "utf8",
);
const connectionSource = readFileSync(
  join(__dirname, "../../../contacts/connect-artist.ts"),
  "utf8",
);
const joinContinuationSource = readFileSync(
  join(__dirname, "../../../contacts/join-continuation.ts"),
  "utf8",
);

function compact(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function implementationOf(name: string): string {
  const marker = `function ${name}(`;
  const start = persistenceSource.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name}`);
  const nextExport = persistenceSource.indexOf("\nexport ", start + marker.length);
  return persistenceSource.slice(start, nextExport < 0 ? undefined : nextExport);
}

function procedureFor(name: string): string | undefined {
  return new RegExp(`\\b${name}:\\s*(producerProcedure|artistProcedure)\\b`).exec(
    routerSource,
  )?.[1];
}

describe("private-offer router security wiring", () => {
  it("keeps producer writes/history behind producerProcedure", () => {
    for (const endpoint of [
      "recipients",
      "projectOptions",
      "producerList",
      "send",
      "update",
      "cancel",
    ]) {
      expect(procedureFor(endpoint), endpoint).toBe("producerProcedure");
    }
  });

  it("scopes existing-project option metadata and exact balances to one producer client", () => {
    const options = compact(implementationOf("listPrivateOfferProjectOptions"));

    expect(options).toContain("eq(projects.producerId, input.producerId)");
    expect(options).toContain("eq(projects.clientContactId, input.clientContactId)");
    expect(options).toContain(
      'inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"])',
    );
    expect(options).toContain("count(${projectTracks.id})::int");
    expect(options).toContain("getClientMoneyLedger(clientMoneyRepository(db), input)");
    expect(options).toContain("remainingCents: total.remainingCents");
  });

  it("keeps artist visibility and decisions behind artistProcedure", () => {
    for (const endpoint of ["artistList", "artistGet", "reject", "accept"]) {
      expect(procedureFor(endpoint), endpoint).toBe("artistProcedure");
    }
  });

  it("binds every artist read/action to the stable, active client contact", () => {
    const stableArtistJoin = compact(`
      eq(clientContacts.id, privateOffers.clientContactId),
      eq(clientContacts.producerId, privateOffers.producerId),
      eq(clientContacts.clerkUserId, input.clerkUserId),
      inArray(privateOffers.recipientEmailHash, input.verifiedEmailHashes),
      isNull(clientContacts.archivedAt)
    `);
    const occurrences = compact(persistenceSource).split(stableArtistJoin).length - 1;

    // list, detail, and the locked mutation read must independently enforce
    // offer/contact id, tenant, stable Clerk owner, verified invited email,
    // and artist archive state.
    expect(occurrences).toBe(3);
  });

  it("freezes the invited email and connects verified secondary-email recipients", () => {
    expect(compact(persistenceSource)).toContain(
      "recipientEmail: recipient.email, recipientEmailHash: emailHashFor(recipient.email)",
    );
    expect(compact(connectionSource)).toContain(
      "inArray(privateOffers.recipientEmailHash, verifiedEmailHashes)",
    );
    expect(joinContinuationSource).toContain("verifiedEmailHashesFromUser");
    expect(joinContinuationSource).toContain("verifiedEmailHashes,");
  });

  it("keeps list pages available without a verified email while actions fail closed", () => {
    expect(
      compact(routerSource).split("requireVerifiedArtistEmailHashes(ctx.clerkUserId)").length - 1,
    ).toBe(3);
    expect(compact(routerSource)).toContain(
      "const verifiedEmailHashes = await currentVerifiedEmailHashes(ctx.clerkUserId); if (verifiedEmailHashes.length === 0) return { offers: [] };",
    );
  });

  it("maps unknown failures generically", () => {
    expect(routerSource).not.toContain("throw error;");
    expect(compact(routerSource)).toContain(
      'code: "INTERNAL_SERVER_ERROR", message: "This offer is unavailable."',
    );
  });

  it("shows artists only sent offers strictly before expiry", () => {
    const list = compact(implementationOf("listArtistPrivateOffers"));
    const detail = compact(implementationOf("getArtistPrivateOffer"));

    expect(list).toContain('eq(privateOffers.status, "sent")');
    expect(list).toContain("gt(privateOffers.expiresAt, input.now)");
    expect(list).toContain(
      "rows.filter((row) => !isPrivateOfferExpired(row.expiresAt, input.now))",
    );
    expect(detail).toContain("eq(privateOffers.id, input.offerId)");
    expect(detail).toContain('eq(privateOffers.status, "sent")');
    expect(detail).toContain("gt(privateOffers.expiresAt, input.now)");
    expect(detail).toContain("isPrivateOfferExpired(row.expiresAt, input.now)");
    expect(detail).toContain("notFound()");
  });
});

describe("private-offer transition concurrency wiring", () => {
  it("deduplicates send by a client UUID without crossing producer ownership", () => {
    const create = compact(implementationOf("createPrivateOffer"));
    const replay = compact(implementationOf("assertExactPrivateOfferReplay"));
    const router = compact(routerSource);

    expect(router).toContain("offerId: z.string().uuid()");
    expect(router).toContain("sourceProductId: z.string().uuid().optional()");
    expect(create).toContain("id: input.offerId");
    expect(create).toContain("eq(products.producerId, input.producerId)");
    expect(create).toContain("productId: sourceProductId");
    expect(create).toContain("onConflictDoNothing({ target: privateOffers.id })");
    expect(replay).toContain("existing.producerId !== input.producerId");
    expect(replay).toContain("digestCommercialSnapshot(existing.commercialDraft)");
    expect(replay).toContain("existing.expiresAt.getTime() === input.expiresAt.getTime()");
    expect(create.match(/assertExactPrivateOfferReplay\(/g)).toHaveLength(2);
    expect(router).toContain("if (result.created)");
    expect(router).toContain("await sendPrivateOfferNotificationEmail");
  });

  it("locks producer and artist offer rows before mutable transitions", () => {
    expect(compact(implementationOf("lockProducerOffer"))).toContain('.for("update")');
    expect(compact(implementationOf("lockArtistOffer"))).toContain('.for("update")');

    for (const operation of [
      "updatePrivateOffer",
      "cancelPrivateOffer",
      "rejectPrivateOffer",
      "acceptPrivateOffer",
    ]) {
      expect(compact(implementationOf(operation)), operation).toContain(
        "db.transaction(async (tx)",
      );
    }
  });

  it("uses expected-version checks and compare-and-set status guards", () => {
    const update = compact(implementationOf("updatePrivateOffer"));
    const cancel = compact(implementationOf("cancelPrivateOffer"));
    const reject = compact(implementationOf("rejectPrivateOffer"));
    const accept = compact(implementationOf("acceptPrivateOffer"));

    expect(update).toContain("sameInstant(offer.updatedAt, input.expectedUpdatedAt)");
    expect(update).toContain('eq(privateOffers.status, "sent")');
    expect(cancel).toContain('inArray(privateOffers.status, ["draft", "sent"])');
    expect(reject).toContain('eq(privateOffers.status, "sent")');
    expect(accept).toContain("sameInstant(offer.updatedAt, input.expectedUpdatedAt)");
    expect(accept).toContain("project.title !== input.expectedTargetProjectTitle");
    expect(accept).toContain("eq(privateOffers.targetProjectId, projectId)");
    expect(accept).toContain('eq(privateOffers.status, "sent")');
  });

  it("replays acceptance safely with one deterministic purchase operation key", () => {
    const accept = compact(implementationOf("acceptPrivateOffer"));

    expect(accept).toContain('if (offer.status === "accepted")');
    expect(accept).toContain("assertAcceptanceReplay(existing, input)");
    expect(accept).toContain("where(eq(purchases.privateOfferId, offer.id))");
    expect(accept).toContain("operationKey: `private-offer:${offer.id}:accept:v1`");
  });

  it("blocks a new acceptance for a producer-archived client without breaking accepted replay", () => {
    const lockArtist = compact(implementationOf("lockArtistOffer"));
    const accept = compact(implementationOf("acceptPrivateOffer"));
    expect(lockArtist).toContain("producerArchivedAt: clientContacts.producerArchivedAt");
    const replay = accept.indexOf('if (offer.status === "accepted")');
    const archivedGuard = accept.indexOf("producerArchivedAt !== null");
    const projectInsert = accept.indexOf(".insert(projects)");
    const purchaseAcceptance = accept.indexOf("acceptPurchase(");
    expect(replay).toBeGreaterThanOrEqual(0);
    expect(archivedGuard).toBeGreaterThan(replay);
    expect(projectInsert).toBeGreaterThan(archivedGuard);
    expect(purchaseAcceptance).toBeGreaterThan(archivedGuard);
  });

  it("serializes and enforces the studio-wide active-purchase guard before acceptance", () => {
    const accept = compact(implementationOf("acceptPrivateOffer"));

    expect(accept).toContain(
      "pg_advisory_xact_lock(hashtextextended(${`artist-purchase:${input.clerkUserId}:${offer.producerId}`}, 0))",
    );
    expect(accept).toContain(
      "loadArtistPurchaseGuard(tx, { clerkUserId: input.clerkUserId, producerId: offer.producerId",
    );
    expect(accept).toContain("if (activePurchase.blocked)");
    expect(accept.indexOf("loadArtistPurchaseGuard")).toBeLessThan(
      accept.indexOf("insert(projects)"),
    );
    expect(accept.indexOf("loadArtistPurchaseGuard")).toBeLessThan(
      accept.indexOf("acceptPurchase("),
    );
    expect(compact(routerSource)).toContain(
      'if (error.code === "ACTIVE_PURCHASE") { throw new TRPCError({ code: "CONFLICT", message: error.message }); }',
    );
  });
});
