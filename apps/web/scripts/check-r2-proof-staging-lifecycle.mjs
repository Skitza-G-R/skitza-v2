#!/usr/bin/env node
// Read-only check for the docs-bucket rule that bounds abandoned private
// payment-proof staging objects. The rule must never match final evidence.
//
// Usage:
//   set -a && . apps/web/.env.local && set +a
//   node apps/web/scripts/check-r2-proof-staging-lifecycle.mjs

import { GetBucketLifecycleConfigurationCommand, S3Client } from "@aws-sdk/client-s3";

import {
  PROOF_STAGING_EXPIRATION_DAYS,
  PROOF_STAGING_LIFECYCLE_RULE_ID,
  PROOF_STAGING_PREFIX,
  inspectProofStagingLifecycleRules,
  isMissingLifecycleConfiguration,
} from "./r2-proof-staging-lifecycle.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
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

  let rules;
  try {
    const response = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    rules = response.Rules ?? [];
  } catch (error) {
    if (!isMissingLifecycleConfiguration(error)) throw error;
    rules = [];
  }

  const result = inspectProofStagingLifecycleRules(rules);
  if (!result.ok) {
    console.error(`❌ ${result.message}`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ ${bucket}: ${PROOF_STAGING_LIFECYCLE_RULE_ID} expires ${PROOF_STAGING_PREFIX} after ${PROOF_STAGING_EXPIRATION_DAYS} day`,
    );
  }
}

main().catch(() => {
  // Do not print SDK errors: they can contain endpoint or request metadata.
  console.error("❌ Could not verify the R2 proof-staging lifecycle policy");
  process.exitCode = 1;
});
