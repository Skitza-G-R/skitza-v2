import type { PaymentPlan, PurchaseCommercialSnapshot } from "@skitza/db";

export const IMPORT_NOTICE = "Added by producer from an existing agreement" as const;
export const PAYMENT_NOTICE = "Confirmed by producer" as const;
const MAX_POSTGRES_INTEGER_CENTS = 2_147_483_647;

export type ImportTaxMode = "tax_free" | "tax_included" | "tax_added";
export type ImportPlanKind = "full" | "split_50_50" | "monthly";
export type ImportRoyaltyMode = "none" | "percentage" | "agreement";
export type ImportRevisionMode = "none" | "fixed" | "unlimited";

export type ExistingClientOption = Readonly<{
  id: string;
  name: string;
  email: string;
}>;

export type ArchivedClientOption = ExistingClientOption;

export type StoreTemplateOption = Readonly<{
  id: string;
  name: string;
  kind: string;
  service: string;
  deliverables: readonly string[];
  subtotalCents: number;
  currency: string;
  taxMode: ImportTaxMode;
  taxRatePct: number;
  includedSongSpaces: number;
  revisionRule: Readonly<{ kind: "fixed"; count: number } | { kind: "unlimited" }> | null;
  royaltyTerms: Readonly<{
    master:
      | Readonly<{ mode: "none" }>
      | Readonly<{ mode: "agreement" }>
      | Readonly<{ mode: "percentage"; bps: number }>;
    composition:
      | Readonly<{ mode: "none" }>
      | Readonly<{ mode: "agreement" }>
      | Readonly<{
          mode: "percentage";
          bps: number;
          role?: "composer" | "lyricist" | "arranger" | "publisher" | "other" | undefined;
          collectingSociety?: string | undefined;
        }>;
    notes?: string | undefined;
  }> | null;
  rights: readonly string[];
  plans: readonly PaymentPlan[];
  agreementText: string;
}>;

export type ImportPaymentDraft = {
  operationKey: string;
  installmentPosition: number;
  amount: string;
  paidAt: string;
  note: string;
  proofUploadToken: string | null;
  proofFileName: string | null;
};

export type ActiveWorkImportDraft = {
  client: {
    existingClientId: string | null;
    name: string;
    email: string;
    phone: string;
  };
  project: {
    title: string;
    deadlineAt: string;
  };
  agreement: {
    templateProductId: string | null;
    name: string;
    service: string;
    deliverables: string[];
    rights: string[];
    agreementText: string;
    subtotal: string;
    taxMode: ImportTaxMode;
    taxRatePct: string;
    currency: string;
    includedSongSpaces: string;
    revisionMode: ImportRevisionMode;
    revisionCount: string;
    masterMode: ImportRoyaltyMode;
    masterPercentage: string;
    compositionMode: ImportRoyaltyMode;
    compositionPercentage: string;
    compositionRole: "" | "composer" | "lyricist" | "arranger" | "publisher" | "other";
    collectingSociety: string;
    royaltyNotes: string;
    planKind: ImportPlanKind;
    monthlyInstallments: string;
  };
  payments: ImportPaymentDraft[];
};

export type ImportReasonView = Readonly<{ code: string; field: string; message: string }>;

const MATERIALIZE_ERROR_FALLBACK = "Last create attempt failed. Your saved draft is unchanged.";
const REVIEWED_DETAILS_CHANGED = "The reviewed details changed. Review this item and try again.";

// Row failures arrive as a machine code (stored in lastErrorCode and echoed on
// a live outcome). Known codes get a specific sentence; an unknown code uses
// the server's sentence when it has one, and the generic line only as a last
// resort.
const MATERIALIZE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  PROOF_UPLOAD_MISSING: "The payment proof file is no longer available. Attach it again and retry.",
  PROOF_INVALID: "The payment proof could not be verified. Attach it again and retry.",
  OPERATION_KEY_CONFLICT: REVIEWED_DETAILS_CHANGED,
  CONFLICT: REVIEWED_DETAILS_CHANGED,
  INVALID_INPUT: "Some details are no longer valid. Review this item and try again.",
  NOT_FOUND: "Part of this item could not be found. Review it and try again.",
  INTEGRITY_ERROR: "Skitza could not create this item safely. Your saved draft is unchanged.",
};

