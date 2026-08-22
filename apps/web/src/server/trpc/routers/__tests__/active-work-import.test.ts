import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "00000000-0000-0000-0000-000000000101";
const BATCH_ID = "00000000-0000-0000-0000-000000000102";
const ROW_ID = "00000000-0000-0000-0000-000000000103";
const CLIENT_ID = "00000000-0000-0000-0000-000000000104";
const INSTALLMENT_ID = "00000000-0000-0000-0000-000000000105";
const PURCHASE_ID = "00000000-0000-0000-0000-000000000106";
const SETUP_DIGEST = `sha256:${"a".repeat(64)}`;

type UnknownAsyncMock = (...args: unknown[]) => Promise<unknown>;
type UnknownSyncMock = (...args: unknown[]) => unknown;
type PublicAssessmentMock = (assessment: Record<string, unknown>) => unknown;

const mocks = vi.hoisted(() => {
  class ImportError extends Error {
    constructor(
      readonly code:
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "CONFLICT"
        | "OPERATION_KEY_CONFLICT"
        | "INTEGRITY_ERROR",
      message: string,
    ) {
      super(message);
      this.name = "ActiveWorkImportDomainError";
    }
  }
  class InvitationError extends Error {
    constructor(
      readonly code:
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "CONFLICT"
        | "OPERATION_KEY_CONFLICT"
        | "INTEGRITY_ERROR",
      message: string,
    ) {
      super(message);
      this.name = "ClientInvitationDomainError";
    }
  }
  const producers = {
    id: { column: "producers.id" },
    clerkUserId: { column: "producers.clerk_user_id" },
    closedAt: { column: "producers.closed_at" },
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ id: PRODUCER_ID }]) }),
      }),
    }),
  };
  return {
    ImportError,
    InvitationError,
    producers,
    db,
    latestOpen: vi.fn<UnknownAsyncMock>(),
    assess: vi.fn<UnknownAsyncMock>(),
    publicAssessment: vi.fn<PublicAssessmentMock>(),
    loadSetupScope: vi.fn<UnknownAsyncMock>(),
    setupOptions: vi.fn<UnknownSyncMock>(),
    setupRepository: vi.fn<UnknownSyncMock>(),
    finishSetup: vi.fn<UnknownAsyncMock>(),
  };
});

vi.mock("@skitza/db", () => ({
  createDb: () => mocks.db,
  producers: mocks.producers,
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  isNull: (column: unknown) => ({ isNull: column }),
}));

vi.mock("~/server/domain/active-work-import/db", () => ({
  createActiveWorkImportBatch: vi.fn(),
  deleteActiveWorkImportRow: vi.fn(),
  loadActiveWorkImportBatch: vi.fn(),
  loadLatestOpenActiveWorkImportBatch: (...args: unknown[]) => mocks.latestOpen(...args),
  saveActiveWorkImportRow: vi.fn(),
}));

vi.mock("~/server/domain/active-work-import/service", () => ({
  ActiveWorkImportDomainError: mocks.ImportError,
}));

vi.mock("~/server/domain/active-work-import/workflow", () => ({
  assessActiveWorkImportRowForCreation: (...args: unknown[]) => mocks.assess(...args),
  materializeActiveWorkImportRow: vi.fn(),
  materializeActiveWorkImportRows: vi.fn(),
  prepareActiveWorkImportProof: vi.fn(),
  publicActiveWorkImportAssessment: (assessment: Record<string, unknown>) =>
    mocks.publicAssessment(assessment),
}));

vi.mock("~/server/domain/active-work-import/setup", () => ({
  activeWorkImportSetupRepository: (...args: unknown[]) => mocks.setupRepository(...args),
  activeWorkImportSetupOptions: (...args: unknown[]) => mocks.setupOptions(...args),
  loadActiveWorkImportSetupScope: (...args: unknown[]) => mocks.loadSetupScope(...args),
  runActiveWorkImportSetup: (...args: unknown[]) => mocks.finishSetup(...args),
}));

vi.mock("~/server/domain/client-invitations/service", () => ({
  ClientInvitationDomainError: mocks.InvitationError,
}));

vi.mock("~/server/security/capability-secrets", () => ({
  configuredCapabilitySecrets: () => ({
    active: "active-test-secret",
    verification: ["active-test-secret", "rotated-test-secret"],
  }),
}));

vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.test",
  sendClientInviteEmail: vi.fn(),
}));

