import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { browserEvidenceEnabled, writeSafeBrowserEvidence } from "./safe-reporter";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("secret-safe browser evidence mode", () => {
  it("writes evidence only for an actual run, never discovery-only listing", () => {
    expect(browserEvidenceEnabled({ SKITZA_E2E_LIST_ONLY: "0" })).toBe(true);
    expect(browserEvidenceEnabled({})).toBe(true);
    expect(browserEvidenceEnabled({ SKITZA_E2E_LIST_ONLY: "1" })).toBe(false);
  });

  it("writes mode-0600 evidence only below a physically confined directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sk102-evidence-test-"));
    temporaryDirectories.push(root);
    await writeSafeBrowserEvidence(root, "desktop", "passed", []);
    const target = resolve(root, "apps/web/browser-evidence/desktop.json");
    expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({
      schemaVersion: 1,
      slot: "desktop",
      status: "passed",
    });
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("does not follow evidence directory or file symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "sk102-evidence-symlink-test-"));
    const outside = await mkdtemp(join(tmpdir(), "sk102-evidence-symlink-outside-"));
    temporaryDirectories.push(root, outside);
    await mkdir(resolve(root, "apps/web"), { recursive: true });
    await writeFile(resolve(outside, "keep.json"), "keep");
    await symlink(outside, resolve(root, "apps/web/browser-evidence"));
    await expect(writeSafeBrowserEvidence(root, "desktop", "passed", [])).rejects.toThrow(
      "SK102_LOCAL_PATH_UNSAFE",
    );
    await expect(readFile(resolve(outside, "keep.json"), "utf8")).resolves.toBe("keep");

    await rm(resolve(root, "apps/web/browser-evidence"));
    await mkdir(resolve(root, "apps/web/browser-evidence"));
    await symlink(
      resolve(outside, "keep.json"),
      resolve(root, "apps/web/browser-evidence/desktop.json"),
    );
    await expect(writeSafeBrowserEvidence(root, "desktop", "passed", [])).rejects.toThrow(
      "SK102_LOCAL_PATH_UNSAFE",
    );
    await expect(readFile(resolve(outside, "keep.json"), "utf8")).resolves.toBe("keep");
  });
});