export function materializeErrorMessage(
  code: string | null | undefined,
  serverMessage?: string | null,
): string | null {
  if (!code) return null;
  const known = MATERIALIZE_ERROR_MESSAGES[code];
  if (known) return known;
  const fallback = serverMessage?.trim();
  return fallback ? fallback : MATERIALIZE_ERROR_FALLBACK;
}
export type NormalizedImportReview = Readonly<{
  existingClientId: string | null;
  templateProductId: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  projectTitle: string;
  deadlineAtIso: string | null;
  plan:
    | Readonly<{ kind: "full" }>
    | Readonly<{ kind: "split_50_50" }>
    | Readonly<{ kind: "monthly"; installments: number }>;
  commercialSnapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
  schedule: readonly Readonly<{
    sequence: number;
    amountCents: number;
    trigger: "acceptance" | "producer_import" | "artist_approval" | "monthly_anniversary";
    status: string;
  }>[];
  payments: readonly Readonly<{
    operationKey: string;
    installmentPosition: number;
    amountCents: number;
    paidAtIso: string;
    note: string | null;
    hasProof: boolean;
  }>[];
}>;

export type ImportAssessmentView =
  | Readonly<{
      state: "ready";
      creationDigest: string;
      normalized: NormalizedImportReview;
    }>
  | Readonly<{ state: "needs_info"; reasons: readonly ImportReasonView[] }>;

export type StoredImportRowView = Readonly<{
  id: string;
  operationKey: string;
  draftRevision: number;
  draftPayload: Record<string, unknown>;
  materializedAtIso: string | null;
  createdClientContactId: string | null;
  createdProjectId: string | null;
  createdPurchaseId: string | null;
  lastErrorCode: string | null;
}>;

export type InitialImportBatch = Readonly<{
  id: string;
  status: string;
  rows: readonly Readonly<{
    row: StoredImportRowView;
    assessment: ImportAssessmentView | null;
  }>[];
}>;

// "unchecked" means the draft reached Skitza but its readiness check did not
// answer. The work is safe; only the Ready/Needs info verdict is missing.
export type ImportRowSaveState = "idle" | "saving" | "saved" | "error" | "unchecked";

export type WorkspaceImportRow = {
  rowId: string | null;
  operationKey: string;
  revision: number | null;
  draft: ActiveWorkImportDraft;
  assessment: ImportAssessmentView | null;
  materializedAtIso: string | null;
  createdClientContactId: string | null;
  createdProjectId: string | null;
  createdPurchaseId: string | null;
  saveState: ImportRowSaveState;
  saveError: string | null;
  materializeError: string | null;
  localVersion: number;
  persistedLocalVersion: number;
};

export type SetupClientOption = Readonly<{
  id: string;
  name: string;
  email: string;
  connected: boolean;
  providerAcceptedAtIso: string | null;
  invitationEligible: boolean;
  invitationState:
    | "available"
    | "connected"
    | "provider_accepted"
    | "send_in_progress_or_retryable"
    | "invalid_email";
}>;

export type SetupInstallmentOption = Readonly<{
  id: string;
  rowId: string;
  projectId: string;
  purchaseId: string;
  projectTitle: string;
  agreementName: string;
  position: number;
  amountCents: number;
  remainingCents: number;
  currency: string;
  dueTrigger: "acceptance" | "producer_import" | "monthly_anniversary" | "artist_approval";
  dueAtIso: string | null;
  triggeredAtIso: string | null;
  status: string;
  remindersEnabled: boolean;
  reminderEligible: boolean;
}>;

export type SetupOptionsView = Readonly<{
  setupDigest: string;
  distinctClientCount: number;
  projectPurchaseCount: number;
  clients: readonly SetupClientOption[];
  installments: readonly SetupInstallmentOption[];
}>;

