import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for the EditClientModal (PR #130). Mirrors the
// NewClientModal test pattern — same 4 fields, same Radix Dialog
// scrim. Differences are pre-fill from `client` prop + the action it
// calls (updateClientAction instead of createClientAction) + the
// primary CTA label ("Save changes" instead of "Add client").

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "edit-client-modal.tsx"), "utf-8");

describe("EditClientModal", () => {
  it("uses Radix Dialog Portal for portaling to body", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/Portal/);
  });

  it("declares EditClientModalProps with open, onClose, client, optional onSaved", () => {
    expect(SRC).toMatch(/open:\s*boolean/);
    expect(SRC).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    expect(SRC).toMatch(/client:\s*\{/);
    expect(SRC).toMatch(/onSaved\?:/);
  });

  it("declares the client shape with name + email + phone + notes", () => {
    expect(SRC).toMatch(/name:\s*string/);
    expect(SRC).toMatch(/email:\s*string/);
    expect(SRC).toMatch(/phone:\s*string\s*\|\s*null/);
    expect(SRC).toMatch(/notes:\s*string\s*\|\s*null/);
  });

  it("calls updateClientAction Server Action (not direct tRPC client)", () => {
    expect(SRC).toMatch(/updateClientAction/);
    expect(SRC).not.toMatch(/useMutation/);
  });

  it("renders Name / Email / Phone inputs + Notes textarea", () => {
    expect(SRC).toMatch(/id="edit-client-name"/);
    expect(SRC).toMatch(/id="edit-client-email"/);
    expect(SRC).toMatch(/id="edit-client-phone"/);
    expect(SRC).toMatch(/id="edit-client-notes"/);
    expect(SRC).toMatch(/<textarea[\s\S]*?id="edit-client-notes"/);
  });

  it("renders the 'Save changes' primary CTA + 'Cancel' secondary", () => {
    expect(SRC).toContain("Save changes");
    expect(SRC).toContain("Cancel");
  });

  it("pre-fills phone + notes from client (empty string fallback for null)", () => {
    // The producer expects the modal to open with the current values
    // already filled in — not blank like NewClientModal.
    expect(SRC).toMatch(/setPhone\(client\.phone\s*\?\?\s*""\)/);
    expect(SRC).toMatch(/setNotes\(client\.notes\s*\?\?\s*""\)/);
  });

  it("only sends fields that actually changed (no-op patch optimisation)", () => {
    // Avoids hitting the server when the producer opens the modal but
    // doesn't actually change anything, AND avoids triggering the
    // emailHash recompute when they only edited their phone.
    expect(SRC).toMatch(/trimmedName\s*!==\s*client\.name/);
    expect(SRC).toMatch(/toLowerCase\(\)\s*!==\s*client\.email\.toLowerCase\(\)/);
  });

  it("clears phone/notes column when input is emptied (sends null)", () => {
    // Empty string input → server gets `null` → column cleared. This is
    // the only way the producer wipes optional fields after creation.
    expect(SRC).toMatch(/phone\s*=\s*trimmedPhone\.length\s*>\s*0\s*\?\s*trimmedPhone\s*:\s*null/);
    expect(SRC).toMatch(/notes\s*=\s*trimmedNotes\.length\s*>\s*0\s*\?\s*trimmedNotes\s*:\s*null/);
  });

  it("uses useTransition for the submit pending state", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("uses useToast for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
    expect(SRC).toMatch(/toast\(.+success.+\)/s);
    expect(SRC).toMatch(/toast\(.+error.+\)/s);
  });

  it("calls router.refresh after a successful save", () => {
    expect(SRC).toMatch(/router\.refresh/);
  });

  it("uses backdrop-blur on the scrim (matches NewClientModal precedent)", () => {
    expect(SRC).toMatch(/backdrop-blur/);
  });

  it("uses canonical Skitza tokens (no forbidden ones)", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
