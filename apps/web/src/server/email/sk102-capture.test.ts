import { ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { sk102Fingerprint, type ApprovedSk102Runtime } from "@skitza/db/sk102-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/storage/r2", () => ({
  BUCKETS: { audio: "skitza-sk102-browser-audio", docs: "skitza-sk102-browser-docs" },
  getR2: () => {
    throw new Error("Test must inject an R2 client");
  },
}));

import { captureSk102Email, sk102EmailCapturePrefix } from "./sk102-capture";
import { countSk102EmailCaptures } from "../operations/sk102-email-sink/assert";

const runtime = {
  __brand: "approved-sk102-runtime-v1",
  slot: "sk102-browser",
  siteUrl: "http://127.0.0.1:3102",
  browserOrigin: "http://127.0.0.1:3102",
  paymentMode: "off_app_test",
  databaseUrl: "postgresql://unused.invalid/sk102_e2e",
  databaseName: "sk102_e2e",
  databaseTargetFingerprint: sk102Fingerprint("db-target"),
  databaseEndpointFingerprint: sk102Fingerprint("db-endpoint"),
  databaseCredentialFingerprint: sk102Fingerprint("db-credentials"),
  clerkPublishableKey: `pk_test_${"a".repeat(32)}`,
  clerkSecretKey: `sk_test_${"b".repeat(32)}`,
  clerkWebhookSecret: `whsec_${"c".repeat(32)}`,
  clerkTargetFingerprint: sk102Fingerprint("clerk-target"),
  clerkCredentialFingerprint: sk102Fingerprint("clerk-credentials"),
  r2Endpoint: "https://unused.invalid",
  r2Credentials: { accessKeyId: "unused", secretAccessKey: "unused" },
  audioBucket: "skitza-sk102-browser-audio",
  docsBucket: "skitza-sk102-browser-docs",
  r2TargetFingerprint: sk102Fingerprint("r2-target"),
  r2CredentialFingerprint: sk102Fingerprint("r2-credentials"),
  emailMode: "r2_capture",
  emailAllowedRecipientDomain: "example.com",
  emailFrom: "Skitza SK-102 <no-reply@sk102.invalid>",
} satisfies ApprovedSk102Runtime;

describe("SK-102 private email capture", () => {
  it("writes a private kind-scoped record without recording the idempotency key", async () => {
    const commands: unknown[] = [];
    const client = {
      send(command: unknown) {
        commands.push(command);
        return Promise.resolve({});
      },
    } as unknown as S3Client;
    const result = await captureSk102Email({
      runtime,
      kind: "payment-reminder",
      message: {
        from: runtime.emailFrom,
        to: "artist+clerk_test@example.com",
        subject: "Test payment reminder",
        html: "<p>isolated fixture</p>",
        headers: { "x-private-test": "header-must-not-be-captured" },
        attachments: [{ filename: "private.txt", content: "attachment-must-not-be-captured" }],
      },
      options: { idempotencyKey: "secret-idempotency-value" },
      client,
    });

    expect(result.data.id).toMatch(/^sk102-capture-/);
    expect(result.error).toBeNull();
    const command = commands[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (!(command instanceof PutObjectCommand)) throw new Error("Expected PutObjectCommand");
    expect(command.input).toMatchObject({
      Bucket: runtime.docsBucket,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "private, no-store, max-age=0",
    });
    expect(command.input.Key).toMatch(
      /^sk102-email-sink\/sk102-browser\/payment-reminder\/.*[.]json$/,
    );
    if (typeof command.input.Body !== "string") throw new Error("Expected string capture body");
    const body = command.input.Body;
    expect(body).not.toContain("secret-idempotency-value");
    expect(body).not.toContain("header-must-not-be-captured");
    expect(body).not.toContain("attachment-must-not-be-captured");
    expect(body).toContain(sk102Fingerprint("secret-idempotency-value"));
  });

  it("rejects any sender other than the approved isolated sender", async () => {
    const send = vi.fn();
    await expect(
      captureSk102Email({
        runtime,
        kind: "client-invite",
        message: {
          from: "Skitza <hello@skitza.app>",
          to: "artist+clerk_test@example.com",
          subject: "Test invite",
          html: "<p>isolated fixture</p>",
        },
        client: { send } as unknown as S3Client,
      }),
    ).rejects.toEqual(new Error("SK102_EMAIL_FROM_FORBIDDEN"));
    expect(send).not.toHaveBeenCalled();
  });

  it("counts captures across pages without exposing or reading object keys", async () => {
    const commands: unknown[] = [];
    let callCount = 0;
    const client = {
      send(command: unknown) {
        commands.push(command);
        callCount += 1;
        return Promise.resolve(
          callCount === 1
            ? { Contents: [{}, {}], IsTruncated: true, NextContinuationToken: "p2" }
            : { Contents: [{}], IsTruncated: false },
        );
      },
    } as unknown as S3Client;
    await expect(
      countSk102EmailCaptures({
        client,
        bucket: runtime.docsBucket,
        slot: runtime.slot,
        kind: "client-invite",
      }),
    ).resolves.toBe(3);
    expect(commands).toHaveLength(2);
    const first = commands[0];
    expect(first).toBeInstanceOf(ListObjectsV2Command);
    if (!(first instanceof ListObjectsV2Command)) throw new Error("Expected ListObjectsV2Command");
    expect(first.input.Prefix).toBe(sk102EmailCapturePrefix(runtime.slot, "client-invite"));
  });
});
