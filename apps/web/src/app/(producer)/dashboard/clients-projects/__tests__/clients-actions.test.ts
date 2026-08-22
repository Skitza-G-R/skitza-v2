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
  it("keeps provider accepted, sending, failed, and existing outcomes distinct", () => {
    expect(SRC).toMatch(/existed:\s*true/);
    expect(SRC).toMatch(
      /existed:\s*false[\s\S]*?invitationState:\s*"provider_accepted"[\s\S]*?invitedAtIso:\s*string/,
    );
    expect(SRC).toMatch(/existed:\s*false[\s\S]*?invitationState:\s*"sending"/);
    expect(SRC).toMatch(/existed:\s*false[\s\S]*?invitationState:\s*"failed"/);
  });

  it("decouples create from sendInvite via two separate try/catch blocks", () => {
    // The create path's catch returns ok:false. The sendInvite catch
    // returns ok:true with invitationState:failed so the modal can
    // surface a soft "client added but email didn't go" toast.
    expect(SRC).toMatch(
      /createClientAction[\s\S]*?try\s*\{[\s\S]*?clientContacts\.create[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?ok:\s*false/,
    );
    expect(SRC).toMatch(
      /try\s*\{[\s\S]*?clientContacts\.sendInvite[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?invitationState:\s*"failed"/,
    );
  });

  it("supplies an operation key and claims sent only with provider evidence", () => {
    expect(SRC).toMatch(/operationKey:\s*`new-client-invite:\$\{createdId\}:\$\{randomUUID\(\)\}`/);
    expect(SRC).toMatch(/sent\.deliveryState === "sending"/);
    expect(SRC).toMatch(/invitationState:\s*"provider_accepted"/);
    expect(SRC).toMatch(/sent\.providerAcceptedAt\.toISOString\(\)/);
  });

  it("logs the underlying email-send error so it shows up in Vercel logs", () => {
    expect(SRC).toMatch(/console\.error\([^)]*?invite send failed/);
  });

  it("revalidates the list path on all three terminal success branches", () => {
    // existed, provider accepted, sending, and failed
    // all revalidate so the LinkPill state reflects DB reality.
    const occurrences = SRC.match(/revalidatePath\(CLIENTS_PATH\)/g) ?? [];
    // Three success returns (existed, success, soft-fail) + the two
    // reorder wrappers below = 5 total in this file.
    expect(occurrences.length).toBeGreaterThanOrEqual(5);
  });
});

describe("sendClientInviteAction", () => {
  it("requires the caller's stable operation key", () => {
    expect(SRC).toMatch(
      /sendClientInviteAction\(input:\s*\{[\s\S]*?id:\s*string;[\s\S]*?via:[\s\S]*?operationKey:\s*string;/,
    );
    expect(SRC).toContain("clientContacts.sendInvite(input)");
  });

  it("exposes provider acceptance, in-flight delivery, and link copy as different states", () => {
    expect(SRC).toContain('deliveryState: "provider_accepted"');
    expect(SRC).toContain('deliveryState: "sending"');
    expect(SRC).toMatch(/via:\s*"link",\s*deliveryState:\s*null,\s*providerAcceptedAtIso:\s*null/);
    expect(SRC).toMatch(/providerAcceptedAtIso:\s*res\.providerAcceptedAt\.toISOString\(\)/);
  });

  it("requires a new deliberate operation after a conflict without auto-sending", () => {
    expect(SRC).toMatch(/err\.code === "CONFLICT"/);
    expect(SRC).toContain('code: "new_operation_required"');
    const sendSection = SRC.slice(
      SRC.indexOf("export async function sendClientInviteAction"),
      SRC.indexOf("// New Client modal"),
    );
    expect(sendSection).not.toContain("randomUUID");
  });
});

describe("createProjectAction", () => {
  it("creates only the work container and optional deadline", () => {
    const start = SRC.indexOf("export async function createProjectAction");
    const end = SRC.indexOf("// Edit + Remove", start);
    const section = SRC.slice(start, end);

    expect(section).toContain("deadlineAt");
    expect(section).not.toMatch(/productId|engagementTotalCents|depositCents/);
  });
});
