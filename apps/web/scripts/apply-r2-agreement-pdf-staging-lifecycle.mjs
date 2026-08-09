#!/usr/bin/env node
// Idempotently add or repair the docs-bucket lifecycle rule for abandoned
// private agreement PDF staging objects. Existing unrelated rules are read,
// retained in the PUT payload, and verified after the update.

import { isDeepStrictEqual } from "node:util";
import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  AGREEMENT_PDF_STAGING_EXPIRATION_DAYS,
  AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID,
  AGREEMENT_PDF_STAGING_PREFIX,
  agreementPdfFinalExpirationOverlapRules,
  inspectAgreementPdfStagingLifecycleRules,
  isMissingLifecycleConfiguration,
  upsertAgreementPdfStagingLifecycleRule,
} from "./r2-agreement-pdf-staging-lifecycle.mjs";

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
  return rules.filter((rule) => rule.ID !== AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID);
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

  const currentRules = await readRules(client, bucket);
  if (agreementPdfFinalExpirationOverlapRules(currentRules).length > 0) {
    throw new Error("Refusing lifecycle update because an expiration rule can match final PDFs");
  }
  const current = inspectAgreementPdfStagingLifecycleRules(currentRules);
  if (current.ok) {
    console.log(`✓ ${bucket}: ${AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID} is already correct`);
  } else {
    const nextRules = upsertAgreementPdfStagingLifecycleRule(currentRules);
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: { Rules: nextRules },
      }),
    );

    const verifiedRules = await readRules(client, bucket);
    const verified = inspectAgreementPdfStagingLifecycleRules(verifiedRules);
    if (!verified.ok) throw new Error("Lifecycle rule verification failed");
    if (!isDeepStrictEqual(unrelatedRules(verifiedRules), unrelatedRules(currentRules))) {
      throw new Error("Unrelated lifecycle rule verification failed");
    }

    console.log(
      `✓ ${bucket}: ${AGREEMENT_PDF_STAGING_LIFECYCLE_RULE_ID} now expires ${AGREEMENT_PDF_STAGING_PREFIX} after ${AGREEMENT_PDF_STAGING_EXPIRATION_DAYS} day`,
    );
  }
}

main().catch(() => {
  // Do not print SDK errors: they can contain endpoint or request metadata.
  console.error("❌ Could not apply the R2 agreement-PDF-staging lifecycle policy");
  process.exitCode = 1;
});
