// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canOpenClientInvitation,
  clientInvitationLinkState,
  type ProducerClientInvitationState,
} from "../client-invitation-state";
import { LinkPill } from "../link-pill";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "link-pill.tsx"), "utf-8");

describe("LinkPill", () => {
  it("exports a typed LinkPillState", () => {
    expect(SRC).toContain('export type { LinkPillState } from "./client-invitation-state"');
  });

  it('renders "Connected" copy for active Artist access', () => {
    expect(SRC).toContain("Connected");
  });

  it('renders "Invited" copy for pending', () => {
    expect(SRC).toContain("Invited");
  });

  it('renders "Invite" copy for none', () => {
    expect(SRC).toContain('"Invite"');
  });

  it("calls onInvite for the none state via a button element", () => {
    expect(SRC).toMatch(/<button[^>]*onClick=\{onInvite\}/);
  });

  it("uses the Skitza fg-success token for the active dot", () => {
    expect(SRC).toContain("--fg-success");
  });

  it("uses the brand-primary token for the pending + none dots", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("forbids non-existent --surface-card token", () => {
    expect(SRC).not.toContain("--surface-card");
  });
});

afterEach(() => {
  cleanup();
});

describe("durable client invitation states", () => {
  const cases = [
    { state: "connected", label: "Connected", action: false },
    { state: "provider_accepted", label: "Invited", action: true },
    { state: "requested", label: "Check status", action: true },
    { state: "failed", label: "Retry", action: true },
    { state: "available", label: "Invite", action: true },
  ] as const satisfies readonly {
    state: ProducerClientInvitationState;
    label: string;
    action: boolean;
  }[];

  it.each(cases)("renders $state as $label", ({ state, label, action }) => {
    const onInvite = vi.fn();
    render(<LinkPill state={clientInvitationLinkState(state)} onInvite={onInvite} />);

    if (action) {
      const button = screen.getByRole("button", { name: label });
      fireEvent.click(button);
      expect(onInvite).toHaveBeenCalledTimes(1);
    } else {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
      expect(onInvite).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["active", false],
    ["pending", true],
    ["sending", true],
    ["failed", true],
    ["none", true],
  ] as const)("maps %s to invitation-modal access %s", (state, expected) => {
    expect(canOpenClientInvitation(state)).toBe(expected);
  });
});
