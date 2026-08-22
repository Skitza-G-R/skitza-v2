import { beforeEach, describe, expect, it, vi } from "vitest";

const PRODUCER_ID = "producer-uuid-sendInvite-1";
const OTHER_PRODUCER_ID = "producer-uuid-sendInvite-2";
const CONTACT_ID = "00000000-0000-0000-0000-000000000001";
const OPERATION_KEY = "client-invite-click-1";
const ACCEPTED_AT = new Date("2026-08-20T12:00:03.000Z");

type UnknownAsyncMock = (...args: unknown[]) => Promise<unknown>;
type SendEmailMock = (
  recipient: string,
  message: Readonly<{ clientName: string; producerName: string; inviteUrl: string }>,
  idempotencyKey: string,
) => Promise<string>;

const mocks = vi.hoisted(() => {
  type Row = Record<string, unknown>;
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

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
    slug: { __column: "producers.slug" },
    displayName: { __column: "producers.display_name" },
  };
  const clientContactsMarker = {
    __table: "client_contacts",
    id: { __column: "client_contacts.id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    name: { __column: "client_contacts.name" },
    invitedAt: { __column: "client_contacts.invited_at" },
  };
  const ownerSelect = vi.fn<() => Promise<Row[]>>();
  const listSelect = vi.fn<() => Promise<Row[]>>();
  const setSpy = vi.fn<(payload: Row) => void>();
  let lockedClientRows: Row[] = [];
  const db = {
    execute: () => Promise.resolve(),
    transaction: <T>(work: (tx: unknown) => Promise<T>) => work(db),
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: PRODUCER_ID,
                    clerkUserId: "user_test_sendinvite",
                    slug: "test-slug",
                    displayName: "Test Producer",
                  },
                ]),
            }),
          };
        }
        if (table === clientContactsMarker) {
          return {
            where: () => ({
              orderBy: () => listSelect(),
              limit: () => ({
                for: async () => {
                  lockedClientRows = await ownerSelect();
                  return lockedClientRows;
                },
              }),
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    update: () => ({
      set: (payload: Row) => {
        setSpy(payload);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve(lockedClientRows.map((row) => ({ ...row, ...payload }))),
          }),
        };
      },
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    InvitationError,
    producersMarker,
    clientContactsMarker,
    ownerSelect,
    listSelect,
    setSpy,
    db,
    reserve: vi.fn<UnknownAsyncMock>(),
    deliver: vi.fn<UnknownAsyncMock>(),
    sendEmail: vi.fn<SendEmailMock>(),
    loadInvitationStates: vi.fn<UnknownAsyncMock>(),
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_sendinvite" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => mocks.db,
  producers: mocks.producersMarker,
  clientContacts: mocks.clientContactsMarker,
  clientInvitationEmailDeliveries: { __table: "client_invitation_email_deliveries" },
  projects: { __table: "projects" },
  products: { __table: "products" },
  purchases: { __table: "purchases" },
  purchaseInstallments: { __table: "purchase_installments" },
  activeWorkImportBatches: { __table: "active_work_import_batches" },
  activeWorkImportRows: { __table: "active_work_import_rows" },
  bookings: { __table: "bookings" },
  notifications: { __table: "notifications" },
  privateOffers: { __table: "private_offers" },
  purchaseRequests: { __table: "purchase_requests" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  isNull: (column: unknown) => ({ isNull: column }),
  isNotNull: (column: unknown) => ({ isNotNull: column }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  desc: (column: unknown) => ({ desc: column }),
  asc: (column: unknown) => ({ asc: column }),
  inArray: (column: unknown, values: unknown[]) => ({ inArray: [column, values] }),
  sql: () => ({ sql: true }),
}));
vi.mock("~/server/artist/identity", () => ({
  emailHashFor: (email: string) => `hash:${email.trim().toLowerCase()}`,
}));
vi.mock("~/server/domain/client-invitations/db", () => ({
  reserveClientInvitationEmail: (...args: unknown[]) => mocks.reserve(...args),
  clientInvitationDeliveryRepository: () => ({ repository: true }),
  loadCurrentClientInvitationEvidence: () => Promise.resolve(new Map()),
  loadCurrentClientInvitationStates: (...args: unknown[]) => mocks.loadInvitationStates(...args),
  reserveActiveWorkImportClientInvitationEmail: (...args: unknown[]) => mocks.reserve(...args),
}));
vi.mock("~/server/domain/client-invitations/service", () => ({
  ClientInvitationDomainError: mocks.InvitationError,
  deliverClientInvitation: (...args: unknown[]) => mocks.deliver(...args),
  providerAcceptedAtForCurrentEmail: () => null,
  producerClientInvitationPresentationState: (
    clerkUserId: string | null,
    state: string | undefined,
  ) => (clerkUserId ? "connected" : (state ?? "available")),
}));
vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.app",
  sendClientInviteEmail: (
    recipient: string,
    message: Readonly<{ clientName: string; producerName: string; inviteUrl: string }>,
    idempotencyKey: string,
  ) => mocks.sendEmail(recipient, message, idempotencyKey),
}));

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTACT_ID,
    producerId: PRODUCER_ID,
    email: "noa@example.com",
    emailHash: "hash:noa@example.com",
    name: "Noa Kirel",
    invitedAt: null,
    clerkUserId: null,
    archivedAt: null,
    lastSeenAt: new Date("2026-08-20T10:00:00.000Z"),
    ...overrides,
  };
}