async function caller() {
  process.env.DATABASE_URL = "postgresql://unit-test/not-used";
  const { activeWorkImportRouter } = await import("../active-work-import");
  return activeWorkImportRouter.createCaller({ userId: "producer-clerk-user" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicAssessment.mockImplementation((assessment: Record<string, unknown>) => {
    const row = assessment.row as { id: string; draftRevision: number };
    const normalized = assessment.normalized as {
      payments: readonly ({ proofUploadToken: string | null } & Record<string, unknown>)[];
    };
    return {
      state: "ready",
      rowId: row.id,
      draftRevision: row.draftRevision,
      normalized: {
        ...normalized,
        payments: normalized.payments.map(({ proofUploadToken, ...payment }) => ({
          ...payment,
          hasProof: proofUploadToken !== null,
        })),
      },
      creationDigest: assessment.creationDigest,
    };
  });
  mocks.setupRepository.mockReturnValue({ kind: "setup-repository" });
});

describe("activeWorkImport tRPC boundary", () => {
  it("scopes durable open-batch resume to the authenticated Producer", async () => {
    mocks.latestOpen.mockResolvedValue({ batch: { id: BATCH_ID }, rows: [] });

    const result = await (await caller()).latestOpenBatch();

    expect(result).toEqual({ batch: { id: BATCH_ID }, rows: [] });
    expect(mocks.latestOpen).toHaveBeenCalledWith(mocks.db, { producerId: PRODUCER_ID });
  });

  it("projects a reviewed row without proof tokens, capability maps, or verification secrets", async () => {
    mocks.assess.mockResolvedValue({
      state: "ready",
      row: { id: ROW_ID, draftRevision: 3, draftPayload: { private: true } },
      normalized: {
        clientName: "Noga",
        payments: [
          {
            operationKey: "history-1",
            amountCents: 1_000,
            proofUploadToken: "signed-private-token",
          },
        ],
      },
      creationDigest: `sha256:${"b".repeat(64)}`,
      proofCapabilities: new Map([
        ["history-1", { secret: "never-cross-this-boundary", capability: { uploadId: "u1" } }],
      ]),
    });

    const result = await (await caller()).assessRow({ batchId: BATCH_ID, rowId: ROW_ID });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      state: "ready",
      rowId: ROW_ID,
      draftRevision: 3,
      normalized: { payments: [{ operationKey: "history-1", hasProof: true }] },
    });
    expect(serialized).not.toContain("signed-private-token");
    expect(serialized).not.toContain("never-cross-this-boundary");
    expect(serialized).not.toContain("proofCapabilities");
    expect(serialized).not.toContain("draftPayload");
    expect(mocks.assess).toHaveBeenCalledWith(mocks.db, {
      producerId: PRODUCER_ID,
      batchId: BATCH_ID,
      rowId: ROW_ID,
      verificationSecrets: ["active-test-secret", "rotated-test-secret"],
    });
  });

  it("keeps mandatory reminders server-owned while forwarding optional invitations", async () => {
    const internalScope = {
      clients: [
        {
          id: CLIENT_ID,
          name: "Noga",
          email: "noga@example.com",
          emailHash: "private-current-email-hash",
          connected: false,
          providerAcceptedAt: null,
          invitationEligible: true,
          invitationState: "available",
        },
      ],
      projectPurchases: [{ purchaseId: PURCHASE_ID }],
      installments: [{ id: INSTALLMENT_ID, purchaseId: PURCHASE_ID }],
    };
    const publicOptions = {
      setupDigest: SETUP_DIGEST,
      distinctClientCount: 1,
      projectPurchaseCount: 1,
      clients: [
        {
          id: CLIENT_ID,
          name: "Noga",
          email: "noga@example.com",
          connected: false,
          providerAcceptedAt: null,
          invitationEligible: true,
          invitationState: "available",
        },
      ],
      installments: [{ id: INSTALLMENT_ID, purchaseId: PURCHASE_ID }],
    };
    mocks.loadSetupScope.mockResolvedValue(internalScope);
    mocks.setupOptions.mockReturnValue(publicOptions);
    mocks.finishSetup.mockResolvedValue({
      distinctClientCount: 1,
      projectPurchaseCount: 1,
      invitations: [{ clientContactId: CLIENT_ID, status: "requested", providerAcceptedAt: null }],
      reminders: [
        {
          installmentId: INSTALLMENT_ID,
          purchaseId: PURCHASE_ID,
          status: "enabled",
          changed: true,
        },
      ],
    });
    const api = await caller();

    const options = await api.setupOptions({ batchId: BATCH_ID });
    expect(options).toEqual(publicOptions);
    expect(JSON.stringify(options)).not.toContain("emailHash");

    const result = await api.finishSetup({
      batchId: BATCH_ID,
      operationKey: "reviewed-bulk-action-1",
      expectedSetupDigest: SETUP_DIGEST,
      selectedClientContactIds: [CLIENT_ID],
    });
    expect(result.invitations[0]?.status).toBe("requested");
    expect(mocks.finishSetup).toHaveBeenCalledWith(
      { kind: "setup-repository" },
      {
        producerId: PRODUCER_ID,
        clerkUserId: "producer-clerk-user",
        batchId: BATCH_ID,
        operationKey: "reviewed-bulk-action-1",
        expectedSetupDigest: SETUP_DIGEST,
        selectedClientContactIds: [CLIENT_ID],
        siteUrl: "https://skitza.test",
      },
    );
  });

  it("returns CONFLICT when one bulk setup key is replayed with changed choices", async () => {
    mocks.finishSetup.mockRejectedValue(
      new mocks.ImportError(
        "CONFLICT",
        "This setup action was already used with different choices.",
      ),
    );

    await expect(
      (await caller()).finishSetup({
        batchId: BATCH_ID,
        operationKey: "reviewed-bulk-action-1",
        expectedSetupDigest: SETUP_DIGEST,
        selectedClientContactIds: [CLIENT_ID],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This setup action was already used with different choices.",
    });
  });
});
