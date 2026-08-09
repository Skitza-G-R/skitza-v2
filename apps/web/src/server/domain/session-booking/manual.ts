import {
  and,
  asc,
  availabilityBlackouts,
  availabilityBlocks,
  bookings,
  clientContacts,
  eq,
  inArray,
  isNull,
  producers,
  projects,
  purchases,
  purchaseSessionAllowances,
  type Db,
  type PurchaseCommercialSnapshot,
} from "@skitza/db";

import {
  SessionBookingDomainError,
  assertSessionBookingAllowed,
  classifySessionSlot,
  sessionBillingOptions,
  sessionUseConsumesAllowance,
  type SessionBookingBillingTreatment,
  type SessionSlotIssue,
  type SessionUseOutcome,
} from "~/server/booking";

export type ProducerManualProjectEligibility =
  | "eligible"
  | "no_active_session_package"
  | "multiple_active_session_packages";

type AllowanceUse = Readonly<{
  allowanceUseId: string;
  outcome: SessionUseOutcome;
  billingTreatment: SessionBookingBillingTreatment;
}>;

export type ProducerManualProjectOption = Readonly<{
  id: string;
  title: string;
  eligibility: ProducerManualProjectEligibility;
  productName: string | null;
  defaultTitle: string | null;
  durationMin: number | null;
  remainingIncluded: number | null;
  defaultTreatment: "included" | null;
  allowedTreatments: readonly SessionBookingBillingTreatment[];
}>;

export type ProducerManualClientOption = Readonly<{
  id: string;
  name: string;
  email: string;
  projects: readonly ProducerManualProjectOption[];
}>;

export type ProducerManualSessionOptions = Readonly<{
  studioTimeZone: string;
  clients: readonly ProducerManualClientOption[];
}>;

type ManualEntitlement = Readonly<{
  purchaseId: string;
  sessionAllowanceId: string;
  productName: string;
  defaultTitle: string;
  durationMin: number;
  bufferMinutes: number;
  minLeadHours: number;
  allowanceKind: "fixed" | "unlimited";
  sessionLimit: number | null;
  existingUses: readonly AllowanceUse[];
}>;

export type ProducerManualProjectOptionInternal = ProducerManualProjectOption &
  Readonly<{ clientContactId: string; entitlement: ManualEntitlement | null }>;

export type ProducerManualSessionOptionsInternal = Readonly<{
  studioTimeZone: string;
  clients: readonly Readonly<{
    id: string;
    name: string;
    email: string;
    projects: readonly ProducerManualProjectOptionInternal[];
  }>[];
}>;

function snapshotProductName(snapshot: PurchaseCommercialSnapshot, fallback: string): string {
  return snapshot.productOrOfferName.trim() || fallback.trim() || "Session";
}

/**
 * Producer-only read model for the manual-session form.
 *
 * A project may own several active purchases. The browser is intentionally
 * not allowed to pick an allowance, so more than one active bookable
 * entitlement is shown as unavailable instead of silently consuming the
 * wrong purchase.
 */
