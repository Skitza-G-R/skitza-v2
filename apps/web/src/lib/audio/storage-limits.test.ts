import { describe, expect, it } from "vitest";

import {
  AUDIO_MULTIPART_PART_SIZE_BYTES,
  AUDIO_UPLOAD_MAX_BYTES,
  expectedAudioMultipartPartSize,
  PRODUCER_AUDIO_STORAGE_LIMIT_BYTES,
  PRODUCER_AUDIO_STORAGE_WARNING_BYTES,
} from "./storage-limits";

describe("beta audio storage limits", () => {
  it("uses the agreed decimal byte values", () => {
    expect(AUDIO_UPLOAD_MAX_BYTES).toBe(100_000_000);
    expect(AUDIO_MULTIPART_PART_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(PRODUCER_AUDIO_STORAGE_WARNING_BYTES).toBe(800_000_000);
    expect(PRODUCER_AUDIO_STORAGE_LIMIT_BYTES).toBe(1_000_000_000);
  });

  it("derives the exact allowed length for every multipart part", () => {
    const totalBytes = AUDIO_MULTIPART_PART_SIZE_BYTES * 2 + 17;

    expect(expectedAudioMultipartPartSize(totalBytes, 1)).toBe(AUDIO_MULTIPART_PART_SIZE_BYTES);
    expect(expectedAudioMultipartPartSize(totalBytes, 2)).toBe(AUDIO_MULTIPART_PART_SIZE_BYTES);
    expect(expectedAudioMultipartPartSize(totalBytes, 3)).toBe(17);
    expect(expectedAudioMultipartPartSize(totalBytes, 4)).toBeNull();
    expect(expectedAudioMultipartPartSize(totalBytes, 0)).toBeNull();
  });

  it("keeps a final exact-size chunk at the full shared part size", () => {
    expect(expectedAudioMultipartPartSize(AUDIO_MULTIPART_PART_SIZE_BYTES * 2, 2)).toBe(
      AUDIO_MULTIPART_PART_SIZE_BYTES,
    );
  });
});
