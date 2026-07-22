import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERATED_ROOT, manifestPathForSlot } from "./manifest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isolated browser fixture manifest paths", () => {
  it("accepts only the exact slot filename below the generated fixture root", () => {
    vi.stubEnv("SKITZA_E2E_MANIFEST", path.join(GENERATED_ROOT, "desktop.json"));
    expect(manifestPathForSlot("desktop")).toBe(path.join(GENERATED_ROOT, "desktop.json"));

    vi.stubEnv("SKITZA_E2E_MANIFEST", path.join(GENERATED_ROOT, "phone390.json"));
    expect(() => manifestPathForSlot("desktop")).toThrow("manifest path");
  });

  it("rejects manifest files and directories outside the disposable root", () => {
    vi.stubEnv("SKITZA_E2E_MANIFEST", path.resolve(GENERATED_ROOT, "../desktop.json"));
    expect(() => manifestPathForSlot("desktop")).toThrow("manifest path");

    vi.stubEnv("SKITZA_E2E_MANIFEST", "");
    vi.stubEnv("SKITZA_E2E_MANIFEST_DIR", path.resolve(GENERATED_ROOT, ".."));
    expect(() => manifestPathForSlot("desktop")).toThrow("manifest path");
  });
});