export async function listProducerManualSessionOptions(
  db: Db,
  producerId: string,
): Promise<ProducerManualSessionOptionsInternal> {
  const [producerRows, contacts, projectRows, entitlementRows] = await Promise.all([
    db
      .select({ timeZone: producers.timezone })
      .from(producers)
      .where(eq(producers.id, producerId))
      .limit(1),
    db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
      })
      .from(clientContacts)
      .where(and(eq(clientContacts.producerId, producerId), isNull(clientContacts.archivedAt)))
      .orderBy(asc(clientContacts.name), asc(clientContacts.id)),
    db
      .select({
        id: projects.id,
        clientContactId: projects.clientContactId,
        title: projects.title,
      })
      .from(projects)
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, projects.clientContactId),
          eq(clientContacts.producerId, projects.producerId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .where(and(eq(projects.producerId, producerId), eq(projects.lifecycleStatus, "active")))
      .orderBy(asc(projects.title), asc(projects.id)),
    db
      .select({
        projectId: projects.id,
        clientContactId: projects.clientContactId,
        projectTitle: projects.title,
        purchaseId: purchases.id,
        commercialSnapshot: purchases.commercialSnapshot,
        sessionAllowanceId: purchaseSessionAllowances.id,
        allowanceKind: purchaseSessionAllowances.kind,
        sessionLimit: purchaseSessionAllowances.sessionLimit,
        durationMin: purchaseSessionAllowances.durationMin,
        bufferMinutes: purchaseSessionAllowances.bufferMinutes,
        minLeadHours: purchaseSessionAllowances.minLeadHours,
      })
      .from(purchaseSessionAllowances)
      .innerJoin(
        purchases,
        and(
          eq(purchases.id, purchaseSessionAllowances.purchaseId),
          eq(purchases.producerId, purchaseSessionAllowances.producerId),
        ),
      )
      .innerJoin(
        projects,
        and(
          eq(projects.id, purchases.projectId),
          eq(projects.producerId, purchases.producerId),
          eq(projects.clientContactId, purchases.clientContactId),
        ),
      )
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, purchases.clientContactId),
          eq(clientContacts.producerId, purchases.producerId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .where(
        and(
          eq(purchases.producerId, producerId),
          eq(purchases.lifecycleStatus, "active"),
          eq(projects.lifecycleStatus, "active"),
          eq(purchaseSessionAllowances.bookingEnabledSnapshot, true),
          isNull(purchaseSessionAllowances.closedAt),
        ),
      ),
  ]);

  const producer = producerRows[0];
  if (!producer) {
    throw new SessionBookingDomainError("NOT_FOUND", "The producer was not found");
  }

  const allowanceIds = entitlementRows.map((row) => row.sessionAllowanceId);
  const useRows =
    allowanceIds.length === 0
      ? []
      : await db
          .select({
            sessionAllowanceId: bookings.sessionAllowanceId,
            allowanceUseId: bookings.allowanceUseId,
            outcome: bookings.outcome,
            billingTreatment: bookings.billingTreatment,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.producerId, producerId),
              inArray(bookings.sessionAllowanceId, allowanceIds),
            ),
          );

  const usesByAllowance = new Map<string, AllowanceUse[]>();
  for (const use of useRows) {
    const list = usesByAllowance.get(use.sessionAllowanceId) ?? [];
    list.push({
      allowanceUseId: use.allowanceUseId,
      outcome: use.outcome,
      billingTreatment: use.billingTreatment,
    });
    usesByAllowance.set(use.sessionAllowanceId, list);
  }

  const entitlementsByProject = new Map<string, ManualEntitlement[]>();
  for (const row of entitlementRows) {
    const productName = snapshotProductName(row.commercialSnapshot, row.projectTitle);
    const entitlement: ManualEntitlement = {
      purchaseId: row.purchaseId,
      sessionAllowanceId: row.sessionAllowanceId,
      productName,
      defaultTitle: productName,
      durationMin: row.durationMin,
      bufferMinutes: row.bufferMinutes,
      minLeadHours: row.minLeadHours,
      allowanceKind: row.allowanceKind,
      sessionLimit: row.sessionLimit,
      existingUses: usesByAllowance.get(row.sessionAllowanceId) ?? [],
    };
    const list = entitlementsByProject.get(row.projectId) ?? [];
    list.push(entitlement);
    entitlementsByProject.set(row.projectId, list);
  }

  const projectsByClient = new Map<string, ProducerManualProjectOptionInternal[]>();
  for (const project of projectRows) {
    const entitlements = entitlementsByProject.get(project.id) ?? [];
    const entitlement = entitlements.length === 1 ? (entitlements[0] ?? null) : null;
    const eligibility: ProducerManualProjectEligibility =
      entitlements.length === 0
        ? "no_active_session_package"
        : entitlements.length === 1
          ? "eligible"
          : "multiple_active_session_packages";
    const billing = entitlement
      ? sessionBillingOptions({
          allowanceKind: entitlement.allowanceKind,
          sessionLimit: entitlement.sessionLimit,
          existingUses: entitlement.existingUses,
        })
      : null;
    const option: ProducerManualProjectOptionInternal = {
      id: project.id,
      clientContactId: project.clientContactId,
      title: project.title,
      eligibility,
      productName: entitlement?.productName ?? null,
      defaultTitle: entitlement?.defaultTitle ?? null,
      durationMin: entitlement?.durationMin ?? null,
      remainingIncluded: billing?.remainingIncluded ?? null,
      defaultTreatment: billing?.defaultTreatment ?? null,
      allowedTreatments: billing?.allowedTreatments ?? [],
      entitlement,
    };
    const list = projectsByClient.get(project.clientContactId) ?? [];
    list.push(option);
    projectsByClient.set(project.clientContactId, list);
  }

  return {
    studioTimeZone: producer.timeZone,
    clients: contacts.map((contact) => ({
      ...contact,
      projects: projectsByClient.get(contact.id) ?? [],
    })),
  };
}