// Result of one Finish setup run. "requested" means the email provider only
// acknowledged the request (busy); it is not finished and not failed.
// `reason` is the server's sentence for a failed entry when it has one.
export type FinishSetupResultView = Readonly<{
  distinctClientCount: number;
  projectPurchaseCount: number;
  invitations: readonly Readonly<{
    clientContactId: string;
    status: "requested" | "provider_accepted" | "failed" | "connected";
    providerAcceptedAtIso: string | null;
    reason: string | null;
  }>[];
  reminders: readonly Readonly<{
    installmentId: string;
    purchaseId: string;
    status: "enabled" | "failed";
    changed: boolean;
    reason: string | null;
  }>[];
}>;

export const STILL_SENDING_NOTICE = "Still sending — check again in a moment" as const;

export function newImportDraft(input: {
  defaultCurrency: string;
  defaultTaxMode: ImportTaxMode;
  defaultTaxRatePct: number;
}): ActiveWorkImportDraft {
  return {
    client: { existingClientId: null, name: "", email: "", phone: "" },
    project: { title: "", deadlineAt: "" },
    agreement: {
      templateProductId: null,
      name: "",
      service: "",
      deliverables: [""],
      rights: [""],
      agreementText: "",
      subtotal: "",
      taxMode: input.defaultTaxMode,
      taxRatePct: String(input.defaultTaxMode === "tax_free" ? 0 : input.defaultTaxRatePct),
      currency: normalizedCurrency(input.defaultCurrency) || "USD",
      includedSongSpaces: "1",
      revisionMode: "none",
      revisionCount: "",
      masterMode: "none",
      masterPercentage: "",
      compositionMode: "none",
      compositionPercentage: "",
      compositionRole: "",
      collectingSociety: "",
      royaltyNotes: "",
      planKind: "full",
      monthlyInstallments: "2",
    },
    payments: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown, fallback: string[] = [""]): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value.length > 0
      ? [...value]
      : fallback
    : fallback;
}

function positiveIntegerText(value: unknown, fallback: string): string {
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : fallback;
}

function centsText(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) ? centsToInput(value) : "";
}

