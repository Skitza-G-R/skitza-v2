import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep style tests (no jsdom). Mirrors the existing repo pattern
// in apps/web/src/components/dashboard/clients/__tests__/link-pill.test.tsx
// and apps/web/src/app/(producer)/dashboard/store/__tests__/delete-confirm-modal.test.tsx

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "invite-modal.tsx"), "utf-8");

describe("InviteToAppModal", () => {
  it("uses Radix Dialog Portal for portaling to body (precedent: DeleteConfirmModal)", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/Portal/);
  });

  it("declares the InviteToAppModalProps shape with open, onClose, client, producerSlug, optional onSent", () => {
    expect(SRC).toMatch(/open:\s*boolean/);
    expect(SRC).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    expect(SRC).toMatch(/client:\s*\{/);
    expect(SRC).toMatch(/producerSlug:\s*string/);
    expect(SRC).toMatch(/onSent\?:/);
  });

  it("renders the primary 'Send invite email' action", () => {
    expect(SRC).toContain("Send invite email");
  });

  it("renders the secondary 'Copy invite link' action", () => {
    expect(SRC).toContain("Copy invite link");
  });

  it("calls sendClientInviteAction Server Action (not direct tRPC client)", () => {
    // The repo uses Server Actions exclusively — no client-side useMutation.
    expect(SRC).toMatch(/sendClientInviteAction/);
    expect(SRC).not.toMatch(/useMutation/);
  });

  it("passes via: 'email' for the email send path", () => {
    expect(SRC).toMatch(/via:\s*["']email["']/);
  });

  it("passes via: 'link' for the copy-link path", () => {
    expect(SRC).toMatch(/via:\s*["']link["']/);
  });

  it("copies skitza.app/invite/<slug>-<id> via navigator.clipboard.writeText", () => {
    expect(SRC).toMatch(/navigator\.clipboard\.writeText/);
    expect(SRC).toMatch(/skitza\.app\/invite\//);
    expect(SRC).toMatch(/producerSlug/);
    expect(SRC).toMatch(/client\.id/);
  });

  it("uses the useToast hook for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
    expect(SRC).toMatch(/toast\(.+success.+\)/s);
    expect(SRC).toMatch(/toast\(.+error.+\)/s);
  });

  it("disables the email button when client.email is null (no address on file)", () => {
    // Branch on email presence — implementations may use:
    //   - `!client.email`
    //   - `client.email == null` / `client.email === null`
    //   - `client.email !== null` (or with .length > 0)
    //   - `client.email ?` (ternary) or `hasEmail` derived flag
    expect(SRC).toMatch(
      /!client\.email|client\.email\s*[!=]==?\s*null|client\.email\s*\?\s*|hasEmail/,
    );
  });

  it("dims the email row when client.email is null", () => {
    // Look for opacity / dim styling tied to email presence.
    expect(SRC).toMatch(/opacity|text-\[rgb\(var\(--fg-muted\)\)\]/);
  });

  it("uses fg-default / fg-muted / bg-background tokens (not forbidden ones)", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("uses backdrop-blur on the scrim (matches DeleteConfirmModal precedent)", () => {
    expect(SRC).toMatch(/backdrop-blur/);
  });

  it("renders avatar with producerInitials + the gradient passed in client.gradient", () => {
    expect(SRC).toMatch(/producerInitials/);
    expect(SRC).toMatch(/client\.gradient/);
  });

  it("calls onClose after a successful action (so the modal closes)", () => {
    expect(SRC).toMatch(/onClose\(\)/);
  });

  it("fires onSent callback after a successful action if provided", () => {
    expect(SRC).toMatch(/onSent\?\.\(\)/);
  });
});
