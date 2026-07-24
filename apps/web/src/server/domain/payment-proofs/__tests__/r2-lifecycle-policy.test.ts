import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lifecycleModule = join(process.cwd(), "scripts/r2-proof-staging-lifecycle.mjs");
const applyScript = readFileSync(
  join(process.cwd(), "scripts/apply-r2-proof-staging-lifecycle.mjs"),
  "utf8",
);
const checkScript = readFileSync(
  join(process.cwd(), "scripts/check-r2-proof-staging-lifecycle.mjs"),
  "utf8",
);

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
    const required = policy.requiredProofStagingLifecycleRule();
    const currentCheck = policy.inspectProofStagingLifecycleRules(input);
    const merged = policy.upsertProofStagingLifecycleRule(input);
    const check = policy.inspectProofStagingLifecycleRules(merged);
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

describe("R2 payment-proof staging lifecycle policy", () => {
  it("requires the exact docs bucket instead of guessing a target", () => {
    for (const script of [applyScript, checkScript]) {
      expect(script).toContain('const bucket = required("R2_BUCKET_DOCS");');
      expect(script).not.toMatch(/R2_BUCKET_DOCS\s*\?\?/);
    }
  });

  it("targets only proof-staging objects and expires them after one day", () => {
    const result = probeLifecycleModule([]);

    expect(result.currentCheck.ok).toBe(false);
    expect(result.required).toEqual({
      ID: "skitza-proof-staging-expire-after-1-day",
      Status: "Enabled",
      Filter: { Prefix: "proof-staging/" },
      Expiration: { Days: 1 },
    });
    expect("proof-staging/object".startsWith(result.required.Filter.Prefix)).toBe(true);
    expect("proof-evidence/object".startsWith(result.required.Filter.Prefix)).toBe(false);
    expect(result.check.ok).toBe(true);
  });

  it("preserves every unrelated lifecycle rule while repairing its stable rule", () => {
    const unrelatedRule = {
      ID: "existing-audio-rule",
      Status: "Enabled",
      Filter: { Prefix: "audio/" },
      Expiration: { Days: 30 },
    };
    const wrongRule = {
      ID: "skitza-proof-staging-expire-after-1-day",
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
});
