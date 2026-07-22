import { expect, test as setup } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { manifestPathForSlot, REPOSITORY_ROOT, slotFromProjectMetadata } from "./support/manifest";

function runSeed(slot: string, manifestPath: string): void {
  const result = spawnSync(
    "corepack",
    ["pnpm", "e2e:seed", "--", "--slot", slot, "--manifest", manifestPath],
    {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    throw new Error(`Isolated fixture seed failed for ${slot}; command output was withheld.`);
  }
}

setup("seed isolated fixture slot", async ({ baseURL: _baseURL }, testInfo) => {
  void _baseURL;
  const slot = slotFromProjectMetadata(testInfo.project.metadata);
  const manifestPath = manifestPathForSlot(slot);
  runSeed(slot, manifestPath);
  await expect.poll(() => existsSync(manifestPath)).toBe(true);
});
