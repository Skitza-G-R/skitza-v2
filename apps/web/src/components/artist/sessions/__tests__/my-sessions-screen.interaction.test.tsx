// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AllowanceSummary, SessionListItem } from "../book-data";
import {
  ARTIST_SESSIONS_TAB_KEYS,
  ARTIST_SESSIONS_TABS,
  isArtistSessionsTabKey,
} from "../artist-sessions-tabs";
import { HISTORY_PAGE_SIZE, MySessionsScreen } from "../my-sessions-screen";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const ALLOWANCE: AllowanceSummary = {
  purchaseId: "purchase-1",
  sessionAllowanceId: "allowance-1",
  producerId: "studio-1",
  producerName: "Northline Studio",
  projectId: "project-1",
  projectTitle: "Neon Afterglow",
  packageName: "Premium single production",
  kind: "fixed",
  sessionLimit: 15,
  sessionsUsed: 3,
  sessionsRemaining: 12,
  durationMin: 90,
  locationType: "studio",
  bufferMinutes: 30,
  minLeadHours: 24,
  closedAtISO: null,
  canBook: true,
  bookingBlockedReason: null,
};

function makeSession(
  id: string,
  startsAtISO: string,
  packageName: string,
  status: SessionListItem["status"] = "completed",
): SessionListItem {
  return {
    id,
    producerId: "studio-1",
    producerName: "Northline Studio",
    producerSlug: "northline",
    artistTimezone: "Asia/Jerusalem",
    producerTimezone: "Asia/Jerusalem",
    projectId: "project-1",
    projectTitle: "Neon Afterglow",
    purchaseId: "purchase-1",
    sessionAllowanceId: "allowance-1",
    startsAtISO,
    durationMin: 90,
    packageName,
    locationType: "studio",
    status,
    outcome: status === "completed" ? "completed" : "reserved",
    rescheduledFromBookingId: null,
    heldExpiryReason: null,
    policy: {
      cancellationPolicyHours: 24,
      cancellationDeadlineISO: startsAtISO,
      isOnTime: true,
      canCancel: status === "confirmed",
      canReschedule: status === "confirmed",
    },
  };
}

const PAST_SESSIONS = Array.from({ length: 13 }, (_, index) => {
  const day = String(index + 1).padStart(2, "0");
  return makeSession(
    `past-${String(index + 1)}`,
    `2026-04-${day}T08:00:00.000Z`,
    `Past package ${String(index + 1)}`,
  );
});

const UPCOMING_SESSION = makeSession(
  "upcoming-1",
  "2026-08-05T08:00:00.000Z",
  "Upcoming package",
  "confirmed",
);

function renderSessions(initialTab: "upcoming" | "history" = "upcoming") {
  return render(
    <MySessionsScreen
      sessions={[UPCOMING_SESSION, ...PAST_SESSIONS]}
      allowances={[ALLOWANCE]}
      nowISO="2026-07-30T08:00:00.000Z"
      initialTab={initialTab}
      previewOnly
    />,
  );
}

describe("artist Sessions scalable tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/artist/sessions?studio=studio-1");
  });

  afterEach(cleanup);

  it("uses Upcoming and History as peer content views", () => {
    expect(ARTIST_SESSIONS_TAB_KEYS).toEqual(["upcoming", "history"]);
    expect(ARTIST_SESSIONS_TABS.map((tab) => tab.label)).toEqual(["Upcoming", "History"]);
    expect(isArtistSessionsTabKey("history")).toBe(true);
    expect(isArtistSessionsTabKey("booking")).toBe(false);

    renderSessions();

    expect(screen.getByRole("tab", { name: "Upcoming" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Upcoming package")).toBeTruthy();
    expect(screen.queryByText(/Past package/)).toBeNull();
    expect(screen.getByRole("button", { name: /Book a session/ })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Upcoming" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "History" }));
  });

  it("keeps long history bounded and reveals it in batches", () => {
    renderSessions();

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(window.location.pathname).toBe("/artist/sessions");
    expect(new URLSearchParams(window.location.search).get("studio")).toBe("studio-1");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("history");
    expect(screen.getAllByText(/Past package/)).toHaveLength(HISTORY_PAGE_SIZE);
    expect(screen.getByRole("button", { name: "Show more history" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show more history" }));

    expect(screen.getAllByText(/Past package/)).toHaveLength(PAST_SESSIONS.length);
    expect(screen.queryByRole("button", { name: "Show more history" })).toBeNull();
  });

  it("keeps preview booking local while both tabs remain interactive", () => {
    renderSessions("history");

    fireEvent.click(screen.getByRole("tab", { name: "Upcoming" }));
    fireEvent.click(screen.getByRole("button", { name: /Book a session/ }));

    expect(navigationMocks.push).not.toHaveBeenCalled();
    expect(screen.getByText("Upcoming package")).toBeTruthy();
  });
});
