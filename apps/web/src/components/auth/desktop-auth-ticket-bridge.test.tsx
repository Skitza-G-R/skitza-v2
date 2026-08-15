import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { redeemDesktopSignInTicket } from "./desktop-auth-ticket-bridge";

describe("desktop Clerk ticket redemption", () => {
  it("redeems and finalizes the in-memory ticket before navigating", async () => {
    const calls: string[] = [];
    const signIn = {
      ticket: vi.fn(({ ticket }: { ticket: string }) => {
        calls.push(`ticket:${ticket}`);
        return Promise.resolve({ error: null });
      }),
      finalize: vi.fn(() => {
        calls.push("finalize");
        return Promise.resolve({ error: null });
      }),
    };
    const navigate = vi.fn(() => {
      calls.push("navigate");
    });

    await expect(
      redeemDesktopSignInTicket({ navigate, signIn, ticket: "one-use-ticket" }),
    ).resolves.toBe(true);
    expect(calls).toEqual(["ticket:one-use-ticket", "finalize", "navigate"]);
  });

  it("does not finalize or navigate after Clerk rejects the ticket", async () => {
    const signIn = {
      ticket: vi.fn(() => Promise.resolve({ error: new Error("rejected") })),
      finalize: vi.fn(() => Promise.resolve({ error: null })),
    };
    const navigate = vi.fn();

    await expect(
      redeemDesktopSignInTicket({ navigate, signIn, ticket: "one-use-ticket" }),
    ).resolves.toBe(false);
    expect(signIn.finalize).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("uses only the versioned native bridge and never persists or logs the ticket", () => {
    const source = readFileSync(
      new URL("./desktop-auth-ticket-bridge.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("DESKTOP_CAPABILITIES.socialAuth");
    expect(source).toContain('event?.type !== "social-sign-in-ticket"');
    expect(source).toContain("signIn.ticket({ ticket: input.ticket })");
    expect(source).toContain("signIn.finalize()");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|console\.|URLSearchParams/);
  });
});
