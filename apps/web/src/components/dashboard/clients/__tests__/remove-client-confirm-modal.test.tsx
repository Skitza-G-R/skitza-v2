import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "remove-client-confirm-modal.tsx"),
  "utf-8",
);

describe("RemoveClientConfirmModal", () => {
  it("uses Radix Dialog Portal", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/Portal/);
  });

  it("declares props open / onClose / client (id, name) / onRemoved", () => {
    expect(SRC).toMatch(/open:\s*boolean/);
    expect(SRC).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    expect(SRC).toMatch(/client:\s*\{/);
    expect(SRC).toMatch(/id:\s*string/);
    expect(SRC).toMatch(/name:\s*string/);
    expect(SRC).toMatch(/onRemoved\?:/);
  });

  it("renders the 'Remove [name]?' title (interpolates client.name)", () => {
    expect(SRC).toMatch(/Remove\s*\{client\.name\}\?/);
  });

  it("warns that the action can't be undone", () => {
    expect(SRC).toMatch(/can'?t be undone|can\\u2019t be undone|can&rsquo;t be undone/i);
  });

  it("spells out what stays vs what goes", () => {
    // Producer must be reassured that projects/contracts/comments aren't
    // nuked along with the CRM entry — the procedure only deletes the
    // contact row.
    expect(SRC).toContain("Stays:");
    expect(SRC).toContain("Goes:");
  });

  it("calls removeClientAction Server Action (not direct tRPC client)", () => {
    expect(SRC).toMatch(/removeClientAction/);
    expect(SRC).not.toMatch(/useMutation/);
  });

  it("uses fg-danger color for the primary destructive button", () => {
    // Visual signal that this is the destructive path. Token gives us
    // the canonical red.
    expect(SRC).toMatch(/--fg-danger/);
  });

  it("renders 'Remove client' on the primary CTA", () => {
    expect(SRC).toContain("Remove client");
  });

  it("renders 'Cancel' on the secondary action", () => {
    expect(SRC).toContain("Cancel");
  });

  it("uses useTransition for the destructive pending state", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("uses useToast for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
  });

  it("routes back to /dashboard/clients-projects on success", () => {
    // The component uses a CLIENTS_PATH constant, so accept either an
    // inline literal OR the constant name in router.push().
    expect(SRC).toMatch(
      /router\.push\(\s*(CLIENTS_PATH|["'`]\/dashboard\/clients-projects["'`])/,
    );
    // And the constant itself points at the right path.
    expect(SRC).toMatch(/CLIENTS_PATH\s*=\s*["']\/dashboard\/clients-projects["']/);
  });

  it("uses backdrop-blur on the scrim", () => {
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