export function parseStoredImportDraft(
  raw: Record<string, unknown>,
  defaults: { defaultCurrency: string; defaultTaxMode: ImportTaxMode; defaultTaxRatePct: number },
): ActiveWorkImportDraft {
  const base = newImportDraft(defaults);
  const client = record(raw.client);
  const project = record(raw.project);
  const agreement = record(raw.agreement);
  const ui = record(raw._ui);
  const uiAgreement = record(ui.agreement);
  const rawPlan = record(agreement.plan);
  const planKind: ImportPlanKind =
    rawPlan.kind === "split_50_50" || rawPlan.kind === "monthly" || rawPlan.kind === "full"
      ? rawPlan.kind
      : base.agreement.planKind;
  const rawRevision = record(agreement.revisionRule);
  const revisionMode: ImportRevisionMode =
    rawRevision.kind === "unlimited"
      ? "unlimited"
      : rawRevision.kind === "fixed"
        ? "fixed"
        : "none";
  const royalty = record(agreement.royaltyTerms);
  const master = record(royalty.master);
  const composition = record(royalty.composition);
  const royaltyMode = (value: unknown): ImportRoyaltyMode =>
    value === "percentage" || value === "agreement" || value === "none" ? value : "none";
  const rawPayments = Array.isArray(raw.payments) ? raw.payments : [];
  const uiPayments = record(ui.payments);

  return {
    client: {
      existingClientId: nullableString(client.existingClientId),
      name: stringValue(client.name),
      email: stringValue(client.email),
      phone: stringValue(client.phone),
    },
    project: {
      title: stringValue(project.title),
      deadlineAt: stringValue(project.deadlineAt).slice(0, 10),
    },
    agreement: {
      templateProductId: nullableString(agreement.templateProductId),
      name: stringValue(agreement.name),
      service: stringValue(agreement.service),
      deliverables: stringArray(agreement.deliverables),
      rights: stringArray(agreement.rights),
      agreementText: stringValue(agreement.agreementText),
      subtotal: stringValue(uiAgreement.subtotal, centsText(agreement.subtotalCents)),
      taxMode:
        agreement.taxMode === "tax_free" ||
        agreement.taxMode === "tax_included" ||
        agreement.taxMode === "tax_added"
          ? agreement.taxMode
          : base.agreement.taxMode,
      taxRatePct: stringValue(
        uiAgreement.taxRatePct,
        positiveIntegerText(agreement.taxRatePct, base.agreement.taxRatePct),
      ),
      currency: stringValue(agreement.currency, base.agreement.currency),
      includedSongSpaces: stringValue(
        uiAgreement.includedSongSpaces,
        positiveIntegerText(agreement.includedSongSpaces, "1"),
      ),
      revisionMode,
      revisionCount: stringValue(
        uiAgreement.revisionCount,
        positiveIntegerText(rawRevision.count, ""),
      ),
      masterMode: royaltyMode(master.mode),
      masterPercentage: stringValue(
        uiAgreement.masterPercentage,
        typeof master.bps === "number" ? basisPointsToPercentageInput(master.bps) : "",
      ),
      compositionMode: royaltyMode(composition.mode),
      compositionPercentage: stringValue(
        uiAgreement.compositionPercentage,
        typeof composition.bps === "number" ? basisPointsToPercentageInput(composition.bps) : "",
      ),
      compositionRole:
        composition.role === "composer" ||
        composition.role === "lyricist" ||
        composition.role === "arranger" ||
        composition.role === "publisher" ||
        composition.role === "other"
          ? composition.role
          : "",
      collectingSociety: stringValue(composition.collectingSociety),
      royaltyNotes: stringValue(royalty.notes),
      planKind,
      monthlyInstallments: stringValue(
        uiAgreement.monthlyInstallments,
        positiveIntegerText(rawPlan.installments, "2"),
      ),
    },
    payments: rawPayments.map((rawPayment, index) => {
      const payment = record(rawPayment);
      const operationKey = stringValue(
        payment.operationKey,
        `restored-payment-${String(index + 1)}`,
      );
      const uiPayment = record(uiPayments[operationKey]);
      return {
        operationKey,
        installmentPosition:
          typeof payment.installmentPosition === "number" ? payment.installmentPosition : 1,
        amount: stringValue(uiPayment.amount, centsText(payment.amountCents)),
        paidAt: stringValue(payment.paidAt).slice(0, 10),
        note: stringValue(payment.note),
        proofUploadToken: nullableString(payment.proofUploadToken),
        proofFileName: nullableString(uiPayment.proofFileName),
      };
    }),
  };
}

