import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import {
  agreementPdfFinalCandidate,
  deletePrivateAgreementPdfFinalIfExact,
  finalizePrivateAgreementPdfUpload,
  resolvePrivateAgreementPdfFinalCandidate,
} from "../storage";
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

  it("verifies an orphan by conditional HEAD before the documented plain delete", async () => {
    const send = vi.fn((command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return Promise.resolve({
          ContentType: "application/pdf",
          ContentLength: PDF.byteLength,
          ETag: '"exact-etag"',
        });
      }
      return Promise.resolve({});
    });
    const client = { send } as unknown as S3Client;

    await deletePrivateAgreementPdfFinalIfExact(
      {
        storageBucket: "docs",
        storageKey: `agreement-pdfs/${"d".repeat(64)}`,
        originalFileName: "agreement.pdf",
        contentType: "application/pdf",
        sizeBytes: PDF.byteLength,
        objectEtag: '"exact-etag"',
        sha256: "e".repeat(64),
      },
      client,
    );

    expect(send).toHaveBeenCalledTimes(2);
    const head = send.mock.calls[0]?.[0];
    const deletion = send.mock.calls[1]?.[0];
    expect(head).toBeInstanceOf(HeadObjectCommand);
    expect((head as HeadObjectCommand).input).toMatchObject({
      Key: `agreement-pdfs/${"d".repeat(64)}`,
      IfMatch: '"exact-etag"',
    });
    expect(deletion).toBeInstanceOf(DeleteObjectCommand);
    expect((deletion as DeleteObjectCommand).input).toMatchObject({
      Key: `agreement-pdfs/${"d".repeat(64)}`,
    });
    expect((deletion as DeleteObjectCommand).input.IfMatch).toBeUndefined();
  });

  it("derives a deterministic cleanup candidate before final verification resolves", async () => {
    const candidate = agreementPdfFinalCandidate(SECRET, payload);
    let headCount = 0;
    const client = {
      send: vi.fn((command: unknown) => {
        if (command instanceof HeadObjectCommand) {
          headCount += 1;
          return Promise.resolve({
            ContentType: "application/pdf",
            ContentLength: PDF.byteLength,
            ETag: '"candidate-etag"',
          });
        }
        if (command instanceof GetObjectCommand) return Promise.resolve({ Body: body(PDF) });
        return Promise.reject(new Error("unexpected command"));
      }),
    } as unknown as S3Client;

    expect(candidate.storageKey).toMatch(/^agreement-pdfs\/[a-f0-9]{64}$/);
    await expect(
      resolvePrivateAgreementPdfFinalCandidate(candidate, client),
    ).resolves.toMatchObject({
      storageKey: candidate.storageKey,
      objectEtag: '"candidate-etag"',
      sha256: createHash("sha256").update(PDF).digest("hex"),
    });
    expect(headCount).toBe(1);
  });

  it("treats only a definite missing object as absent during cleanup", async () => {
    const candidate = agreementPdfFinalCandidate(SECRET, payload);
    const missing = {
      send: vi.fn(() =>
        Promise.reject(
          Object.assign(new Error("missing"), {
            name: "NoSuchKey",
            $metadata: { httpStatusCode: 404 },
          }),
        ),
      ),
    } as unknown as S3Client;
    const ambiguousMissing = {
      send: vi.fn(() => Promise.reject(Object.assign(new Error("missing"), { name: "NoSuchKey" }))),
    } as unknown as S3Client;
    const unavailable = {
      send: vi.fn(() =>
        Promise.reject(
          Object.assign(new Error("unavailable"), {
            name: "ServiceUnavailable",
            $metadata: { httpStatusCode: 503 },
          }),
        ),
      ),
    } as unknown as S3Client;

    await expect(resolvePrivateAgreementPdfFinalCandidate(candidate, missing)).resolves.toBeNull();
    await expect(
      resolvePrivateAgreementPdfFinalCandidate(candidate, ambiguousMissing),
    ).rejects.toThrow(/could not verify storage/i);
    await expect(resolvePrivateAgreementPdfFinalCandidate(candidate, unavailable)).rejects.toThrow(
      /could not verify storage/i,
    );
  });
});
