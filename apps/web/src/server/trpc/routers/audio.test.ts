import { describe, it, expect } from "vitest";
import { validateUploadInput } from "./audio";

describe("audio upload validation", () => {
  it("rejects files over 500MB", () => {
    expect(() => {
      validateUploadInput({ filename: "x.wav", sizeBytes: 501 * 1024 * 1024, contentType: "audio/wav" });
    }).toThrow(/500 ?MB/i);
  });
  it("rejects non-audio content types", () => {
    expect(() => {
      validateUploadInput({ filename: "x.jpg", sizeBytes: 1000, contentType: "image/jpeg" });
    }).toThrow(/audio/i);
  });
  it("accepts wav/mp3/flac/m4a/aiff", () => {
    for (const ct of ["audio/wav", "audio/mpeg", "audio/flac", "audio/x-m4a", "audio/aiff"]) {
      expect(() => {
        validateUploadInput({ filename: "x", sizeBytes: 1000, contentType: ct });
      }).not.toThrow();
    }
  });
});
