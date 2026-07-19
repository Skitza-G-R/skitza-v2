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

  it("uses compact archive copy while keeping the full preservation details available", () => {
    expect(SRC).toContain(
      "Moves ${client.name} to Archived. Artist access and complete history stay unchanged.",
    );
    expect(SRC).toContain("What stays unchanged?");

    const lowerSource = SRC.toLowerCase();
    for (const text of [
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
      expect(lowerSource).toContain(text);
    }
  });

  it("explains the Active or Waiting for payment archive block", () => {
    expect(SRC).toMatch(/Active or Waiting for payment/);
    expect(SRC).toContain("blockedReason");
  });

  it("removes the dead archive action when blocked but never lets a stale reason block restore", () => {
    expect(SRC).toMatch(/const archiveIsBlocked = !isRestore && Boolean\(effectiveBlockedReason\)/);
    expect(SRC).toContain("if (archiveIsBlocked) return;");
    expect(SRC).toContain("Can’t archive");
    expect(SRC).toContain("Got it");
    expect(SRC).toMatch(/!archiveIsBlocked\s*\?\s*\(/);
    expect(SRC).not.toMatch(/disabled=\{pending\s*\|\|\s*archiveIsBlocked\}/);
  });
});
