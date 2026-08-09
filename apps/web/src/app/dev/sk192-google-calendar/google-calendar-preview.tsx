"use client";

import type { ReactNode } from "react";

import { CalendarSwipeSurface } from "~/app/(producer)/dashboard/calendar/calendar-swipe-surface";
import {
  GoogleCalendarControl,
  type GoogleCalendarControlView,
} from "~/app/(producer)/dashboard/calendar/google-calendar-control";
import type {
  GoogleCalendarActionResult,
  GoogleCalendarControlActions,
  GoogleCalendarOption,
  GoogleCalendarUiModel,
} from "~/app/(producer)/dashboard/calendar/google-calendar-ui-model";
import { LogoMark } from "~/components/brand/logo-mark";
import { Icon } from "~/components/nav/icons";
import { ProducerBottomNav } from "~/components/nav/producer-bottom-nav";
import { NAV_ITEMS } from "~/components/nav/producer-sidebar";
import { Wordmark } from "~/components/nav/wordmark";

import type { Sk192GoogleCalendarPreviewState } from "./preview-state";

const PREVIEW_CALENDARS: readonly GoogleCalendarOption[] = [
  {
    selectionKey: "studio-sessions",
    name: "Studio sessions",
    timeZone: "Asia/Jerusalem",
    accessRole: "owner",
    primary: true,
  },
  {
    selectionKey: "personal-busy-time",
    name: "Personal busy time",
    timeZone: "Asia/Jerusalem",
    accessRole: "writer",
    primary: false,
  },
  {
    selectionKey: "shared-studio-limited",
    name: "Shared studio calendar",
    timeZone: "Europe/London",
    accessRole: "writer_without_private_access",
    primary: false,
  },
  {
    selectionKey: "tour-dates-read-only",
    name: "Tour dates",
    timeZone: "America/New_York",
    accessRole: "reader",
    primary: false,
  },
] as const;

const PREVIEW_ACTION_SUCCESS: GoogleCalendarActionResult = { ok: true };
const PREVIEW_ACTIONS: GoogleCalendarControlActions = {
  connect: () => Promise.resolve(PREVIEW_ACTION_SUCCESS),
  refreshCalendars: () => Promise.resolve(PREVIEW_ACTION_SUCCESS),
  saveSelection: () => Promise.resolve(PREVIEW_ACTION_SUCCESS),
  reconnect: () => Promise.resolve(PREVIEW_ACTION_SUCCESS),
  confirmAccountSwitch: () => Promise.resolve(PREVIEW_ACTION_SUCCESS),
  disconnect: () => Promise.resolve(PREVIEW_ACTION_SUCCESS),
};

const MANUAL_OPTIONS = { studioTimeZone: "Asia/Jerusalem", clients: [] } as const;
const SECTION_BOUNDARIES = new Set(["today", "payments", "portfolio"]);

export function GoogleCalendarPreview({ state }: { state: Sk192GoogleCalendarPreviewState }) {
  const model = previewModel(state);
  const defaultView = previewView(state);

  return (
    <div
      className="fixed inset-0 flex overflow-hidden lg:static lg:min-h-dvh lg:overflow-visible"
      style={{
        background: "rgb(var(--bg-background))",
        color: "rgb(var(--fg-default))",
      }}
    >
      <PreviewProducerSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PreviewProducerTopBar state={state} />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain lg:overflow-visible lg:overscroll-auto"
        >
          <div className="mx-auto flex max-w-[1180px] flex-col px-4 py-2 sm:py-3 lg:h-[calc(100dvh-64px)] lg:py-4">
            <div className="flex min-h-0 flex-1 flex-col rounded-none border-0 bg-transparent p-0 sm:rounded-[var(--radius-2xl)] sm:border sm:border-[rgb(var(--border-strong))] sm:bg-[rgb(var(--bg-elevated))] sm:px-4 sm:py-3 lg:px-5 lg:py-4">
              <CalendarSwipeSurface
                active="schedule"
                eyebrows={{
                  schedule: "AUG 10 – 16",
                  sessions: "3 SESSIONS · 2 UPCOMING",
                  availability: "32H OPEN PER WEEK",
                }}
                scheduleEyebrow="AUG 10 – 16"
                manualOptions={MANUAL_OPTIONS}
                googleCalendarControl={
                  <GoogleCalendarControl
                    key={state}
                    model={model}
                    actions={PREVIEW_ACTIONS}
                    defaultOpen
                    defaultView={defaultView}
                  />
                }
                sessionsContent={<PreviewSchedule />}
                availabilityContent={<PreviewAvailability />}
              />
            </div>
          </div>
        </main>
        <ProducerBottomNav />
      </div>
    </div>
  );
}

