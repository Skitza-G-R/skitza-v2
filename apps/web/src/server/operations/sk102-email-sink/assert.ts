import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { Sk102EmailKind } from "@skitza/db/sk102-runtime";

import { sk102EmailCapturePrefix } from "~/server/email/sk102-capture";

export async function countSk102EmailCaptures(input: {
  client: S3Client;
  bucket: string;
  slot: string;
  kind: Sk102EmailKind;
}): Promise<number> {
  let continuationToken: string | undefined;
  let count = 0;

  do {
    const result = await input.client.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: sk102EmailCapturePrefix(input.slot, input.kind),
        ContinuationToken: continuationToken,
      }),
    );
    count += result.Contents?.length ?? 0;
    if (result.IsTruncated && !result.NextContinuationToken) {
      throw new Error("SK102_EMAIL_ASSERT_PAGINATION_INVALID");
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return count;
}
