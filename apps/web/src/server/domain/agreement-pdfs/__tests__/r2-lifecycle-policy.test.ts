import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lifecycleModule = join(process.cwd(), "scripts/r2-agreement-pdf-staging-lifecycle.mjs");
const applyScript = readFileSync(
  join(process.cwd(), "scripts/apply-r2-agreement-pdf-staging-lifecycle.mjs"),
  "utf8",
);
const checkScript = readFileSync(
  join(process.cwd(), "scripts/check-r2-agreement-pdf-staging-lifecycle.mjs"),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

type LifecycleProbe = Readonly<{
  required: {
    ID: string;
    Status: string;
    Filter: { Prefix: string };
    Expiration: { Days: number };
  };
  currentCheck: { ok: boolean; message: string };
  check: { ok: boolean; message: string };
  merged: Array<Record<string, unknown>>;
}>;

function probeLifecycleModule(input: Array<Record<string, unknown>>): LifecycleProbe {
  const source = `
    const policy = await import(${JSON.stringify(lifecycleModule)});
    const input = JSON.parse(process.argv[1]);
    const required = policy.requiredAgreementPdfStagingLifecycleRule();
    const currentCheck = policy.inspectAgreementPdfStagingLifecycleRules(input);
    const merged = policy.upsertAgreementPdfStagingLifecycleRule(input);
    const check = policy.inspectAgreementPdfStagingLifecycleRules(merged);
    process.stdout.write(JSON.stringify({ required, currentCheck, merged, check }));
  `;
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", source, JSON.stringify(input)],
      { encoding: "utf8" },
    ),
  ) as LifecycleProbe;
}

describe("R2 agreement PDF staging lifecycle policy", () => {
  it("requires the exact docs bucket instead of guessing a target", () => {
    for (const script of [applyScript, checkScript]) {
      expect(script).toContain('const bucket = required("R2_BUCKET_DOCS");');
      expect(script).not.toMatch(/R2_BUCKET_DOCS\s*\?\?/);
    }
    expect(packageJson.scripts?.["readiness:agreement-pdf-staging"]).toBe(
      "node scripts/check-r2-agreement-pdf-staging-lifecycle.mjs",
    );
    expect(packageJson.scripts?.["ops:apply-agreement-pdf-staging-lifecycle"]).toBe(
      "node scripts/apply-r2-agreement-pdf-staging-lifecycle.mjs",
    );
  });

  it("targets only staging objects and expires them after one day", () => {
    const result = probeLifecycleModule([]);

    expect(result.currentCheck.ok).toBe(false);
    expect(result.required).toEqual({
      ID: "skitza-agreement-pdf-staging-expire-after-1-day",
      Status: "Enabled",
      Filter: { Prefix: "agreement-pdf-staging/" },
      Expiration: { Days: 1 },
    });
    expect("agreement-pdf-staging/object".startsWith(result.required.Filter.Prefix)).toBe(true);
    expect("agreement-pdfs/object".startsWith(result.required.Filter.Prefix)).toBe(false);
    expect(result.check.ok).toBe(true);
  });

  it("preserves every unrelated lifecycle rule while repairing its stable rule", () => {
    const unrelatedRule = {
      ID: "existing-proof-rule",
      Status: "Enabled",
      Filter: { Prefix: "proof-staging/" },
      Expiration: { Days: 1 },
    };
    const wrongRule = {
      ID: "skitza-agreement-pdf-staging-expire-after-1-day",
      Status: "Enabled",
      Filter: { Prefix: "" },
      Expiration: { Days: 7 },
    };

    const result = probeLifecycleModule([unrelatedRule, wrongRule]);

    expect(result.currentCheck.ok).toBe(false);
    expect(result.merged[0]).toEqual(unrelatedRule);
    expect(result.merged).toHaveLength(2);
    expect(result.check.ok).toBe(true);
  });

  it.each([
    ["a catch-all empty prefix", { Filter: { Prefix: "" } }],
    ["a no-filter rule", {}],
    ["a broader agreement prefix", { Filter: { Prefix: "agreement-" } }],
    ["a child of the final prefix", { Filter: { Prefix: "agreement-pdfs/accepted/" } }],
    ["an unknown tag-only filter", { Filter: { Tag: { Key: "kind", Value: "temporary" } } }],
    [
      "an ambiguous multi-key filter",
      {
        Filter: {
          Prefix: "proof-staging/",
          Tag: { Key: "kind", Value: "temporary" },
        },
      },
    ],
  ])("fails closed when %s could expire immutable final PDFs", (_label, filterShape) => {
    const required = probeLifecycleModule([]).required;
    const unsafeRule = {
      ID: "existing-unsafe-expiration",
      Status: "Enabled",
      Expiration: { Days: 1 },
      ...filterShape,
    };

    const result = probeLifecycleModule([required, unsafeRule]);

    expect(result.currentCheck).toEqual({
      ok: false,
      message: "An enabled lifecycle expiration rule can match immutable agreement-pdfs objects",
    });
    expect(result.check.ok).toBe(false);
  });

  it("allows disabled, non-expiration, and provably disjoint preserved rules", () => {
    const required = probeLifecycleModule([]).required;
    const result = probeLifecycleModule([
      required,
      {
        ID: "disabled-catch-all",
        Status: "Disabled",
        Expiration: { Days: 1 },
      },
      {
        ID: "abort-only",
        Status: "Enabled",
        Filter: { Prefix: "" },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      },
      {
        ID: "proof-expiration",
        Status: "Enabled",
        Filter: { Prefix: "proof-staging/" },
        Expiration: { Days: 1 },
      },
      {
        ID: "proof-and-expiration",
        Status: "Enabled",
        Filter: {
          And: {
            Prefix: "proof-staging/",
            Tags: [{ Key: "kind", Value: "temporary" }],
          },
        },
        Expiration: { Days: 1 },
      },
    ]);

    expect(result.currentCheck.ok).toBe(true);
    expect(result.check.ok).toBe(true);
  });

  it("checks existing final-prefix overlap before any lifecycle PUT", () => {
    expect(applyScript).toContain("agreementPdfFinalExpirationOverlapRules(currentRules)");
    expect(
      applyScript.indexOf("agreementPdfFinalExpirationOverlapRules(currentRules)"),
    ).toBeLessThan(applyScript.indexOf("new PutBucketLifecycleConfigurationCommand"));
  });
});
