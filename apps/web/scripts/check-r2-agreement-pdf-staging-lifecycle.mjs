#!/usr/bin/env node
// Read-only check for the docs-bucket rule that bounds abandoned private
// agreement PDF staging objects. The rule must never match final agreements.

import { GetBucketLifecycleConfigurationCommand, S3Client } from "@aws-sdk/client-s3";

import {
  AGREEMENT_PDF_STAGING_EXPIRATION_DAYS,
  AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID,
  AGREEMENT_PDF_STAGING_PREFIX,
  inspectAgreementPdfStagingLifecycleRules,
  isMissingLifecycleConfiguration,
} from "./r2-agreement-pdf-staging-lifecycle.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main() {
  const bucket = required("R2_BUCKET_DOCS");
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

  const result = inspectAgreementPdfStagingLifecycleRules(rules);
  if (!result.ok) {
    console.error(`❌ ${result.message}`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ ${bucket}: ${AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID} expires ${AGREEMENT_PDF_STAGING_PREFIX} after ${AGREEMENT_PDF_STAGING_EXPIRATION_DAYS} day`,
    );
  }
}

main().catch(() => {
  // Do not print SDK errors: they can contain endpoint or request metadata.
  console.error("❌ Could not verify the R2 agreement-PDF-staging lifecycle policy");
  process.exitCode = 1;
});
