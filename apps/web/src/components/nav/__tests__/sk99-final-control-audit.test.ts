import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relativePath: string) => readFileSync(resolve(here, relativePath), "utf8");
const readPending = (relativePath: string) => {
  try {
    return read(relativePath);
  } catch {
    return "";
  }
};

const artistMobileNav = read("../artist-bottom-nav.tsx");
const producerMobileNav = read("../producer-bottom-nav.tsx");
const artistDesktopNav = read("../artist-desktop-sidebar.tsx");
const artistUserButton = read("../artist-user-button.tsx");
const accountRoleMenu = read("../account-role-menu-items.tsx");
const producerDesktopNav = read("../producer-sidebar.tsx");
const englishMessages = read("../../../../messages/en.json");
const appTopBar = read("../../shell/app-topbar.tsx");
const songPage = read("../../music/song-page.tsx");
const projectPage = read("../../music/project-page.tsx");
const libraryScreen = read("../../music/library-screen.tsx");
const albumTabs = read("../../dashboard/project/album-tabs.tsx");
const albumSpace = read("../../dashboard/project/album-space.tsx");
const overviewTab = read("../../dashboard/song/song-tabs/overview-tab.tsx");
const sessionsTab = read("../../dashboard/song/song-tabs/sessions-tab.tsx");
const needsYou = read("../../dashboard/overview/needs-you.ts");
const artistSettings = read("../../../app/(artist)/artist/settings/page.tsx");
const producerSettings = read("../../../app/(producer)/dashboard/settings/settings-client.tsx");
const sessionsPanel = read("../../../app/(producer)/dashboard/calendar/sessions-panel.tsx");
const sessionRow = read("../../../app/(producer)/dashboard/calendar/session-row.tsx");
const schedulePanel = read("../../../app/(producer)/dashboard/calendar/schedule-panel.tsx");
const calendarSwipeSurface = read(
  "../../../app/(producer)/dashboard/calendar/calendar-swipe-surface.tsx",
);
const sessionManagementSheet = read(
  "../../../app/(producer)/dashboard/calendar/session-management-sheet.tsx",
);
const scheduleWeekNav = read("../../../app/(producer)/dashboard/calendar/schedule-week-nav.tsx");
const paymentHistory = read("../../payments/payment-history.tsx");
const paymentReminderButton = readPending("../../payments/payment-reminder-button.tsx");
const paymentReminderAction = readPending(
  "../../../app/(producer)/dashboard/payments/reminder-actions.ts",
);

describe("SK-99 final navigation", () => {
  it("keeps the approved five artist destinations and Settings in the account menu", () => {
    for (const [href, label] of [
      ["/artist", "Home"],
      ["/artist/music", "Music"],
      ["/artist/sessions", "Sessions"],
      ["/artist/payments", "Payments"],
      ["/artist/store", "Store"],
    ] as const) {
      expect(artistMobileNav).toContain(`href: "${href}", label: "${label}"`);
      expect(artistDesktopNav).toContain(`href: "${href}", label: "${label}"`);
    }
    expect(artistMobileNav).not.toMatch(/href:\s*"\/artist\/book"/);
    expect(artistDesktopNav).not.toMatch(/href:\s*"\/artist\/book"/);
    expect(artistMobileNav).not.toContain('href: "/artist/settings"');
    expect(artistDesktopNav).not.toContain('href: "/artist/settings"');
    expect(artistDesktopNav).toContain("<ArtistUserButton");
    expect(artistDesktopNav).toContain(
      'settingsHref={withArtistStudio("/artist/settings", activeStudioId)}',
    );
    expect(artistUserButton).toContain("renderAccountRoleMenuItems(menuModel)");
    expect(artistUserButton).not.toContain("paymentsHref");
    expect(accountRoleMenu).not.toContain('label="Payments"');
    expect(accountRoleMenu).toContain('label="Settings"');
    expect(accountRoleMenu).toContain("href={model.settingsHref}");
  });

  it("keeps the approved producer mobile tabs and desktop Store, Payments, and Settings", () => {
    for (const label of ["Today", "Clients", "Music", "Calendar", "Payments"]) {
      expect(producerMobileNav).toContain(`label: "${label}"`);
    }
    expect(producerMobileNav).not.toContain('label: "Store"');
    expect(producerMobileNav).not.toContain('label: "Settings"');
    expect(producerDesktopNav).toContain('label: "Payments"');
    expect(producerDesktopNav).toContain('label: "Store"');
    expect(producerDesktopNav).toContain('label: "Settings"');
    expect(englishMessages).toContain('"profile": "Store"');
  });
});

