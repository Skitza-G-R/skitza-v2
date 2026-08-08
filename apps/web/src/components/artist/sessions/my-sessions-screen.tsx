"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarDays } from "lucide-react";

import { useTabSwipe } from "~/components/native/use-tab-swipe";
import { withArtistStudio } from "~/lib/artist-studio-context";
import {
  ARTIST_SESSIONS_TAB_KEYS,
  ARTIST_SESSIONS_TABS,
  type ArtistSessionsTabKey,
} from "./artist-sessions-tabs";
import {
  allowanceBookHref,
  allowanceCanBook,
  type AllowanceSummary,
  type SessionListItem,
} from "./book-data";
import { ConfirmationHero } from "./confirmation-hero";
import { SessionRow } from "./session-row";

export const HISTORY_PAGE_SIZE = 10;

export function groupArtistSessions(sessions: SessionListItem[], nowISO: string) {
  const now = new Date(nowISO).getTime();
  const active = sessions
    .filter((session) => {
      const end = new Date(session.startsAtISO).getTime() + session.durationMin * 60 * 1000;
      return end > now && (session.status === "pending_approval" || session.status === "confirmed");
    })
    .sort(
      (left, right) => new Date(left.startsAtISO).getTime() - new Date(right.startsAtISO).getTime(),
    );
  const confirmed = active.filter((session) => session.status === "confirmed");
  const next = confirmed[0] ?? null;
  const held = active.filter((session) => session.status === "pending_approval");
  const upcoming = confirmed.slice(1);
  const activeIds = new Set(active.map((session) => session.id));
  const past = sessions
    .filter((session) => !activeIds.has(session.id))
    .sort(
      (left, right) => new Date(right.startsAtISO).getTime() - new Date(left.startsAtISO).getTime(),
    );
  return { next, held, upcoming, past };
}

