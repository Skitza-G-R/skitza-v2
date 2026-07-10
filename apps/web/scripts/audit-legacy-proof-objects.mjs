import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const bucket = requireEnv("R2_BUCKET_AUDIO");
const client = new S3Client({
  region: "auto",
  endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  },
});

let continuationToken;
let scannedObjects = 0;
let legacyProofObjects = 0;
let legacyProofBytes = 0;

try {
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "producers/",
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of page.Contents ?? []) {
      scannedObjects += 1;
      if (/^producers\/[^/]+\/proofs\//.test(object.Key ?? "")) {
        legacyProofObjects += 1;
        legacyProofBytes += object.Size ?? 0;
      }
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(
    JSON.stringify({
      bucket,
      scannedObjects,
      legacyProofObjects,
      legacyProofBytes,
      clean: legacyProofObjects === 0,
    }),
  );

  if (legacyProofObjects > 0) process.exitCode = 2;
} catch {
  // Do not print storage errors: SDK errors may contain endpoint or object
  // metadata. The operator only needs a fail-closed signal here.
  console.error("Legacy proof-object inventory failed");
  process.exitCode = 1;
}