describe("SK-99 removed dead controls", () => {
  it("does not render top-bar buttons without a real handler", () => {
    expect(appTopBar).toContain("onSearchClick ? (");
    expect(appTopBar).toContain("notificationControl ? (");
  });

  it("keeps interactive top-bar motion gated for reduced-motion users", () => {
    expect(appTopBar).toContain("motion-reduce:transition-none");
    expect(appTopBar).toContain("motion-reduce:active:scale-100");
  });

  it("removes Favorites, Project Share, and fake play metrics", () => {
    expect(songPage).not.toMatch(/favorites|StarIcon|isFavorite/i);
    expect(projectPage).not.toMatch(/Share project link|handleShare|shareConfirm|Share2/);
    expect(projectPage).not.toContain(">Plays<");
    expect(projectPage).not.toContain("fmtCount(item.plays)");
    expect(libraryScreen).not.toContain("Most plays");
    expect(libraryScreen).not.toContain('case "plays"');
    expect(libraryScreen).not.toContain(">Plays<");
    expect(libraryScreen).not.toMatch(/fmtCount\((?:song|item)\.plays\)/);
  });

  it("removes visible placeholder tabs and actions from approved surfaces", () => {
    expect(albumTabs).not.toContain('"files"');
    expect(albumSpace).not.toContain("FilesTab");
    expect(overviewTab).not.toContain('title="Coming soon"');
    expect(sessionsTab).not.toContain('title="Coming soon"');
    expect(artistSettings).not.toMatch(/settingsRows|coming soon/i);
    expect(producerSettings).not.toMatch(/ComingSoonButton|Google Calendar/);
    expect(scheduleWeekNav).not.toContain("GCalPill");
  });

  it("deletes orphan placeholder controls so they cannot be rendered again", () => {
    for (const relativePath of [
      "../../../app/(producer)/dashboard/booking/gcal-sync-badge.tsx",
      "../../../app/(producer)/dashboard/calendar/change-time-modal.tsx",
      "../../../app/(producer)/dashboard/calendar/edit-session-modal.tsx",
      "../../../app/(producer)/dashboard/calendar/gcal-pill.tsx",
      "../../../app/(producer)/dashboard/calendar/send-reminder-modal.tsx",
      "../../dashboard/project/album-tabs/files-tab.tsx",
      "../../dashboard/project/sub-tabs/files-sub-tab.tsx",
      "../../dashboard/setup/availability-section.tsx",
    ]) {
      expect(existsSync(resolve(here, relativePath))).toBe(false);
    }
  });

  it("keeps one real producer session management surface", () => {
    expect(calendarSwipeSurface).toContain("<SessionManagementSheet");
    expect(sessionManagementSheet).toContain("cancelSession,");
    expect(sessionManagementSheet).toContain("rescheduleSession,");
    expect(sessionsPanel).toContain("openSessionManagement");
    expect(sessionsPanel).not.toMatch(/CancelSessionModal|RescheduleSessionModal/);
    expect(sessionRow).toContain('label="Manage session"');
    expect(sessionRow).not.toMatch(
      /label="Cancel session"|label="Reschedule session"|Send reminder/,
    );
    expect(schedulePanel).toContain("openSessionManagement");
    expect(schedulePanel).not.toMatch(/EditSessionModal|RescheduleSessionModal|onEditSession/);
  });

  it("does not duplicate legacy invoice work outside Payments", () => {
    expect(needsYou).not.toContain('| "invoice"');
    expect(needsYou).not.toContain('kind: "comment" | "invoice"');
    expect(needsYou).toContain('kind: "comment"');
  });
});

describe("SK-99 retained real controls", () => {
  it("wires producer payment reminders to the logged ledger mutation", () => {
    expect(paymentHistory).toContain("PaymentReminderButton");
    expect(paymentReminderButton).toContain("sendPaymentReminderAction");
    expect(paymentReminderButton).toContain("Send reminder");
    expect(paymentReminderAction).toContain("caller.purchaseLedger.sendReminder");
    expect(paymentReminderAction).toContain('revalidatePath("/dashboard/payments"');
  });

  it("keeps real Add Song and automatic confirmation controls", () => {
    expect(albumSpace).toContain("setAddSongOpen(true)");
    expect(albumSpace).toContain('mode="new-song"');
    expect(albumSpace).toContain("projectId={project.id}");
    expect(albumSpace).not.toContain("lockProject=1");
    const policiesEditor = read("../../../app/(producer)/dashboard/booking/policies-editor.tsx");
    expect(policiesEditor).toContain("autoConfirmBookings");
    expect(policiesEditor).toContain("updateAvailabilitySettings");
  });
});
