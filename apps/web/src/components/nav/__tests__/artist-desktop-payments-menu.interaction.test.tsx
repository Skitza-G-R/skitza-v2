// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ selectedHref: null as string | null }));

vi.mock("@clerk/nextjs", () => {
  const UserButton = Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Action: ({ label }: { label: string }) => <button type="button">{label}</button>,
      Link: ({ href, label }: { href: string; label: string }) => (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            mocks.selectedHref = href;
          }}
        >
          {label}
        </a>
      ),
      MenuItems: ({ children }: { children: ReactNode }) => <nav>{children}</nav>,
    },
  );

  return { UserButton };
});

import { ArtistUserButton } from "../artist-user-button";
import { ProducerUserButton } from "../producer-user-button";

afterEach(() => {
  cleanup();
  mocks.selectedHref = null;
});

describe("Artist desktop Payments menu", () => {
  it("opens the studio-aware Payments destination from Clerk's artist menu", () => {
    render(
      <ArtistUserButton
        userId="artist-1"
        producerStatus="none"
        producerUnreadCount={0}
        paymentsHref="/artist/payments?studio=studio-1"
        settingsHref="/artist/settings?studio=studio-1"
        ringClassName="ring-test"
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Payments" }));
    expect(mocks.selectedHref).toBe("/artist/payments?studio=studio-1");
  });

  it("does not expose Artist Payments from the Producer account menu", () => {
    render(
      <ProducerUserButton
        userId="producer-1"
        hasArtistAccount={false}
        artistUnreadCount={0}
        avatarClassName="avatar-test"
      />,
    );

    expect(screen.queryByRole("link", { name: "Payments" })).toBeNull();
  });
});