export function MySessionsScreen({
  sessions,
  allowances,
  nowISO,
  initialTab = "upcoming",
  previewOnly = false,
}: {
  sessions: SessionListItem[];
  allowances: AllowanceSummary[];
  nowISO: string;
  initialTab?: ArtistSessionsTabKey;
  previewOnly?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<ArtistSessionsTabKey>(initialTab);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(HISTORY_PAGE_SIZE);
  const groups = groupArtistSessions(sessions, nowISO);
  const justId = searchParams.get("just");
  const justBooked = justId
    ? (sessions.find(
        (session) =>
          session.id === justId &&
          (session.status === "pending_approval" || session.status === "confirmed"),
      ) ?? null)
    : null;
  const bookableAllowance = allowances.find(allowanceCanBook) ?? null;
  const studioId =
    bookableAllowance?.producerId ??
    allowances[0]?.producerId ??
    sessions[0]?.producerId ??
    searchParams.get("studio");
  const bookingSub = bookableAllowance
    ? bookableAllowance.kind === "unlimited"
      ? "Included in your package"
      : `${String(bookableAllowance.sessionsRemaining ?? 0)} available`
    : "Choose a service first";

  const changeTab = (next: ArtistSessionsTabKey) => {
    setActiveTab(next);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  };

  const tabSwipeHandlers = useTabSwipe({
    items: ARTIST_SESSIONS_TAB_KEYS,
    value: activeTab,
    onChange: changeTab,
  });

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
            Your time
          </p>
          <h1 className="font-display mt-1 text-[30px] leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            Sessions
          </h1>
        </div>
        <button
          type="button"
          onClick={() => {
            if (previewOnly) return;
            router.push(
              bookableAllowance
                ? allowanceBookHref(bookableAllowance)
                : withArtistStudio("/artist/store", studioId),
            );
          }}
          className="sk-press flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-left text-[rgb(var(--fg-on-brand))] shadow-[0_10px_24px_-14px_rgb(var(--brand-primary-dark)/0.9)] transition-[transform,filter,box-shadow] hover:brightness-[1.03] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto"
        >
          <CalendarDays size={17} strokeWidth={2} aria-hidden />
          <span className="flex flex-col leading-tight">
            <span className="text-[13px] font-bold">
              {bookableAllowance ? "Book a session" : "View services"}
            </span>
            <span className="mt-0.5 text-[10px] font-medium opacity-70">{bookingSub}</span>
          </span>
        </button>
      </header>

      <nav
        aria-label="Session sections"
        className="no-scrollbar -mx-4 overflow-x-auto border-b border-[rgb(var(--border-subtle))] px-4 sm:mx-0 sm:px-0"
      >
        <div
          className="flex min-w-max items-center gap-1 pb-2"
          role="tablist"
          aria-label="Session sections"
        >
          {ARTIST_SESSIONS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                id={`artist-sessions-${tab.key}-tab`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="artist-sessions-tab-panel"
                tabIndex={isActive ? 0 : -1}
                data-artist-sessions-tab={tab.key}
                onClick={() => {
                  changeTab(tab.key);
                }}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const currentIndex = ARTIST_SESSIONS_TAB_KEYS.indexOf(activeTab);
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? ARTIST_SESSIONS_TAB_KEYS.length - 1
                        : event.key === "ArrowRight"
                          ? (currentIndex + 1) % ARTIST_SESSIONS_TAB_KEYS.length
                          : (currentIndex - 1 + ARTIST_SESSIONS_TAB_KEYS.length) %
                            ARTIST_SESSIONS_TAB_KEYS.length;
                  const nextTab = ARTIST_SESSIONS_TAB_KEYS[nextIndex];
                  if (!nextTab) return;
                  changeTab(nextTab);
                  document.getElementById(`artist-sessions-${nextTab}-tab`)?.focus();
                }}
                className={`sk-press relative flex min-h-11 shrink-0 items-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold transition-[background,color,box-shadow] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none motion-reduce:transition-none ${
                  isActive
                    ? "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-onsidebar))] shadow-[0_4px_14px_rgb(17_16_9/0.16)]"
                    : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="[touch-action:pan-y_pinch-zoom]" data-tab-swipe-surface {...tabSwipeHandlers}>
        <div
          id="artist-sessions-tab-panel"
          role="tabpanel"
          aria-labelledby={`artist-sessions-${activeTab}-tab`}
          data-tab-swipe-panel
        >
          {activeTab === "upcoming" ? (
            <>
              {justBooked ? <ConfirmationHero session={justBooked} /> : null}

              {!groups.next && groups.held.length === 0 && groups.upcoming.length === 0 ? (
                <SessionsEmptyState
                  title="No upcoming sessions"
                  body="Book a session when you are ready to return to the studio."
                />
              ) : (
                <div className="space-y-6">
                  {groups.next ? (
                    <SessionGroup title="Next" sessions={[groups.next]} featured />
                  ) : null}
                  {groups.held.length > 0 ? (
                    <SessionGroup title="Held requests" sessions={groups.held} />
                  ) : null}
                  {groups.upcoming.length > 0 ? (
                    <SessionGroup title="Upcoming" sessions={groups.upcoming} />
                  ) : null}
                </div>
              )}
            </>
          ) : groups.past.length === 0 ? (
            <SessionsEmptyState
              title="No session history yet"
              body="Completed, cancelled, and declined sessions will stay available here."
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[12px] text-[rgb(var(--fg-muted))]">
                  {groups.past.length} past session{groups.past.length === 1 ? "" : "s"}
                </p>
                <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-[rgb(var(--brand-primary-dark))] uppercase">
                  Newest first
                </p>
              </div>
              <SessionGroup title="History" sessions={groups.past.slice(0, visibleHistoryCount)} />
              {visibleHistoryCount < groups.past.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setVisibleHistoryCount((current) =>
                      Math.min(current + HISTORY_PAGE_SIZE, groups.past.length),
                    );
                  }}
                  className="sk-press min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 text-[12px] font-bold text-[rgb(var(--fg-secondary))] shadow-[var(--shadow-sm)] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                >
                  Show more history
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionsEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section
      className="rounded-[var(--radius-xl)] border border-dashed px-6 py-10 text-center"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-strong))",
      }}
    >
      <h2 className="font-display text-[19px] font-extrabold text-[rgb(var(--fg-default))]">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-[320px] text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        {body}
      </p>
    </section>
  );
}

function SessionGroup({
  title,
  sessions,
  featured = false,
}: {
  title: string;
  sessions: SessionListItem[];
  featured?: boolean;
}) {
  return (
    <section aria-labelledby={`sessions-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <h2
        id={`sessions-${title.toLowerCase().replaceAll(" ", "-")}`}
        className="mb-2.5 font-mono text-[10px] font-bold tracking-[0.15em] text-[rgb(var(--fg-muted))] uppercase"
      >
        {title}
      </h2>
      <div
        className="rounded-[var(--radius-xl)] border px-4"
        style={{
          background: featured
            ? "linear-gradient(135deg, rgb(var(--brand-primary) / 0.10), rgb(var(--bg-elevated)) 48%)"
            : "rgb(var(--bg-elevated))",
          borderColor: featured ? "rgb(var(--brand-primary) / 0.35)" : "rgb(var(--border-subtle))",
          boxShadow: featured ? "var(--shadow-md)" : "var(--shadow-sm)",
        }}
      >
        <ul className="divide-y divide-[rgb(var(--border-subtle))]">
          {sessions.map((session) => (
            <li key={session.id}>
              <SessionRow session={session} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