function PreviewProducerSidebar(): ReactNode {
  return (
    <aside
      aria-label="Producer preview sidebar"
      className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-e border-[rgb(var(--border-sidebar))] bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-onsidebar))] lg:flex"
    >
      <div className="flex items-center gap-2.5 px-[18px] pt-5 pb-3.5">
        <LogoMark size={30} />
        <Wordmark size={18} inverse lowercase />
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1">
        {NAV_ITEMS.map((item) => {
          const active = item.id === "calendar";
          return (
            <div key={item.id}>
              <div
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex min-h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-[12.5px]",
                  active
                    ? "bg-[rgb(var(--fg-onsidebar)/0.1)] font-bold text-[rgb(var(--fg-onsidebar))]"
                    : "font-medium text-[rgb(var(--fg-onsidebar)/0.66)]",
                ].join(" ")}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-[rgb(var(--brand-primary))]"
                  />
                ) : null}
                <Icon name={item.icon} size={17} strokeWidth={active ? 2.2 : 1.8} />
                <span>{item.label}</span>
                {item.shortcut ? (
                  <span className="ms-auto font-mono text-[8px] tracking-[0.08em] text-[rgb(var(--fg-onsidebar)/0.35)]">
                    {item.shortcut}
                  </span>
                ) : null}
              </div>
              {SECTION_BOUNDARIES.has(item.id) ? (
                <div className="mx-2 my-2 h-px bg-[rgb(var(--border-sidebar))]" aria-hidden />
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-[rgb(var(--border-sidebar))] px-4 py-3">
        <p className="text-[11.5px] font-semibold text-[rgb(var(--fg-onsidebar))]">
          Northline Studio
        </p>
        <p className="mt-0.5 font-mono text-[9px] tracking-[0.08em] text-[rgb(var(--fg-onsidebar)/0.5)] uppercase">
          Dev preview · no account data
        </p>
      </div>
    </aside>
  );
}

function PreviewProducerTopBar({ state }: { state: Sk192GoogleCalendarPreviewState }): ReactNode {
  return (
    <header className="flex min-h-16 shrink-0 items-center border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.9)] px-4 backdrop-blur-xl lg:min-h-16 lg:px-5">
      <div className="flex items-center gap-2.5 lg:hidden">
        <LogoMark size={28} />
        <Wordmark size={17} lowercase />
      </div>
      <p className="font-display ms-auto text-[13px] font-bold text-[rgb(var(--fg-default))] lg:ms-0">
        Calendar
      </p>
      <span className="ms-3 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-1 font-mono text-[8px] font-bold tracking-[0.09em] text-[rgb(var(--fg-muted))] uppercase">
        {state.replaceAll("-", " ")}
      </span>
    </header>
  );
}

function PreviewSchedule(): ReactNode {
  const sessions = [
    { time: "10:00", title: "Vocal recording", artist: "Maya Cohen", tone: "brand" },
    { time: "14:30", title: "Mix review", artist: "Noam Levi", tone: "neutral" },
    { time: "18:00", title: "Production session", artist: "Lior Ben", tone: "neutral" },
  ] as const;

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))]">
      <div className="hidden h-full min-h-[360px] grid-cols-[72px_repeat(5,minmax(110px,1fr))] lg:grid">
        <div className="border-e border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))]" />
        {["Mon 10", "Tue 11", "Wed 12", "Thu 13", "Fri 14"].map((day) => (
          <div
            key={day}
            className="border-e border-[rgb(var(--border-subtle))] px-3 py-3 text-center font-mono text-[10px] font-bold text-[rgb(var(--fg-secondary))] last:border-e-0"
          >
            {day}
          </div>
        ))}
        {["09:00", "12:00", "15:00", "18:00"].map((time) => (
          <div key={time} className="contents">
            <div className="border-e border-t border-[rgb(var(--border-subtle))] px-3 py-3 font-mono text-[9px] text-[rgb(var(--fg-muted))]">
              {time}
            </div>
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={`${time}-${String(index)}`}
                className="min-h-16 border-e border-t border-[rgb(var(--border-subtle))] last:border-e-0"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-2.5 p-1 lg:hidden">
        <p className="px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
          Upcoming sessions
        </p>
        {sessions.map((session) => (
          <article
            key={`${session.time}-${session.title}`}
            className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3"
          >
            <span
              className={[
                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                session.tone === "brand"
                  ? "bg-[rgb(var(--brand-primary))]"
                  : "bg-[rgb(var(--fg-muted)/0.45)]",
              ].join(" ")}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-[rgb(var(--fg-default))]">
                {session.title}
              </span>
              <span className="mt-1 block text-[11.5px] text-[rgb(var(--fg-muted))]">
                {session.artist}
              </span>
            </span>
            <span className="font-mono text-[10px] font-bold text-[rgb(var(--fg-secondary))]">
              {session.time}
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}

function PreviewAvailability(): ReactNode {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-5">
      <p className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
        Weekly availability
      </p>
      <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">Monday to Thursday · 10:00–18:00</p>
    </div>
  );
}

function previewModel(state: Sk192GoogleCalendarPreviewState): GoogleCalendarUiModel {
  switch (state) {
    case "not-connected":
      return { status: "not_connected" };
    case "connecting":
      return { status: "connecting" };
    case "selection":
      return {
        status: "selection_required",
        accountLabel: "Northline Studio account",
        calendars: PREVIEW_CALENDARS,
        selection: { destinationSelectionKey: null, busySelectionKeys: ["studio-sessions"] },
      };
    case "empty-selection":
      return {
        status: "selection_required",
        accountLabel: "Northline Studio account",
        calendars: [],
        selection: { destinationSelectionKey: null, busySelectionKeys: [] },
      };
    case "disconnected":
      return {
        status: "disconnected",
        accountLabel: "Northline Studio account",
      };
    case "reconnect":
      return {
        status: "reconnect_required",
        accountLabel: "Northline Studio account",
      };
    case "connected":
    case "switch":
    case "disconnect":
      return {
        status: "connected",
        accountLabel: "Northline Studio account",
        calendars: PREVIEW_CALENDARS,
        selection: {
          destinationSelectionKey: "studio-sessions",
          busySelectionKeys: ["studio-sessions", "personal-busy-time"],
        },
      };
  }
}

function previewView(state: Sk192GoogleCalendarPreviewState): GoogleCalendarControlView {
  if (state === "selection" || state === "empty-selection") return "selection";
  if (state === "switch") return "switch_confirmation";
  if (state === "disconnect") return "disconnect_confirmation";
  return "summary";
}
