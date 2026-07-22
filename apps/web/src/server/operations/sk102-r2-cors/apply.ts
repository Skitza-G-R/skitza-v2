import { GetBucketCorsCommand, PutBucketCorsCommand, type S3Client } from "@aws-sdk/client-s3";
import type { ApprovedSk102Runtime } from "@skitza/db/sk102-runtime";

import { buildSk102R2CorsRules } from "~/server/storage/r2-cors";

export async function applySk102R2Cors(input: {
  client: S3Client;
  runtime: ApprovedSk102Runtime;
  mutationConfirmation: string | undefined;
  onApplied?: (role: "audio" | "docs") => void;
}): Promise<void> {
  if (input.mutationConfirmation !== "approved-exact-sk102-r2-cors-targets") {
    throw new Error("SK102_R2_CORS_APPROVAL_REQUIRED");
  }

  const rules = buildSk102R2CorsRules();
  for (const [role, bucket] of [
    ["audio", input.runtime.audioBucket],
    ["docs", input.runtime.docsBucket],
  ] as const) {
    await input.client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: rules },
      }),
    );
    const observed = await input.client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    if (JSON.stringify(observed.CORSRules) !== JSON.stringify(rules)) {
      throw new Error("SK102_R2_CORS_VERIFY_FAILED");
    }
    input.onApplied?.(role);
  }
}
