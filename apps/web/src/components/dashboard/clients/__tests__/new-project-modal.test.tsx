import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep style tests for the redesigned New Project modal (Phase 1
// G7). Mirrors the new-client-modal.test.tsx pattern — no jsdom, just
// regex against the source. We're verifying the shape/structure that
// the BUILD-NOTES §7.2 spec demands.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "new-project-modal.tsx"), "utf-8");

describe("NewProjectModal", () => {
  it("uses Radix Dialog Portal for portaling to body", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/Portal/);
  });

  it("declares the NewProjectModalProps shape with open / onClose / clients / lockedClient / onCreated", () => {
    expect(SRC).toMatch(/open:\s*boolean/);
    expect(SRC).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    // clients: list for the picker dropdown
    expect(SRC).toMatch(/clients:/);
    expect(SRC).not.toMatch(/products:/);
    // lockedClient: optional, locks the picker when opened from Client Space
    expect(SRC).toMatch(/lockedClient\?:/);
    expect(SRC).toMatch(/onCreated\?:/);
  });

  it("has a required Project title input (autofocused)", () => {
    expect(SRC).toMatch(/id="new-project-title"/);
    expect(SRC).toMatch(/<input[\s\S]*?id="new-project-title"[\s\S]*?required/);
    expect(SRC).toMatch(/autoFocus/);
  });

  it("renders a Client picker section (existing / new client modes)", () => {
    // The picker section must distinguish the two modes — locked is
    // controlled by props, but existing-vs-new is the modal's own
    // sub-state machine.
    expect(SRC).toMatch(/existing|select/i);
    // The "+ New client" toggle for the inline name + email entry.
    expect(SRC).toContain("New client");
  });

  it("does not collect or infer purchase terms", () => {
    expect(SRC).not.toMatch(/new-project-product/);
    expect(SRC).not.toMatch(/new-project-total/);
    expect(SRC).not.toMatch(/new-project-deposit/);
    expect(SRC).not.toMatch(/depositPct|depositCents|engagementTotalCents|productId/);
  });

  it("has a Deadline date input (optional)", () => {
    expect(SRC).toMatch(/id="new-project-deadline"/);
    // type="date" — browser date picker.
    expect(SRC).toMatch(/<input[\s\S]*?id="new-project-deadline"[\s\S]*?type="date"/);
  });

  it("calls createProjectAction Server Action (not direct tRPC client)", () => {
    expect(SRC).toMatch(/createProjectAction/);
    expect(SRC).not.toMatch(/useMutation/);
  });

  it("supports a lockedClient mode that renders the client read-only", () => {
    // lockedClient triggers a different render path — read-only client
    // info instead of the picker dropdown.
    expect(SRC).toMatch(/lockedClient/);
  });

  it("uses useTransition for the submit handler (pending state)", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("uses the useToast hook for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']success["']\)/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']error["']\)/);
  });

  it("calls router.refresh after a successful create (server-driven list refresh)", () => {
    expect(SRC).toMatch(/router\.refresh/);
  });

  it("uses next/navigation's useRouter (not legacy next/router)", () => {
    expect(SRC).toMatch(/from\s+["']next\/navigation["']/);
  });

  it("renders the 'Create project' primary CTA text", () => {
    expect(SRC).toMatch(/Create project|Creating/);
  });

  it("renders the 'Cancel' secondary action text", () => {
    expect(SRC).toContain("Cancel");
  });

  it("uses fg-default / fg-muted / bg-background tokens (not forbidden ones)", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("uses backdrop-blur on the scrim (matches NewClientModal precedent)", () => {
    expect(SRC).toMatch(/backdrop-blur/);
  });

  it("closes via onClose after a successful create", () => {
    expect(SRC).toMatch(/onClose\(\)/);
  });

  it("keeps the optional deadline without payment fields", () => {
    expect(SRC).toMatch(/<details[\s\S]*?Add deadline/);
    expect(SRC).not.toMatch(/payment amounts/i);
  });

  it("keeps the close button usable when the focused field blurs", () => {
    expect(SRC).toMatch(/aria-label="Close"[\s\S]*?onPointerDown/);
    expect(SRC).toMatch(/event\.preventDefault\(\)[\s\S]*?onClose\(\)/);
  });
});
