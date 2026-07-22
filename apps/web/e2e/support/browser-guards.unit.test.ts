import { describe, expect, it } from "vitest";

import { isolatedR2Origins } from "./browser-guards";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

describe("isolated browser R2 guard targets", () => {
  it("derives only the account and two virtual-hosted bucket origins", () => {
    expect([
      ...isolatedR2Origins({
        R2_ACCOUNT_ID: ACCOUNT_ID,
        R2_BUCKET_AUDIO: "sk102-audio",
        R2_BUCKET_DOCS: "sk102-docs",
      }),
    ]).toEqual([
      `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      `https://sk102-audio.${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      `https://sk102-docs.${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    ]);
  });

  it("fails closed when the account or bucket contract is missing or invalid", () => {
    expect(() =>
      isolatedR2Origins({
        R2_ACCOUNT_ID: "not-an-account",
        R2_BUCKET_AUDIO: "sk102-audio",
        R2_BUCKET_DOCS: "sk102-docs",
      }),
    ).toThrow("valid isolated R2 account target");

    expect(() =>
      isolatedR2Origins({
        R2_ACCOUNT_ID: ACCOUNT_ID,
        R2_BUCKET_AUDIO: "sk102-shared",
        R2_BUCKET_DOCS: "sk102-shared",
      }),
    ).toThrow("two valid isolated R2 buckets");
  });
});
