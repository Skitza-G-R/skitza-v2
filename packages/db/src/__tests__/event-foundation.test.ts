import { describe, expect, it, vi } from "vitest";

import {
  canonicalFoundationDigest,
  commitIdempotentFoundationWrite,
  safeFoundationMetadata,
} from "../event-foundation";

describe("SK-132 event-foundation safety policy", () => {
  it("creates a stable digest independent of object key order", () => {
    expect(
      canonicalFoundationDigest({
        targetId: "target-1",
        state: { count: 2, active: true },
      }),
    ).toBe(
      canonicalFoundationDigest({
        state: { active: true, count: 2 },
        targetId: "target-1",
      }),
    );
    expect(canonicalFoundationDigest({ targetId: "target-1" })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("accepts only the narrow metadata profile for each foundation write", () => {
    expect(
      safeFoundationMetadata("admin_support_note", {
        noteCreated: true,
      }),
    ).toEqual({
      noteCreated: true,
    });
    expect(
      safeFoundationMetadata("admin_system_problem", {
        hasPrivateNote: false,
        state: "seen",
      }),
    ).toEqual({
      hasPrivateNote: false,
      state: "seen",
    });
    expect(
      safeFoundationMetadata("domain_event", {
        changed: true,
        fieldCount: 2,
      }),
    ).toEqual({
      changed: true,
      fieldCount: 2,
    });
    expect(
      safeFoundationMetadata("operational_run", {
        batchSize: 4,
        durationMs: 120,
      }),
    ).toEqual({
      batchSize: 4,
      durationMs: 120,
    });
  });

  it("rejects private aliases, wrong-profile keys, and unsafe boundaries", () => {
    for (const unsafe of [
      { body: "private note" },
      { content: "private message" },
      { detail: "private message under an unapproved key" },
      { credential: "credential" },
      { databaseUrl: "postgresql://private" },
      { fileContents: "private bytes" },
      { message: "private message" },
      { payload: "raw provider payload" },
      { providerResponse: "raw response" },
      { rawContent: "private content" },
      { r2Key: "private/object/key" },
      { recipientEmail: "private@example.test" },
      { requestBody: "raw request" },
      { secret: "secret" },
      { socialSecurityNumber: 123456789 },
      { stackTrace: "private stack" },
      { token: "token" },
      { accessToken: "token" },
      { nested: { private: "value" } },
      { invalidNumber: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => safeFoundationMetadata("domain_event", unsafe)).toThrow(
        expect.objectContaining({ code: "UNSAFE_METADATA" }),
      );
    }

    for (const unsafe of [
      { profile: "admin_support_note" as const, value: { noteCreated: false } },
      { profile: "admin_support_note" as const, value: { changed: true } },
      {
        profile: "admin_system_problem" as const,
        value: { state: "private founder message" },
      },
      { profile: "domain_event" as const, value: { "bad-key!": true } },
      { profile: "domain_event" as const, value: { changed: "x".repeat(201) } },
      {
        profile: "domain_event" as const,
        value: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`key${index}`, true])),
      },
      {
        profile: "operational_run" as const,
        value: { durationMs: Number.MAX_SAFE_INTEGER + 1 },
      },
    ]) {
      expect(() => safeFoundationMetadata(unsafe.profile, unsafe.value)).toThrow(
        expect.objectContaining({ code: "UNSAFE_METADATA" }),
      );
    }
  });
});

describe("SK-132 idempotent foundation writes", () => {
  const digest = canonicalFoundationDigest({
    action: "support_note.create",
    targetId: "user-1",
  });
  const intent = {
    environment: "live" as const,
    intentType: "support_note.create",
    operationDigest: digest,
    operationKey: "support-note:user-1:request-1",
  };

  it("returns the inserted row for the first effect", async () => {
    const row = { ...intent, id: "row-1" };
    const find = vi.fn();

    await expect(
      commitIdempotentFoundationWrite({
        boundEnvironment: "live",
        find,
        insert: () => Promise.resolve(row),
        intent,
      }),
    ).resolves.toEqual({ record: row, replayed: false });
    expect(find).not.toHaveBeenCalled();
  });

  it("returns one existing effect for an exact replay", async () => {
    const row = { ...intent, id: "row-1" };
    const insert = vi.fn().mockResolvedValue(null);
    const find = vi.fn().mockResolvedValue(row);

    await expect(
      commitIdempotentFoundationWrite({
        boundEnvironment: "live",
        find,
        insert,
        intent,
      }),
    ).resolves.toEqual({ record: row, replayed: true });
    expect(insert).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledOnce();
  });

  it("rejects changed intent instead of collapsing a different action", async () => {
    const existing = {
      ...intent,
      id: "row-1",
      intentType: "sensitive_content.reveal",
    };

    await expect(
      commitIdempotentFoundationWrite({
        boundEnvironment: "live",
        find: () => Promise.resolve(existing),
        insert: () => Promise.resolve(null),
        intent,
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("rejects a stored digest mismatch", async () => {
    const existing = {
      ...intent,
      id: "row-1",
      operationDigest: canonicalFoundationDigest({ changed: true }),
    };

    await expect(
      commitIdempotentFoundationWrite({
        boundEnvironment: "live",
        find: () => Promise.resolve(existing),
        insert: () => Promise.resolve(null),
        intent,
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("fails before writing when a caller crosses its bound environment", async () => {
    const insert = vi.fn();
    const find = vi.fn();

    await expect(
      commitIdempotentFoundationWrite({
        boundEnvironment: "test",
        find,
        insert,
        intent,
      }),
    ).rejects.toMatchObject({
      code: "ENVIRONMENT_MISMATCH",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});
