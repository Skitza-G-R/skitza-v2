/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  continueAsArtist: vi.fn(),
  resumeTrustedJoinIntent: vi.fn(() => new Promise(() => undefined)),
}));

import { ResumeTrustedJoin } from "./resume-trusted-join";

describe("ResumeTrustedJoin", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    { action: "book" as const, expected: "Opening booking…" },
    { action: "unlock" as const, expected: "Opening your unlocked tracks…" },
  ])("announces $action progress", ({ action, expected }) => {
    render(<ResumeTrustedJoin slug="northline-studio" action={action} />);

    const status = screen.getByRole("status").textContent;
    expect(status).toBe(expected);
    if (action === "unlock") {
      expect(status.toLowerCase()).not.toContain("booking");
    }
  });
});