export function publicProducerManualSessionOptions(
  options: ProducerManualSessionOptionsInternal,
): ProducerManualSessionOptions {
  return {
    studioTimeZone: options.studioTimeZone,
    clients: options.clients.map((client) => ({
      id: client.id,
      name: client.name,
      email: client.email,
      projects: client.projects.map(({ clientContactId: _clientContactId, entitlement, ...project }) => {
        void _clientContactId;
        void entitlement;
        return project;
      }),
    })),
  };
}

export function resolveProducerManualProject(
  options: ProducerManualSessionOptionsInternal,
  input: { clientId: string; projectId: string },
): ProducerManualProjectOptionInternal & { entitlement: ManualEntitlement } {
  const client = options.clients.find((candidate) => candidate.id === input.clientId);
  const project = client?.projects.find((candidate) => candidate.id === input.projectId);
  if (!client || !project || project.clientContactId !== client.id) {
    throw new SessionBookingDomainError("NOT_FOUND", "The client project was not found");
  }
  if (project.eligibility === "multiple_active_session_packages") {
    throw new SessionBookingDomainError(
      "INVALID_ALLOWANCE",
      "This project has more than one active session package",
    );
  }
  if (project.eligibility !== "eligible" || !project.entitlement) {
    throw new SessionBookingDomainError(
      "INVALID_ALLOWANCE",
      "This project does not have an active bookable session package",
    );
  }
  return { ...project, entitlement: project.entitlement };
}

export type PreviewProducerManualSessionInput = Readonly<{
  producerId: string;
  clientId: string;
  projectId: string;
  startsAt: Date;
  title?: string;
  billingTreatment?: SessionBookingBillingTreatment;
  now?: Date;
}>;

export type PreviewProducerManualSessionResult = Readonly<{
  startsAt: Date;
  title: string;
  productName: string;
  durationMin: number;
  remainingIncluded: number | null;
  billingTreatment: SessionBookingBillingTreatment;
  allowedTreatments: readonly SessionBookingBillingTreatment[];
  hardConflicts: readonly SessionSlotIssue[];
  warnings: readonly SessionSlotIssue[];
  internal: Readonly<{
    purchaseId: string;
    sessionAllowanceId: string;
  }>;
}>;

