import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/storage/r2", () => ({
  BUCKETS: { audio: "isolated-song-deletion-audio" },
  getR2: vi.fn(),
}));

import { reconcileLegacyPeaksDeletion } from "../storage";

const identity = {
  versionId: "22222222-2222-4222-8222-222222222222",
  key: "peaks/legacy-waveform.json",
};

it("conditionally erases and proves absence of one authorized legacy waveform", async () => {
  let state: "present" | "marker" | "absent" = "present";
  let fingerprint = "";
  const send = vi.fn((command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      if (state === "absent") {
        throw Object.assign(new Error("missing"), { name: "NotFound" });
      }
      if (state === "marker") {
        return { Metadata: { "skitza-peaks-deletion": fingerprint } };
      }
      return { ETag: '"legacy-peaks"' };
    }
    if (command instanceof PutObjectCommand) {
      fingerprint = command.input.Metadata?.["skitza-peaks-deletion"] ?? "";
      state = "marker";
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      state = "absent";
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      return {
        IsTruncated: false,
        Contents: state === "absent" ? [] : [{ Key: identity.key }],
      };
    }
    throw new Error("Unexpected command");
  });

  await expect(reconcileLegacyPeaksDeletion(identity, { send } as never)).resolves.toBeUndefined();
  await expect(reconcileLegacyPeaksDeletion(identity, { send } as never)).resolves.toBeUndefined();

  const marker = send.mock.calls
    .map(([command]) => command)
    .find((command) => command instanceof PutObjectCommand) as PutObjectCommand;
  expect(marker.input).toMatchObject({
    Bucket: "isolated-song-deletion-audio",
    Key: identity.key,
    IfMatch: '"legacy-peaks"',
  });
  expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
});

describe("legacy waveform deletion safety", () => {
  it("rejects a key outside the legacy waveform namespace", async () => {
    await expect(
      reconcileLegacyPeaksDeletion(
        { ...identity, key: "producers/another/audio.wav" },
        {} as never,
      ),
    ).rejects.toThrow("key was invalid");
  });

  it("fails closed when a HEAD 404 cannot be confirmed by listing", async () => {
    const send = vi.fn((command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        throw Object.assign(new Error("flattened"), { $metadata: { httpStatusCode: 404 } });
      }
      if (command instanceof ListObjectsV2Command) throw new Error("bucket unavailable");
      throw new Error("Unexpected command");
    });

    await expect(reconcileLegacyPeaksDeletion(identity, { send } as never)).rejects.toThrow(
      "bucket unavailable",
    );
  });

  it("does not delete a marker owned by a different receipt identity", async () => {
    const send = vi.fn((command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return { Metadata: { "skitza-peaks-deletion": `sha256:${"0".repeat(64)}` } };
      }
      throw new Error("Unexpected command");
    });

    await expect(reconcileLegacyPeaksDeletion(identity, { send } as never)).rejects.toThrow(
      "could not be erased safely",
    );
    expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  it("fails closed if the object changes before the conditional marker write", async () => {
    let headCount = 0;
    const send = vi.fn((command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        headCount += 1;
        return { ETag: headCount === 1 ? '"original"' : '"replacement"' };
      }
      if (command instanceof PutObjectCommand) {
        throw Object.assign(new Error("precondition failed"), { name: "PreconditionFailed" });
      }
      throw new Error("Unexpected command");
    });

    await expect(reconcileLegacyPeaksDeletion(identity, { send } as never)).rejects.toThrow(
      "could not be erased safely",
    );
    expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });
});
