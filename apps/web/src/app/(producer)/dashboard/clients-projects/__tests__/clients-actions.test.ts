import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep style tests (no jsdom). The action wraps tRPC procedures
// so a real integration test would need Clerk + DB + Resend wiring —
// out of scope for unit tests. These guard the structural invariants
// the modal contract depends on.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "clients-actions.ts"), "utf-8");

describe("createClientAction", () => {
  it("declares the discriminated union for the new + existing + email-failed shapes", () => {
    expect(SRC).toMatch(/existed:\s*true/);
    expect(SRC).toMatch(/existed:\s*false[\s\S]*?inviteEmailFailed:\s*false[\s\S]*?invitedAtIso:\s*string/);
    expect(SRC).toMatch(/existed:\s*false[\s\S]*?inviteEmailFailed:\s*true/);
  });

  it("decouples create from sendInvite via two separate try/catch blocks", () => {
    // The create path's catch returns ok:false. The sendInvite catch
    // returns ok:true with inviteEmailFailed:true so the modal can
    // surface a soft "client added but email didn't go" toast.
    expect(SRC).toMatch(
      /createClientAction[\s\S]*?try\s*\{[\s\S]*?clientContacts\.create[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?ok:\s*false/,
    );
    expect(SRC).toMatch(
      /try\s*\{[\s\S]*?clientContacts\.sendInvite[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?inviteEmailFailed:\s*true/,
    );
  });

  it("logs the underlying email-send error so it shows up in Vercel logs", () => {
    expect(SRC).toMatch(/console\.error\([^)]*?invite send failed/);
  });

  it("revalidates the list path on all three terminal success branches", () => {
    // existed:true, inviteEmailFailed:false, inviteEmailFailed:true
    // all revalidate so the LinkPill state reflects DB reality.
    const occurrences = SRC.match(/revalidatePath\(CLIENTS_PATH\)/g) ?? [];
    // Three success returns (existed, success, soft-fail) + the two
    // reorder wrappers below = 5 total in this file.
    expect(occurrences.length).toBeGreaterThanOrEqual(5);
  });
});