export async function previewProducerManualSession(
  db: Db,
  input: PreviewProducerManualSessionInput,
): Promise<PreviewProducerManualSessionResult> {
  const options = await listProducerManualSessionOptions(db, input.producerId);
  const project = resolveProducerManualProject(options, input);
  const entitlement = project.entitlement;
  const now = input.now ? new Date(input.now) : new Date();
  const title = (input.title ?? entitlement.defaultTitle).trim();
  if (!title) {
    throw new SessionBookingDomainError("INVALID_SLOT", "Enter a session title");
  }
  const billing = sessionBillingOptions({
    allowanceKind: entitlement.allowanceKind,
    sessionLimit: entitlement.sessionLimit,
    existingUses: entitlement.existingUses,
  });
  const billingTreatment = input.billingTreatment ?? billing.defaultTreatment;
  if (!billingTreatment) {
    throw new SessionBookingDomainError(
      "BILLING_TREATMENT_INVALID",
      "Choose complimentary or billable extra for this session",
    );
  }

  assertSessionBookingAllowed({
    purchaseLifecycleStatus: "active",
    projectLifecycleStatus: "active",
    allowance: {
      bookingEnabledSnapshot: true,
      kind: entitlement.allowanceKind,
      sessionLimit: entitlement.sessionLimit,
      durationMin: entitlement.durationMin,
      minLeadHours: entitlement.minLeadHours,
      closedAt: null,
    },
    existingOutcomes: entitlement.existingUses
      .filter((use) => sessionUseConsumesAllowance(use.outcome, use.billingTreatment))
      .map((use) => use.outcome),
    existingUses: entitlement.existingUses,
    billingTreatment,
    requestedDurationMin: entitlement.durationMin,
    startsAt: input.startsAt,
    now,
  });

  const [producerRows, blocks, blackouts, schedule] = await Promise.all([
    db
      .select({
        timeZone: producers.timezone,
        maxSessionsPerDay: producers.maxSessionsPerDay,
      })
      .from(producers)
      .where(eq(producers.id, input.producerId))
      .limit(1),
    db
      .select({
        weekday: availabilityBlocks.weekday,
        startMin: availabilityBlocks.startMin,
        endMin: availabilityBlocks.endMin,
      })
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.producerId, input.producerId)),
    db
      .select({ startDate: availabilityBlackouts.startDate, endDate: availabilityBlackouts.endDate })
      .from(availabilityBlackouts)
      .where(eq(availabilityBlackouts.producerId, input.producerId)),
    db
      .select({
        id: bookings.id,
        startsAt: bookings.startsAt,
        durationMin: bookings.durationMin,
        bufferMinutes: purchaseSessionAllowances.bufferMinutes,
      })
      .from(bookings)
      .innerJoin(
        purchaseSessionAllowances,
        and(
          eq(purchaseSessionAllowances.id, bookings.sessionAllowanceId),
          eq(purchaseSessionAllowances.purchaseId, bookings.purchaseId),
          eq(purchaseSessionAllowances.producerId, bookings.producerId),
        ),
      )
      .where(
        and(
          eq(bookings.producerId, input.producerId),
          inArray(bookings.status, ["pending_approval", "confirmed"]),
        ),
      ),
  ]);
  const producer = producerRows[0];
  if (!producer) throw new SessionBookingDomainError("NOT_FOUND", "The producer was not found");
  const issues = classifySessionSlot({
    actor: "producer",
    startsAt: input.startsAt,
    durationMin: entitlement.durationMin,
    bufferMinutes: entitlement.bufferMinutes,
    producerTimeZone: producer.timeZone,
    availabilityBlocks: blocks,
    blackouts,
    existingBookings: schedule,
    maxSessionsPerDay: producer.maxSessionsPerDay,
    minLeadHours: entitlement.minLeadHours,
    now,
  });

  return {
    startsAt: input.startsAt,
    title,
    productName: entitlement.productName,
    durationMin: entitlement.durationMin,
    remainingIncluded: billing.remainingIncluded,
    billingTreatment,
    allowedTreatments: billing.allowedTreatments,
    hardConflicts: issues.filter((issue) => issue.severity === "hard_conflict"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
    internal: {
      purchaseId: entitlement.purchaseId,
      sessionAllowanceId: entitlement.sessionAllowanceId,
    },
  };
}
