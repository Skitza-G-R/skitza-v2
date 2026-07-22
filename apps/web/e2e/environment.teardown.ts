import { test as teardown } from "@playwright/test";
import { spawnSync } from "node:child_process";

import { manifestPathForSlot, REPOSITORY_ROOT, slotFromProjectMetadata } from "./support/manifest";

teardown("clean isolated fixture slot", ({ baseURL: _baseURL }, testInfo) => {
  void _baseURL;
  const slot = slotFromProjectMetadata(testInfo.project.metadata);
  const result = spawnSync(
    "corepack",
    ["pnpm", "e2e:cleanup", "--", "--slot", slot, "--manifest", manifestPathForSlot(slot)],
    {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    throw new Error(`Isolated fixture cleanup failed for ${slot}; command output was withheld.`);
  }
});
