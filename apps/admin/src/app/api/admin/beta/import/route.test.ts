import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireActiveAdminAccess } from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { createBetaRuntime } from "~/server/beta/runtime";
import { POST } from "./route";

vi.mock("~/server/auth/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/auth/access")>();
  return { ...actual, requireActiveAdminAccess: vi.fn() };
});
vi.mock("~/server/auth/request-security", () => ({ isSameOriginMutation: vi.fn() }));
vi.mock("~/server/beta/runtime", () => ({ createBetaRuntime: vi.fn() }));

const repository = {
  findByEmail: vi.fn(),
  importRows: vi.fn(),
  listAll: vi.fn(),
  listPendingEmailsInWave: vi.fn(),
  markInvited: vi.fn(),
  removePending: vi.fn(),
  setWave: vi.fn(),
};

function request(
  body: string,
  headers: Readonly<Record<string, string>> = {
    "content-type": "application/json",
    "idempotency-key": "beta-import-request-1",
    origin: "https://admin.skitza.app",
    "sec-fetch-site": "same-origin",
  },
) {
  return new Request("https://admin.skitza.app/api/admin/beta/import?environment=test", {
    body,
    headers,
    method: "POST",
  });
}

describe("beta import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveAdminAccess).mockResolvedValue({} as never);
    vi.mocked(isSameOriginMutation).mockReturnValue(true);
    vi.mocked(createBetaRuntime).mockReturnValue({
      databaseUrl: "postgresql://test.example.test/skitza",
      db: {} as never,
      environment: "test",
      repository,
    } as never);
    repository.importRows.mockResolvedValue({ inserted: 1, skipped: 0 });
  });

  it("parses the pasted list, stores valid rows, and reports rejected lines", async () => {
    const response = await POST(
      request(JSON.stringify({ list: "noa@example.com,Noa,1\nnot-an-email" })),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      duplicates: 0,
      inserted: 1,
      invalidCount: 1,
      invalidLines: ["not-an-email"],
      skipped: 0,
    });
    expect(repository.importRows).toHaveBeenCalledWith(
      [{ email: "noa@example.com", name: "Noa", wave: 1 }],
      expect.any(Date),
    );
  });

  it("refuses cross-origin mutations", async () => {
    vi.mocked(isSameOriginMutation).mockReturnValue(false);

    const response = await POST(request(JSON.stringify({ list: "noa@example.com" })));

    expect(response.status).toBe(403);
    expect(repository.importRows).not.toHaveBeenCalled();
  });

  it("requires an idempotency key", async () => {
    const response = await POST(
      request(JSON.stringify({ list: "noa@example.com" }), {
        "content-type": "application/json",
        origin: "https://admin.skitza.app",
        "sec-fetch-site": "same-origin",
      }),
    );

    expect(response.status).toBe(400);
    expect(repository.importRows).not.toHaveBeenCalled();
  });
});