function reservedDelivery(operationKey = OPERATION_KEY) {
  return {
    id: "delivery-1",
    producerId: PRODUCER_ID,
    clientContactId: CONTACT_ID,
    operationKey,
    providerIdempotencyKey: "provider-key-1",
    messageSnapshot: {
      to: "noa@example.com",
      artistName: "Noa Kirel",
      producerName: "Test Producer",
      inviteUrl: "https://skitza.app/sign-up/join/test-slug/home",
    },
    providerAcceptedAt: null,
  };
}

beforeEach(() => {
  mocks.ownerSelect.mockReset().mockResolvedValue([contact()]);
  mocks.listSelect.mockReset().mockResolvedValue([contact()]);
  mocks.loadInvitationStates.mockReset().mockResolvedValue(new Map());
  mocks.setSpy.mockReset();
  mocks.reserve.mockReset().mockImplementation((_db, input) =>
    Promise.resolve({
      delivery: reservedDelivery((input as { operationKey: string }).operationKey),
      created: true,
    }),
  );
  const acceptedByOperation = new Map<string, Date>();
  mocks.deliver.mockReset().mockImplementation(async (_repository, send, delivery) => {
    const record = delivery as ReturnType<typeof reservedDelivery>;
    const existing = acceptedByOperation.get(record.operationKey);
    if (existing) {
      return {
        state: "provider_accepted",
        delivery: { ...record, providerAcceptedAt: existing },
        created: false,
      };
    }
    await (send as (input: unknown) => Promise<string>)({
      message: record.messageSnapshot,
      idempotencyKey: record.providerIdempotencyKey,
    });
    acceptedByOperation.set(record.operationKey, ACCEPTED_AT);
    return {
      state: "provider_accepted",
      delivery: { ...record, providerAcceptedAt: ACCEPTED_AT },
      created: true,
    };
  });
  mocks.sendEmail.mockReset().mockResolvedValue("resend-message-1");
  process.env.DATABASE_URL = "postgresql://test/test";
});

async function caller() {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_sendinvite" });
}

