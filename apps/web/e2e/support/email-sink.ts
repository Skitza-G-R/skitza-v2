import { spawnSync } from "node:child_process";

import { REPOSITORY_ROOT, type E2ESlot } from "./manifest";

export type SinkMessageKind = "client-invite" | "payment-reminder";

export function assertSinkMessage(slot: E2ESlot, kind: SinkMessageKind): void {
  const result = spawnSync(
    "corepack",
    ["pnpm", "--filter", "web", "e2e:assert-email", "--", "--slot", slot, "--kind", kind],
    {
      cwd: REPOSITORY_ROOT,
      env: process.env,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    throw new Error(`Email sink assertion failed for ${kind}; command output was withheld.`);
  }
}
