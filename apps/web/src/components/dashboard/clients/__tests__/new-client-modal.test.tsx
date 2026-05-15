import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep style tests (no jsdom). Mirrors the existing repo pattern
// in apps/web/src/components/dashboard/clients/__tests__/invite-modal.test.tsx.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "new-client-modal.tsx"), "utf-8");

describe("NewClientModal", () => {
  it("uses Radix Dialog Portal for portaling to body", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/Portal/);
  });

  it("declares the NewClientModalProps shape with open, onClose, optional onCreated", () => {
    expect(SRC).toMatch(/open:\s*boolean/);
    expect(SRC).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    expect(SRC).toMatch(/onCreated\?:/);
  });

  it("has a required Name input", () => {
    // Field has `required` attribute AND an htmlFor/id pointing at it.
    expect(SRC).toMatch(/id="new-client-name"/);
    expect(SRC).toMatch(/<input[\s\S]*?id="new-client-name"[\s\S]*?required/);
  });

  it("has a required Email input", () => {
    expect(SRC).toMatch(/id="new-client-email"/);
    expect(SRC).toMatch(/<input[\s\S]*?id="new-client-email"[\s\S]*?required/);
  });

  it("has a Phone input that is NOT required", () => {
    expect(SRC).toMatch(/id="new-client-phone"/);
    // Pull only the phone input element — anchor to the nearest `<input`
    // before the id and stop at the matching `/>`.
    const phoneIdx = SRC.indexOf('id="new-client-phone"');
    expect(phoneIdx).toBeGreaterThan(0);
    const inputStart = SRC.lastIndexOf("<input", phoneIdx);
    const inputEnd = SRC.indexOf("/>", phoneIdx);
    expect(inputStart).toBeGreaterThan(-1);
    expect(inputEnd).toBeGreaterThan(inputStart);
    const phoneSlice = SRC.slice(inputStart, inputEnd + 2);
    expect(phoneSlice).not.toMatch(/\brequired\b/);
  });

  it("has a Notes textarea", () => {
    expect(SRC).toMatch(/id="new-client-notes"/);
    expect(SRC).toMatch(/<textarea[\s\S]*?id="new-client-notes"/);
  });

  it("renders the amber 'Invitation will be emailed' hint block", () => {
    expect(SRC).toContain("Invitation will be emailed");
  });

  it("renders the 'Add client' primary CTA text", () => {
    expect(SRC).toContain("Add client");
  });

  it("renders the 'Cancel' secondary action text", () => {
    expect(SRC).toContain("Cancel");
  });

  it("calls createClientAction Server Action (not direct tRPC client)", () => {
    // The repo uses Server Actions exclusively — no client-side useMutation.
    expect(SRC).toMatch(/createClientAction/);
    expect(SRC).not.toMatch(/useMutation/);
  });

  it("detects existed:true and routes to the client's space", () => {
    expect(SRC).toMatch(/res\.data\.existed/);
    expect(SRC).toMatch(/\/dashboard\/clients-projects\/clients\//);
  });

  it("calls onCreated callback after a successful add (so the parent can refresh)", () => {
    expect(SRC).toMatch(/onCreated\?\.\(\)/);
  });

  it("calls router.refresh after a successful add (server-driven list refresh)", () => {
    expect(SRC).toMatch(/router\.refresh/);
  });

  it("uses the useToast hook for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']success["']\)/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']error["']\)/);
  });

  it("uses ValidationHint + validateEmail + validateDisplayName helpers", () => {
    expect(SRC).toMatch(/ValidationHint/);
    expect(SRC).toMatch(/validateEmail/);
    expect(SRC).toMatch(/validateDisplayName/);
  });

  it("uses fg-default / fg-muted / bg-background tokens (not forbidden ones)", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("uses backdrop-blur on the scrim (matches InviteToAppModal precedent)", () => {
    expect(SRC).toMatch(/backdrop-blur/);
  });

  it("uses useTransition for the submit handler (pending state)", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("autofocuses the Name field on open", () => {
    expect(SRC).toMatch(/autoFocus/);
  });

  it("closes onClose after a successful add", () => {
    expect(SRC).toMatch(/onClose\(\)/);
  });

  it("handles the inviteEmailFailed soft case with an info toast", () => {
    // Action decoupling: when the client row is created but the
    // invite email fails, the action returns ok:true with
    // inviteEmailFailed:true. The modal must show a softer toast
    // (info, not success) instead of pretending the email went out.
    expect(SRC).toMatch(/inviteEmailFailed/);
    expect(SRC).toMatch(
      /invite email couldn't be sent[\s\S]*?Try again from their page/,
    );
    // The fallback toast is `info`, not `success`.
    expect(SRC).toMatch(
      /toast\([\s\S]*?invite email could[\s\S]*?["']info["']/,
    );
  });
});
