#!/usr/bin/env node
// Idempotently add or repair the docs-bucket lifecycle rule for abandoned
// private payment-proof staging objects. Existing unrelated rules are read,
// retained in the PUT payload, and verified after the update.
//
// Usage:
//   set -a && . apps/web/.env.local && set +a
//   node apps/web/scripts/apply-r2-proof-staging-lifecycle.mjs

import { isDeepStrictEqual } from "node:util";
import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  PROOF_STAGING_EXPIRATION_DAYS,
  PROOF_STAGING_LIFECYCLE_RULE_ID,
  PROOF_STAGING_PREFIX,
  inspectProofStagingLifecycleRules,
  isMissingLifecycleConfiguration,
  upsertProofStagingLifecycleRule,
} from "./r2-proof-staging-lifecycle.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function readRules(client, bucket) {
  try {
    const result = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    return result.Rules ?? [];
  } catch (error) {
    if (isMissingLifecycleConfiguration(error)) return [];
    throw error;
  }
}

function unrelatedRules(rules) {
  return rules.filter((rule) => rule.ID !== PROOF_STAGING_LIFECYCLE_RULE_ID);
}

async function main() {
  const bucket = process.env.R2_BUCKET_DOCS ?? "skitza-docs";
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });

  const currentRules = await readRules(client, bucket);
  const current = inspectProofStagingLifecycleRules(currentRules);
  if (current.ok) {
    console.log(`✓ ${bucket}: ${PROOF_STAGING_LIFECYCLE_RULE_ID} is already correct`);
  } else {
    const nextRules = upsertProofStagingLifecycleRule(currentRules);
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: { Rules: nextRules },
      }),
    );

    const verifiedRules = await readRules(client, bucket);
    const verified = inspectProofStagingLifecycleRules(verifiedRules);
    if (!verified.ok) throw new Error("Lifecycle rule verification failed");
    if (!isDeepStrictEqual(unrelatedRules(verifiedRules), unrelatedRules(currentRules))) {
      throw new Error("Unrelated lifecycle rule verification failed");
    }

    console.log(
      `✓ ${bucket}: ${PROOF_STAGING_LIFECYCLE_RULE_ID} now expires ${PROOF_STAGING_PREFIX} after ${PROOF_STAGING_EXPIRATION_DAYS} day`,
    );
  }
}

main().catch(() => {
  // Do not print SDK errors: they can contain endpoint or request metadata.
  console.error("❌ Could not apply the R2 proof-staging lifecycle policy");
  process.exitCode = 1;
});
