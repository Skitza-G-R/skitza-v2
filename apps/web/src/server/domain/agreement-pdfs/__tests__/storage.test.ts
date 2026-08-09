import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { finalizePrivateAgreementPdfUpload } from "../storage";
import type { AgreementPdfUploadTokenPayload } from "../tokens";

const SECRET = "agreement-pdf-storage-secret-that-is-long-enough";
const PDF = new TextEncoder().encode("%PDF-1.7\nprivate agreement");

const payload: AgreementPdfUploadTokenPayload = {
  version: 1,
  kind: "agreement_pdf_upload",
  uploadId: "a".repeat(64),
  producerId: "producer-1",
  viewerClerkUserId: "user-1",
  originalFileName: "agreement.pdf",
  contentType: "application/pdf",
  sizeBytes: PDF.byteLength,
  expiresAtEpochSeconds: 2_000_000_000,
};

function body(bytes: Uint8Array) {
  return { transformToByteArray: vi.fn(() => Promise.resolve(bytes)) };
}

async function builtRequestHeaders(command: CopyObjectCommand): Promise<Record<string, string>> {
  type Arguments = {
    input: CopyObjectCommand["input"];
    request: { headers: Record<string, string> };
  };
  type Result = {
    response: Record<string, never>;
    output: { $metadata: Record<string, never> };
  };
  const stack = command.middlewareStack as unknown as {
    resolve: (
      next: (arguments_: Arguments) => Promise<Result>,
      context: Record<string, never>,
    ) => (arguments_: Arguments) => Promise<Result>;
  };
  const headers: Record<string, string> = {};
  const handler = stack.resolve(
    () => Promise.resolve({ response: {}, output: { $metadata: {} } }),
    {},
  );
  await handler({ input: command.input, request: { headers } });
  return headers;
}

describe("private agreement PDF storage", () => {
  it("checks PDF bytes, copies write-once, and records full integrity metadata", async () => {
    const commands: unknown[] = [];
    let headCount = 0;
    const client = {
      send: vi.fn(async (command: unknown) => {
        await Promise.resolve();
        commands.push(command);
        if (command instanceof HeadObjectCommand) {
          headCount += 1;
          if (headCount === 1) throw new Error("final absent");
          return {
            ContentType: "application/pdf",
            ContentLength: PDF.byteLength,
            ETag: '"etag"',
          };
        }
        if (command instanceof GetObjectCommand) return { Body: body(PDF) };
        if (command instanceof CopyObjectCommand) {
          expect(command.input.IfNoneMatch).toBeUndefined();
          expect(Reflect.get(command as object, "destinationCondition")).toEqual({
            header: "cf-copy-destination-if-none-match",
            value: "*",
          });
          await expect(builtRequestHeaders(command)).resolves.toMatchObject({
            "cf-copy-destination-if-none-match": "*",
          });
          expect(command.input.CopySource).toMatch(/^\//);
          expect(command.input.CopySourceIfMatch).toBe('"etag"');
          return { CopyObjectResult: { ETag: '"etag"' } };
        }
        return {};
      }),
    } as unknown as S3Client;

    const result = await finalizePrivateAgreementPdfUpload(SECRET, payload, client);

    expect(result).toMatchObject({
      storageBucket: "docs",
      originalFileName: "agreement.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF.byteLength,
      objectEtag: '"etag"',
      sha256: createHash("sha256").update(PDF).digest("hex"),
    });
    expect(result.storageKey).toMatch(/^agreement-pdfs\/[a-f0-9]{64}$/);
    expect(commands.some((command) => command instanceof CopyObjectCommand)).toBe(true);
  });

  it("rejects non-PDF bytes before creating an immutable object", async () => {
    const notPdf = new TextEncoder().encode("hello world");
    const send = vi.fn(async (command: unknown) => {
      await Promise.resolve();
      if (command instanceof HeadObjectCommand) {
        if ((command.input.Key ?? "").startsWith("agreement-pdfs/")) {
          throw new Error("final absent");
        }
        return {
          ContentType: "application/pdf",
          ContentLength: notPdf.byteLength,
          ETag: '"etag"',
        };
      }
      if (command instanceof GetObjectCommand) return { Body: body(notPdf) };
      throw new Error("unexpected copy");
    });
    const client = { send } as unknown as S3Client;

    await expect(
      finalizePrivateAgreementPdfUpload(
        SECRET,
        { ...payload, sizeBytes: notPdf.byteLength },
        client,
      ),
    ).rejects.toThrow("not a valid PDF");
    expect(send.mock.calls.some(([command]) => command instanceof CopyObjectCommand)).toBe(false);
  });
});
