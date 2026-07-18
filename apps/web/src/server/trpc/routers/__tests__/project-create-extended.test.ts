import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "00000000-0000-4000-8000-000000000c01";
const CLIENT_ID = "00000000-0000-4000-8000-000000000c02";

type Row = Record<string, unknown>;
const insertValuesSpy = vi.fn<(payload: Row) => void>();
const clientContactsMarker = { __table: "client_contacts" };
const producersMarker = { __table: "producers" };
const projectsMarker = { __table: "projects" };

function limitResult(rows: Row[]) {
  const promise = Promise.resolve(rows);
  return {
    for: () => promise,
    then: promise.then.bind(promise),
  };
}

const dbMock: Record<string, unknown> = {};
const transaction = (work: (tx: Record<string, unknown>) => Promise<unknown>) => work(dbMock);
Object.assign(dbMock, {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: () =>
          table === clientContactsMarker
            ? limitResult([
                {
                  id: CLIENT_ID,
                  producerId: "producer-1",
                  name: "Test Artist",
                  email: "artist@example.com",
                },
              ])
            : limitResult([{ id: "producer-1" }]),
      }),
    }),
  }),
  insert: () => ({
    values: (payload: Row) => {
      insertValuesSpy(payload);
      return { returning: () => Promise.resolve([{ id: PROJECT_ID, ...payload }]) };
    },
  }),
  execute: () => Promise.resolve([]),
  transaction,
});

vi.mock("@skitza/db", () => ({
  bookings: { __table: "bookings" },
  projectTracks: { __table: "project_tracks" },
  clientContacts: clientContactsMarker,
  projects: projectsMarker,
  purchases: { __table: "purchases" },
  producers: producersMarker,
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  createDb: () => dbMock,
  and: (...conditions: unknown[]) => ({ conditions }),
  asc: (value: unknown) => value,
  desc: (value: unknown) => value,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  inArray: (left: unknown, right: unknown) => ({ left, right }),
  isNull: (value: unknown) => value,
  sql: Object.assign(() => ({ sql: true }), { raw: () => ({ sql: true }) }),
}));

beforeEach(() => {
  insertValuesSpy.mockReset();
  process.env.DATABASE_URL = "postgresql://test.invalid/sk90";
});

async function caller() {
  const { projectRouter } = await import("../project");
  return projectRouter.createCaller({
    userId: "user_test_1",
  } as never);
}

describe("project.create purchase boundary", () => {
  it("creates only a stable-client work container", async () => {
    const project = await caller();
    const result = await project.create({
      title: "Album mixing",
      clientContactId: CLIENT_ID,
    });

    expect(result.project.id).toBe(PROJECT_ID);
    expect(insertValuesSpy).toHaveBeenCalledOnce();
    expect(insertValuesSpy.mock.calls[0]?.[0]).toMatchObject({
      clientContactId: CLIENT_ID,
      title: "Album mixing",
      artistName: "Test Artist",
      artistEmail: "artist@example.com",
    });
    expect(insertValuesSpy.mock.calls[0]?.[0]).not.toHaveProperty("productId");
    expect(insertValuesSpy.mock.calls[0]?.[0]).not.toHaveProperty("engagementTotalCents");
    expect(insertValuesSpy.mock.calls[0]?.[0]).not.toHaveProperty("depositCents");
  });

  it("converts an optional ISO deadline to a Date", async () => {
    const project = await caller();
    await project.create({
      title: "Album mixing",
      clientContactId: CLIENT_ID,
      deadlineAt: "2026-06-15T00:00:00.000Z",
    });

    expect(insertValuesSpy.mock.calls[0]?.[0]?.deadlineAt).toEqual(
      new Date("2026-06-15T00:00:00.000Z"),
    );
  });

  it("rejects invalid deadlines before writing", async () => {
    const project = await caller();
    await expect(
      project.create({
        title: "Album mixing",
        clientContactId: CLIENT_ID,
        deadlineAt: "not-a-date",
      }),
    ).rejects.toBeDefined();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it.each(["productId", "engagementTotalCents", "depositCents", "bookingId"])(
    "rejects the commercial field %s instead of ignoring it",
    async (field) => {
      const project = await caller();
      await expect(
        project.create({
          title: "Album mixing",
          clientContactId: CLIENT_ID,
          [field]: field.endsWith("Cents") ? 100 : "00000000-0000-4000-8000-000000000099",
        } as never),
      ).rejects.toBeDefined();
      expect(insertValuesSpy).not.toHaveBeenCalled();
    },
  );
});
