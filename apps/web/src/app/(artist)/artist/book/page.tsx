import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { resolveArtistStudioId, withArtistStudio } from "~/lib/artist-studio-context";
import { readArtistStudioPreference } from "~/server/artist/studio-preference";
import { appRouter } from "~/server/trpc/routers/_app";
import { BookingClient } from "./booking-client";
import {
  findPrepaidSessionByAllowance,
  uniquePrepaidSessionForProject,
} from "./prepaid-session-selection";

export type ArtistBookPageProps = {
  searchParams: Promise<{
    studio?: string;
    producerId?: string;
    project?: string;
    allowance?: string;
    session?: string;
  }>;
};

// Server Component. Resolves the artist's studios + the active
// studio's 14-day availability up front so the client component
// paints immediately. The active studio is selected via ?studio=<id>
// from the Studio Switcher; falling back to the first studio when
// nothing is specified.
//
// The artist layout already gates on sign-in + redirects empty users
// to /artist-welcome, so the auth() check here is defense-in-depth
// (matches the other tab pages).
export async function ArtistBookFlow({ searchParams }: ArtistBookPageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });

  const sp = await searchParams;
  const [{ studios }, savedStudioId] = await Promise.all([
    caller.artist.studios(),
    readArtistStudioPreference(userId),
  ]);
  const rescheduleSession = sp.session
    ? await caller.artist.book.session({ id: sp.session })
    : null;

  // Default to the studio from the search param, or the most-recent
  // studio. `studios` is already sorted desc by lastSeenAt server-side.
  const requestedStudioId = sp.studio ?? sp.producerId ?? null;
  const activeStudioId =
    rescheduleSession?.producerId ??
    resolveArtistStudioId(studios, requestedStudioId, savedStudioId);
  if (!activeStudioId) {
    return (
      <div className="reveal-up space-y-5">
        <BookEyebrow studioId={null} />
        <EmptyStudios />
      </div>
    );
  }

  const activePackages = await caller.artist.book.activePackages({
    producerId: activeStudioId,
    bookingId: rescheduleSession?.id,
  });
  const selectablePackages = rescheduleSession
    ? activePackages.filter(
        (row) => row.sessionAllowanceId === rescheduleSession.sessionAllowanceId,
      )
    : activePackages;
  const explicitAllowance = findPrepaidSessionByAllowance(
    selectablePackages,
    rescheduleSession?.sessionAllowanceId ?? sp.allowance ?? null,
  );
  const projectAllowance = uniquePrepaidSessionForProject(selectablePackages, sp.project ?? null);
  const onlyAllowance = selectablePackages.length === 1 ? selectablePackages[0] : null;
  const initialSessionAllowanceId =
    explicitAllowance?.sessionAllowanceId ??
    projectAllowance?.sessionAllowanceId ??
    onlyAllowance?.sessionAllowanceId ??
    null;
  // Do not query private schedule data until the artist has selected one
  // server-authorized purchase allowance (or an owned session to reschedule).
  const availabilityResult = rescheduleSession
    ? await caller.artist.book.availability({
        producerId: activeStudioId,
        bookingId: rescheduleSession.id,
      })
    : initialSessionAllowanceId
      ? await caller.artist.book.availability({
          producerId: activeStudioId,
          sessionAllowanceId: initialSessionAllowanceId,
        })
      : {
          days: [],
          artistTimeZone: "UTC",
          studioTimeZone: "UTC",
          today: new Date().toISOString().slice(0, 10),
        };
  const availability = {
    ...availabilityResult,
    days: availabilityResult.days.map((day) => ({
      date: day.date,
      slots: day.slots.map((slot) => ({
        startsAtISO: slot.startsAt.toISOString(),
        endsAtISO: slot.endsAt.toISOString(),
        studioDate: slot.studioDate,
        studioStartMin: slot.studioStartMin,
      })),
    })),
  };

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-5">
      <BookEyebrow studioId={activeStudioId} />
      <BookingClient
        key={`${activeStudioId}:${initialSessionAllowanceId ?? "none"}:${rescheduleSession?.id ?? "new"}`}
        activeStudioId={activeStudioId}
        availability={availability}
        studios={studios}
        activePackages={selectablePackages}
        initialSessionAllowanceId={initialSessionAllowanceId}
        rescheduleSessionId={rescheduleSession?.id ?? null}
      />
    </div>
  );
}

export default ArtistBookFlow;

// Tiny page-identity row above the card. The card itself carries the
// producer + session context, so this stays a quiet visual handle for
// the route rather than a competing heading.
function BookEyebrow({ studioId }: { studioId: string | null }) {
  return (
    <header className="flex items-baseline justify-between px-1 sm:px-0">
      <h1 className="font-display text-[20px] leading-none font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
        Book
        <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
      <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
        <Link
          href={withArtistStudio("/artist/sessions", studioId)}
          className="sk-press inline-flex min-h-11 items-center underline decoration-dotted underline-offset-4"
        >
          My sessions
        </Link>
      </p>
    </header>
  );
}

function EmptyStudios() {
  return (
    <section
      aria-label="No studios yet"
      className="overflow-hidden rounded-[var(--radius-2xl)] border bg-[rgb(var(--bg-elevated))]"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div
        aria-hidden
        className="flex h-28 items-center justify-center"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgb(var(--brand-primary) / 0.18), transparent 65%), rgb(var(--bg-overlay))",
        }}
      >
        <span
          className="font-mono text-[10px] font-bold tracking-[0.24em] uppercase"
          style={{ color: "rgb(var(--brand-primary))" }}
        >
          Waiting for an invite
        </span>
      </div>
      <div className="px-6 py-6 lg:px-8">
        <p className="font-display text-[20px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          Nothing to book yet.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Once a producer invites you, their next 14 days appear here. You pick a window, they
          confirm.
        </p>
      </div>
    </section>
  );
}
