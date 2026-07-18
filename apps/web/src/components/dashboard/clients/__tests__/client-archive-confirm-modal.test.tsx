import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "client-archive-confirm-modal.tsx"), "utf8");

describe("ClientArchiveConfirmModal", () => {
  it("calls the archive or restore server action from the current state", () => {
    expect(SRC).toContain("archiveClientAction");
    expect(SRC).toContain("restoreClientAction");
    expect(SRC).toMatch(/client\.archived\s*\?\s*restoreClientAction/);
  });

  it("states that archive changes list placement only and preserves access and history", () => {
    for (const text of [
      "Clients list",
      "artist access",
      "projects",
      "songs",
      "public links",
      "purchases",
      "offers",
      "agreements",
      "payments",
      "proofs",
      "sessions",
      "versions",
      "comments",
    ]) {
      expect(SRC).toContain(text);
    }
  });

  it("explains the Active or Waiting for payment archive block", () => {
    expect(SRC).toMatch(/Active or Waiting for payment/);
    expect(SRC).toContain("blockedReason");
  });

  it("blocks archive submission but never lets a stale reason block restore", () => {
    expect(SRC).toMatch(
      /const archiveIsBlocked = !isRestore && Boolean\(blockedReason\)/,
    );
    expect(SRC).toContain("if (archiveIsBlocked) return;");
    expect(SRC).toMatch(/disabled=\{pending \|\| archiveIsBlocked\}/);
  });
});
