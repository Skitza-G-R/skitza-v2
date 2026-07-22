import { GetBucketCorsCommand, PutBucketCorsCommand, type S3Client } from "@aws-sdk/client-s3";
import { sk102Fingerprint, type ApprovedSk102Runtime } from "@skitza/db/sk102-runtime";
import { describe, expect, it, vi } from "vitest";

import { applySk102R2Cors } from "./apply";

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

describe("applySk102R2Cors", () => {
  it("refuses to mutate without the explicit exact-target confirmation", async () => {
    const send = vi.fn();
    await expect(
      applySk102R2Cors({
        client: { send } as unknown as S3Client,
        runtime,
        mutationConfirmation: undefined,
      }),
    ).rejects.toEqual(new Error("SK102_R2_CORS_APPROVAL_REQUIRED"));
    expect(send).not.toHaveBeenCalled();
  });

  it("applies the isolated policy to only the two approved runtime buckets", async () => {
    const commands: unknown[] = [];
    const client = {
      send(command: unknown) {
        commands.push(command);
        return Promise.resolve(
          command instanceof GetBucketCorsCommand
            ? {
                CORSRules: [
                  {
                    AllowedOrigins: ["http://127.0.0.1:3102"],
                    AllowedMethods: ["PUT", "GET", "HEAD"],
                    AllowedHeaders: ["*"],
                    ExposeHeaders: ["ETag"],
                    MaxAgeSeconds: 3600,
                  },
                ],
              }
            : {},
        );
      },
    } as unknown as S3Client;
    await applySk102R2Cors({
      client,
      runtime,
      mutationConfirmation: "approved-exact-sk102-r2-cors-targets",
    });
    expect(commands).toHaveLength(4);
    const putCommands = commands.filter(
      (command): command is PutBucketCorsCommand => command instanceof PutBucketCorsCommand,
    );
    expect(putCommands.map((command) => command.input.Bucket)).toEqual([
      runtime.audioBucket,
      runtime.docsBucket,
    ]);
    for (const command of putCommands) {
      expect(command.input.CORSConfiguration?.CORSRules).toEqual([
        expect.objectContaining({ AllowedOrigins: ["http://127.0.0.1:3102"] }),
      ]);
    }
  });

  it("fails when read-back does not exactly match the isolated policy", async () => {
    const send = vi.fn().mockResolvedValue({ CORSRules: [] });
    await expect(
      applySk102R2Cors({
        client: { send } as unknown as S3Client,
        runtime,
        mutationConfirmation: "approved-exact-sk102-r2-cors-targets",
      }),
    ).rejects.toEqual(new Error("SK102_R2_CORS_VERIFY_FAILED"));
  });
});
