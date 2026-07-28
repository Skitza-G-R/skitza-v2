import { describe, expect, it } from "vitest";

import { AdminAccessError } from "./access";
import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "./api-access";

async function expectPrivateJson(
  response: Response,
  status: number,
  body: Record<string, string>,
): Promise<void> {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(body);
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("content-type")).toContain(
    "application/json",
  );
}

describe("admin API failure responses", () => {
  it.each([
    "access-proof-required",
    "access-identity-mismatch",
    "founder-role-required",
    "impersonated-session",
  ] as const)("hides the admin surface for %s", async (reason) => {
    await expectPrivateJson(
      adminApiErrorResponse(new AdminAccessError(reason)),
      404,
      { error: "not_found" },
    );
  });

  it("returns a generic unauthorized response after valid Access but no Clerk session", async () => {
    await expectPrivateJson(
      adminApiErrorResponse(new AdminAccessError("signed-out")),
      401,
      { error: "unauthorized" },
    );
  });

  it("returns a generic locked response without leaking identity facts", async () => {
    await expectPrivateJson(
      adminApiErrorResponse(
        new AdminAccessError("activity-lock-required"),
      ),
      423,
      { error: "admin_session_locked" },
    );
  });

  it.each([
    new AdminAccessError("configuration-invalid"),
    new Error("unexpected server failure"),
  ])("fails closed when the admin boundary is unavailable", async (error) => {
    await expectPrivateJson(adminApiErrorResponse(error), 503, {
      error: "admin_unavailable",
    });
  });

  it("exposes the same private cache policy to successful handlers", () => {
    expect(privateAdminResponseHeaders()).toEqual({
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
    });
  });
});