export function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function localDateInputValue(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function matchingExistingClient(
  draft: ActiveWorkImportDraft,
  clients: readonly ExistingClientOption[],
): ExistingClientOption | null {
  const email = normalizedEmail(draft.client.email);
  if (!email) return null;
  return clients.find((client) => normalizedEmail(client.email) === email) ?? null;
}

export function matchingArchivedClient(
  draft: ActiveWorkImportDraft,
  clients: readonly ArchivedClientOption[],
): ArchivedClientOption | null {
  if (draft.client.existingClientId) {
    const selected = clients.find((client) => client.id === draft.client.existingClientId);
    if (selected) return selected;
  }
  const email = normalizedEmail(draft.client.email);
  if (!email) return null;
  return clients.find((client) => normalizedEmail(client.email) === email) ?? null;
}

export function requiresExplicitClientMatch(
  draft: ActiveWorkImportDraft,
  clients: readonly ExistingClientOption[],
): boolean {
  const match = matchingExistingClient(draft, clients);
  return Boolean(match && draft.client.existingClientId !== match.id);
}

export function rowDisplayReasons(
  assessment: ImportAssessmentView | null,
  draft: ActiveWorkImportDraft,
  clients: readonly ExistingClientOption[],
  archivedClients: readonly ArchivedClientOption[] = [],
): readonly ImportReasonView[] {
  const reasons: ImportReasonView[] = [];
  if (matchingArchivedClient(draft, archivedClients)) {
    reasons.push({
      code: "existing_client_archived",
      field: "client.existingClientId",
      message: "Restore this client in Clients & Projects before adding active work.",
    });
  } else if (requiresExplicitClientMatch(draft, clients)) {
    reasons.push({
      code: "existing_client_reuse_required",
      field: "client.existingClientId",
      message: "This email already belongs to a client. Choose Use existing client.",
    });
  }

  // The approved 21 August UI contract makes Service a required imported
  // agreement fact. The current server assessment still treats it as
  // optional, so keep this presentation-layer gate until the domain contract
  // is deliberately changed. This prevents a restored server-ready row with
  // a blank service from appearing Ready or being offered for creation.
  if (!draft.agreement.service.trim()) {
    reasons.push({
      code: "agreement_service_required",
      field: "agreement.service",
      message: "Add the service from the agreement.",
    });
  }

  if (assessment?.state === "needs_info") {
    reasons.push(...assessment.reasons);
  } else if (!assessment) {
    reasons.push({
      code: "checking",
      field: "row",
      message: "Finish the details, then save this item.",
    });
  }

  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const identity = `${reason.code}\u0000${reason.field}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function isRowReady(
  assessment: ImportAssessmentView | null,
  draft: ActiveWorkImportDraft,
  clients: readonly ExistingClientOption[],
  archivedClients: readonly ArchivedClientOption[] = [],
): assessment is Extract<ImportAssessmentView, Readonly<{ state: "ready" }>> {
  return (
    assessment?.state === "ready" &&
    draft.agreement.service.trim().length > 0 &&
    !requiresExplicitClientMatch(draft, clients) &&
    !matchingArchivedClient(draft, archivedClients)
  );
}

type PublicImportAssessmentInput =
  | Readonly<{
      state: "needs_info";
      reasons: readonly ImportReasonView[];
    }>
  | Readonly<{
      state: "ready";
      creationDigest: string;
      normalized: Readonly<{
        existingClientId: string | null;
        templateProductId: string | null;
        clientName: string;
        clientEmail: string;
        clientPhone: string | null;
        projectTitle: string;
        deadlineAt: Date | null;
        plan: NormalizedImportReview["plan"];
        commercialSnapshot: PurchaseCommercialSnapshot;
        snapshotDigest: string;
        schedule: readonly Readonly<{
          sequence: number;
          amountCents: number;
          trigger: NormalizedImportReview["schedule"][number]["trigger"];
          status: string;
        }>[];
        payments: readonly Readonly<{
          operationKey: string;
          installmentPosition: number;
          amountCents: number;
          paidAt: Date;
          note: string | null;
          hasProof: boolean;
        }>[];
      }>;
    }>;

export function mapPublicImportAssessment(
  value: PublicImportAssessmentInput,
): ImportAssessmentView {
  if (value.state === "needs_info") {
    return { state: "needs_info", reasons: value.reasons };
  }
  return {
    state: "ready",
    creationDigest: value.creationDigest,
    normalized: {
      existingClientId: value.normalized.existingClientId,
      templateProductId: value.normalized.templateProductId,
      clientName: value.normalized.clientName,
      clientEmail: value.normalized.clientEmail,
      clientPhone: value.normalized.clientPhone,
      projectTitle: value.normalized.projectTitle,
      deadlineAtIso: value.normalized.deadlineAt?.toISOString() ?? null,
      plan: value.normalized.plan,
      commercialSnapshot: value.normalized.commercialSnapshot,
      snapshotDigest: value.normalized.snapshotDigest,
      schedule: value.normalized.schedule.map((installment) => ({ ...installment })),
      payments: value.normalized.payments.map((payment) => ({
        operationKey: payment.operationKey,
        installmentPosition: payment.installmentPosition,
        amountCents: payment.amountCents,
        paidAtIso: payment.paidAt.toISOString(),
        note: payment.note,
        hasProof: payment.hasProof,
      })),
    },
  };
}

export function inputToCents(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  return Number.isSafeInteger(cents) && cents <= MAX_POSTGRES_INTEGER_CENTS ? cents : null;
}

export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}${String(whole)}.${fraction}`;
}

function integerInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function includedTax(subtotalCents: number, ratePct: number): number {
  const numerator = BigInt(subtotalCents) * BigInt(ratePct);
  const denominator = BigInt(100 + ratePct);
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

function addedTax(subtotalCents: number, ratePct: number): number {
  const numerator = BigInt(subtotalCents) * BigInt(ratePct);
  return Number((numerator * 2n + 100n) / 200n);
}

export function draftTaxBreakdown(draft: ActiveWorkImportDraft): Readonly<{
  subtotalCents: number | null;
  taxRatePct: number | null;
  taxAmountCents: number | null;
  totalCents: number | null;
}> {
  const subtotalCents = inputToCents(draft.agreement.subtotal);
  const taxRatePct = integerInput(draft.agreement.taxRatePct);
  if (subtotalCents === null || taxRatePct === null || taxRatePct < 0 || taxRatePct > 100) {
    return { subtotalCents, taxRatePct, taxAmountCents: null, totalCents: null };
  }
  if (draft.agreement.taxMode === "tax_free") {
    return { subtotalCents, taxRatePct, taxAmountCents: 0, totalCents: subtotalCents };
  }
  if (draft.agreement.taxMode === "tax_included") {
    return {
      subtotalCents,
      taxRatePct,
      taxAmountCents: includedTax(subtotalCents, taxRatePct),
      totalCents: subtotalCents,
    };
  }
  const taxAmountCents = addedTax(subtotalCents, taxRatePct);
  if (
    taxAmountCents > MAX_POSTGRES_INTEGER_CENTS ||
    subtotalCents + taxAmountCents > MAX_POSTGRES_INTEGER_CENTS
  ) {
    return { subtotalCents, taxRatePct, taxAmountCents: null, totalCents: null };
  }
  return {
    subtotalCents,
    taxRatePct,
    taxAmountCents,
    totalCents: subtotalCents + taxAmountCents,
  };
}

function percentageToBasisPoints(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d?)(?:\.\d{0,2})?$|^100(?:\.0{0,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  const bps = Math.round(parsed * 100);
  return Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000 ? bps : null;
}

function basisPointsToPercentageInput(bps: number): string {
  return String(bps / 100);
}

function royaltyPart(
  mode: ImportRoyaltyMode,
  percentage: string,
  extra?: Readonly<{ role?: string; collectingSociety?: string }>,
): Record<string, unknown> {
  if (mode !== "percentage") return { mode };
  const part: Record<string, unknown> = { mode, bps: percentageToBasisPoints(percentage) };
  if (extra?.role) part.role = extra.role;
  if (extra?.collectingSociety?.trim()) part.collectingSociety = extra.collectingSociety.trim();
  return part;
}

export function toServerDraftPayload(draft: ActiveWorkImportDraft): Record<string, unknown> {
  const tax = draftTaxBreakdown(draft);
  const revisionRule =
    draft.agreement.revisionMode === "unlimited"
      ? { kind: "unlimited" }
      : draft.agreement.revisionMode === "fixed"
        ? { kind: "fixed", count: integerInput(draft.agreement.revisionCount) }
        : null;
  const plan =
    draft.agreement.planKind === "monthly"
      ? {
          kind: "monthly",
          installments: integerInput(draft.agreement.monthlyInstallments),
        }
      : { kind: draft.agreement.planKind };
  const uiPayments: Record<string, unknown> = {};
  for (const payment of draft.payments) {
    uiPayments[payment.operationKey] = {
      amount: payment.amount,
      proofFileName: payment.proofFileName,
    };
  }
  return {
    client: {
      existingClientId: draft.client.existingClientId,
      name: draft.client.name,
      email: draft.client.email,
      phone: draft.client.phone || null,
    },
    project: {
      title: draft.project.title,
      deadlineAt: draft.project.deadlineAt || null,
    },
    agreement: {
      templateProductId: draft.agreement.templateProductId,
      name: draft.agreement.name,
      service: draft.agreement.service || null,
      deliverables: draft.agreement.deliverables,
      rights: draft.agreement.rights,
      agreementText: draft.agreement.agreementText,
      subtotalCents: tax.subtotalCents,
      taxMode: draft.agreement.taxMode,
      taxRatePct: tax.taxRatePct,
      taxAmountCents: tax.taxAmountCents,
      totalCents: tax.totalCents,
      currency: normalizedCurrency(draft.agreement.currency),
      includedSongSpaces: integerInput(draft.agreement.includedSongSpaces),
      revisionRule,
      royaltyTerms: {
        master: royaltyPart(draft.agreement.masterMode, draft.agreement.masterPercentage),
        composition: royaltyPart(
          draft.agreement.compositionMode,
          draft.agreement.compositionPercentage,
          {
            ...(draft.agreement.compositionRole ? { role: draft.agreement.compositionRole } : {}),
            ...(draft.agreement.collectingSociety
              ? { collectingSociety: draft.agreement.collectingSociety }
              : {}),
          },
        ),
        ...(draft.agreement.royaltyNotes.trim()
          ? { notes: draft.agreement.royaltyNotes.trim() }
          : {}),
      },
      plan,
    },
    payments: draft.payments.map((payment) => ({
      operationKey: payment.operationKey,
      installmentPosition: payment.installmentPosition,
      amountCents: inputToCents(payment.amount),
      paidAt: payment.paidAt,
      note: payment.note || null,
      proofUploadToken: payment.proofUploadToken,
    })),
    _ui: {
      version: 1,
      agreement: {
        subtotal: draft.agreement.subtotal,
        taxRatePct: draft.agreement.taxRatePct,
        includedSongSpaces: draft.agreement.includedSongSpaces,
        revisionCount: draft.agreement.revisionCount,
        masterPercentage: draft.agreement.masterPercentage,
        compositionPercentage: draft.agreement.compositionPercentage,
        monthlyInstallments: draft.agreement.monthlyInstallments,
      },
      payments: uiPayments,
    },
  };
}

export function applyTemplate(
  draft: ActiveWorkImportDraft,
  template: StoreTemplateOption,
): ActiveWorkImportDraft {
  const firstPlan = template.plans[0];
  const revisionMode: ImportRevisionMode = template.revisionRule?.kind ?? "none";
  const royalty = template.royaltyTerms;
  const composition = royalty?.composition;
  return {
    ...draft,
    agreement: {
      ...draft.agreement,
      templateProductId: template.id,
      name: template.name,
      service: template.service,
      deliverables: template.deliverables.length > 0 ? [...template.deliverables] : [""],
      rights: template.rights.length > 0 ? [...template.rights] : [""],
      agreementText: template.agreementText,
      subtotal: centsToInput(template.subtotalCents),
      taxMode: template.taxMode,
      taxRatePct: String(template.taxMode === "tax_free" ? 0 : template.taxRatePct),
      currency: template.currency,
      includedSongSpaces: String(Math.max(1, template.includedSongSpaces)),
      revisionMode,
      revisionCount:
        template.revisionRule?.kind === "fixed" ? String(template.revisionRule.count) : "",
      masterMode: template.royaltyTerms?.master.mode ?? "none",
      masterPercentage:
        template.royaltyTerms?.master.mode === "percentage"
          ? basisPointsToPercentageInput(template.royaltyTerms.master.bps)
          : "",
      compositionMode: template.royaltyTerms?.composition.mode ?? "none",
      compositionPercentage:
        template.royaltyTerms?.composition.mode === "percentage"
          ? basisPointsToPercentageInput(template.royaltyTerms.composition.bps)
          : "",
      compositionRole: composition?.mode === "percentage" ? (composition.role ?? "") : "",
      collectingSociety:
        composition?.mode === "percentage" ? (composition.collectingSociety ?? "") : "",
      royaltyNotes: royalty?.notes ?? "",
      planKind: firstPlan?.kind ?? draft.agreement.planKind,
      monthlyInstallments:
        firstPlan?.kind === "monthly"
          ? String(firstPlan.installments)
          : draft.agreement.monthlyInstallments,
    },
  };
}

export function normalizedCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

export function formatImportMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${centsToInput(cents)}`;
  }
}

export function paymentPlanLabel(draft: ActiveWorkImportDraft): string {
  if (draft.agreement.planKind === "split_50_50") return "50/50";
  if (draft.agreement.planKind === "monthly") {
    return `Monthly · ${draft.agreement.monthlyInstallments || "?"} payments`;
  }
  return "Full";
}

export function paidCents(draft: ActiveWorkImportDraft): number {
  return draft.payments.reduce((sum, payment) => sum + (inputToCents(payment.amount) ?? 0), 0);
}

/**
 * Money truth is per installment: a payment on installment 1 never covers
 * installment 2, and excess on one installment never reduces another.
 * remaining = Σ max(0, scheduled − paid), overpaid = Σ max(0, paid − scheduled).
 * A payment on a position that is not in the schedule is all excess.
 */
export function installmentBalance(
  schedule: readonly Readonly<{ position: number; amountCents: number }>[],
  payments: readonly Readonly<{ installmentPosition: number; amountCents: number }>[],
): Readonly<{ paidCents: number; remainingCents: number; overpaidCents: number }> {
  const paidByPosition = new Map<number, number>();
  let paidCents = 0;
  for (const payment of payments) {
    paidCents += payment.amountCents;
    paidByPosition.set(
      payment.installmentPosition,
      (paidByPosition.get(payment.installmentPosition) ?? 0) + payment.amountCents,
    );
  }
  let remainingCents = 0;
  let overpaidCents = 0;
  for (const installment of schedule) {
    const paid = paidByPosition.get(installment.position) ?? 0;
    paidByPosition.delete(installment.position);
    remainingCents += Math.max(0, installment.amountCents - paid);
    overpaidCents += Math.max(0, paid - installment.amountCents);
  }
  for (const stray of paidByPosition.values()) overpaidCents += Math.max(0, stray);
  return { paidCents, remainingCents, overpaidCents };
}

export function draftPaymentBalance(
  draft: ActiveWorkImportDraft,
): Readonly<{ paidCents: number; remainingCents: number | null; overpaidCents: number }> {
  const schedule = draftInstallmentSchedule(draft);
  const payments = draft.payments.map((payment) => ({
    installmentPosition: payment.installmentPosition,
    amountCents: inputToCents(payment.amount) ?? 0,
  }));
  if (schedule.length === 0) {
    return { paidCents: paidCents(draft), remainingCents: null, overpaidCents: 0 };
  }
  return installmentBalance(schedule, payments);
}

export function installmentCount(draft: ActiveWorkImportDraft): number {
  if (draft.agreement.planKind === "split_50_50") return 2;
  if (draft.agreement.planKind === "monthly") {
    return Math.max(2, Math.min(12, integerInput(draft.agreement.monthlyInstallments) ?? 2));
  }
  return 1;
}

export function draftInstallmentSchedule(draft: ActiveWorkImportDraft): readonly Readonly<{
  position: number;
  amountCents: number;
  trigger: "producer_import" | "artist_approval" | "monthly_anniversary";
}>[] {
  const totalCents = draftTaxBreakdown(draft).totalCents;
  if (totalCents === null || totalCents <= 0) return [];
  if (draft.agreement.planKind === "full") {
    return [{ position: 1, amountCents: totalCents, trigger: "producer_import" }];
  }
  if (draft.agreement.planKind === "split_50_50") {
    if (totalCents < 2) return [];
    const second = Math.floor(totalCents / 2);
    return [
      {
        position: 1,
        amountCents: totalCents - second,
        trigger: "producer_import",
      },
      { position: 2, amountCents: second, trigger: "artist_approval" },
    ];
  }
  const count = installmentCount(draft);
  if (totalCents < count) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    amountCents: base + (index === 0 ? remainder : 0),
    trigger: index === 0 ? "producer_import" : "monthly_anniversary",
  }));
}