describe("clientContacts.sendInvite", () => {
  it.each([
    {
      label: "reserved",
      durable: {
        presentationState: "requested",
        providerAcceptedAt: null,
        activeWorkBlocked: true,
      },
      expected: "requested",
    },
    {
      label: "sending",
      durable: {
        presentationState: "requested",
        providerAcceptedAt: null,
        activeWorkBlocked: true,
      },
      expected: "requested",
    },
    {
      label: "failed",
      durable: {
        presentationState: "failed",
        providerAcceptedAt: null,
        activeWorkBlocked: true,
      },
      expected: "failed",
    },
    {
      label: "provider accepted",
      durable: {
        presentationState: "provider_accepted",
        providerAcceptedAt: ACCEPTED_AT,
        activeWorkBlocked: true,
      },
      expected: "provider_accepted",
    },
  ])(
    "reads durable current-email $label invitation state after reload",
    async ({ durable, expected }) => {
      mocks.loadInvitationStates.mockResolvedValueOnce(new Map([[CONTACT_ID, durable]]));

      const [result] = await (await caller()).clientContacts.list();

      expect(result).toMatchObject({
        id: CONTACT_ID,
        invitationState: expected,
        providerAcceptedAt: durable.providerAcceptedAt,
        invitedAt: durable.providerAcceptedAt,
      });
    },
  );

  it("shows available after email identity changes and lets an active connection win", async () => {
    mocks.listSelect
      .mockResolvedValueOnce([contact({ invitedAt: ACCEPTED_AT })])
      .mockResolvedValueOnce([contact({ clerkUserId: "artist-clerk", archivedAt: null })]);
    const api = await caller();

    const [changedEmail] = await api.clientContacts.list();
    expect(changedEmail).toMatchObject({
      invitationState: "available",
      providerAcceptedAt: null,
      invitedAt: null,
    });
    mocks.loadInvitationStates.mockResolvedValueOnce(
      new Map([
        [
          CONTACT_ID,
          {
            presentationState: "failed",
            providerAcceptedAt: null,
            activeWorkBlocked: true,
          },
        ],
      ]),
    );
    const [connected] = await api.clientContacts.list();
    expect(connected?.invitationState).toBe("connected");
  });

  it("keeps copy-link as deletion-safety intent only and sends no email", async () => {
    const api = await caller();
    const result = await api.clientContacts.sendInvite({
      id: CONTACT_ID,
      via: "link",
      operationKey: OPERATION_KEY,
    });
    expect(result.via).toBe("link");
    if (result.via !== "link") throw new Error("expected link result");
    expect(result.invitedAt).toBeInstanceOf(Date);
    expect(mocks.setSpy.mock.calls[0]?.[0]?.invitedAt).toBeInstanceOf(Date);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("routes email through the outbox and reports provider acceptance", async () => {
    const api = await caller();
    const result = await api.clientContacts.sendInvite({
      id: CONTACT_ID,
      via: "email",
      operationKey: OPERATION_KEY,
    });
    expect(mocks.reserve).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        producerId: PRODUCER_ID,
        clientContactId: CONTACT_ID,
        operationKey: OPERATION_KEY,
      }),
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      "noa@example.com",
      {
        clientName: "Noa Kirel",
        producerName: "Test Producer",
        inviteUrl: "https://skitza.app/sign-up/join/test-slug/home",
      },
      "provider-key-1",
    );
    expect(result).toEqual({
      via: "email",
      deliveryState: "provider_accepted",
      invitedAt: ACCEPTED_AT,
      providerAcceptedAt: ACCEPTED_AT,
    });
  });

  it("replays the caller-stable operation without a duplicate provider send", async () => {
    const api = await caller();
    const request = { id: CONTACT_ID, via: "email" as const, operationKey: OPERATION_KEY };
    await api.clientContacts.sendInvite(request);
    await api.clientContacts.sendInvite(request);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.reserve.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ operationKey: OPERATION_KEY }),
      expect.objectContaining({ operationKey: OPERATION_KEY }),
    ]);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it.each(["reserved", "sending", "failed"] as const)(
    "resumes a durable %s delivery after reload with a different UI key",
    async (status) => {
      const frozen = {
        ...reservedDelivery("durable-server-operation"),
        status,
        providerIdempotencyKey: "durable-provider-key",
      };
      mocks.reserve.mockResolvedValue({ delivery: frozen, created: false });
      const api = await caller();

      await api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "email",
        operationKey: `new-ui-key-${status}`,
      });

      expect(mocks.reserve).toHaveBeenCalledWith(
        mocks.db,
        expect.objectContaining({ operationKey: `new-ui-key-${status}` }),
      );
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
      expect(mocks.sendEmail).toHaveBeenCalledWith(
        "noa@example.com",
        expect.anything(),
        "durable-provider-key",
      );
    },
  );

  it("reports requested while the same outbox claim is already sending", async () => {
    mocks.deliver.mockResolvedValueOnce({ state: "sending" });
    const api = await caller();
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "email",
        operationKey: OPERATION_KEY,
      }),
    ).resolves.toEqual({
      via: "email",
      deliveryState: "sending",
      invitedAt: null,
      providerAcceptedAt: null,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps provider failures retryable under the same operation", async () => {
    mocks.deliver.mockRejectedValueOnce(new Error("Resend sandbox reject"));
    const api = await caller();
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "email",
        operationKey: OPERATION_KEY,
      }),
    ).rejects.toThrow(/Resend sandbox reject/);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });

  it("requires a new action after provider dedupe expires", async () => {
    mocks.deliver.mockResolvedValueOnce({ state: "dedupe_expired" });
    const api = await caller();
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "email",
        operationKey: OPERATION_KEY,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("surfaces same-key changed-message conflicts without sending", async () => {
    mocks.reserve.mockRejectedValueOnce(
      new mocks.InvitationError("OPERATION_KEY_CONFLICT", "different recipient"),
    );
    const api = await caller();
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "email",
        operationKey: OPERATION_KEY,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("rejects a foreign producer Client", async () => {
    mocks.ownerSelect.mockResolvedValueOnce([contact({ producerId: OTHER_PRODUCER_ID })]);
    const api = await caller();
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "link",
        operationKey: OPERATION_KEY,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("allows a link without email but refuses an email send without a recipient", async () => {
    mocks.ownerSelect.mockResolvedValueOnce([contact({ email: "", emailHash: "hash:" })]);
    const api = await caller();
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "link",
        operationKey: OPERATION_KEY,
      }),
    ).resolves.toMatchObject({ via: "link" });
    mocks.reserve.mockRejectedValueOnce(
      new mocks.InvitationError("INTEGRITY_ERROR", "Client email identity is invalid"),
    );
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        via: "email",
        operationKey: "client-invite-click-2",
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("validates the operation key and delivery method", async () => {
    const api = await caller();
    await expect(
      api.clientContacts.sendInvite({ id: CONTACT_ID, via: "email", operationKey: "" }),
    ).rejects.toThrow();
    await expect(
      api.clientContacts.sendInvite({
        id: CONTACT_ID,
        // @ts-expect-error runtime validation
        via: "fax",
        operationKey: OPERATION_KEY,
      }),
    ).rejects.toThrow();
  });
});
