import { auth, currentUser } from "@clerk/nextjs/server";

import { ActivityTail } from "~/components/artist/home/activity-tail";
import {
  AlsoWaitingList,
  type WaitingRow,
} from "~/components/artist/home/also-waiting-list";
import { BalanceSnapshot } from "~/components/artist/home/balance-snapshot";
import { BookWithStudios } from "~/components/artist/home/book-with-studios";
import {
  FocalCard,
  type FocalItem,
} from "~/components/artist/home/focal-card";
import { InboxHero } from "~/components/artist/home/inbox-hero";
import { ThisWeekStrip } from "~/components/artist/home/this-week-strip";
import { buildSubline } from "~/lib/artist/build-subline";
import { appRouter } from "~/server/trpc/routers/_app";

import { WelcomeModal } from "./welcome-modal";

// ─── /artist — inbox-style home (SK-26) ─────────────────────────────
//
// One focal card at the top, a quiet "Also waiting" list below.
// Picked from the same `artist.home` + `artist.book.myPendingPayments`
// data the prior dashboard rendered; no schema changes.
//
// Focal priority:
//   1. New unread mix
//   2. Pending payment
//   3. Upcoming session within 7 days
//   4. Quiet (empty state)
//
// "Also waiting" picks up to 2 of the items NOT promoted to focal so
// the artist still sees them, but without the visual weight of cards.

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function formatAmount(amountCents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const amount = amountCents / 100;
  const hasCents = amount % 1 !== 0;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${symbol}${formatted}`;
}

export default async function ArtistHomePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const [user, data, pendingPayments, studiosResp] = await Promise.all([
    currentUser(),
    caller.artist.home(),
    caller.artist.book.myPendingPayments(),
    caller.artist.studios(),
  ]);
  const studios = studiosResp.studios;

  const firstName = user?.firstName?.trim() || "there";
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Pick the single focal item by priority.
  const focal = pickFocal({
    latestMix: data.latestMix,
    firstPayment: pendingPayments.bookings[0] ?? null,
    nextSession: data.nextSession,
  });

  // Compose the "also waiting" rows from whatever isn't focal.
  const alsoWaiting = pickAlsoWaiting({
    pendingPayments: pendingPayments.bookings,
    nextSession: data.nextSession,
    focalKind: focal.kind,
  });

  const subline = buildSubline({ focal, studioCount: studios.length });

  // `today` is computed here so the rail's ThisWeekStrip + the home
  // tile share the same reference. Server-rendered → uses the
  // server's clock; tolerable for a weekly digest.
  const today = new Date();

  return (
    // Layout strategy by breakpoint:
    //   • mobile/tablet (< lg): single column, mx-auto, 600px max.
    //     The rail collapses BELOW the main column with mt-12 so
    //     it's still reachable, just stacked.
    //   • desktop (lg+): two-column grid CENTERED in the viewport.
    //     Main 760px + 48px gap + rail 320px = 1128px. The outer
    //     `mx-auto max-w-[1128px]` centers the whole block so the
    //     two columns sit in the middle of the main area, with
    //     symmetric breathing room left and right — instead of the
    //     left-anchored / void-on-the-right shape we saw after the
    //     first attempt. The wider columns also cover more of the
    //     screen so the page doesn't read as "tight inbox in a wide
    //     window."
    <div className="mx-auto w-full max-w-[600px] lg:max-w-[1128px]">
      <div className="lg:grid lg:grid-cols-[760px_320px] lg:items-start lg:gap-12">
        {/* Main column — all the primary sections. */}
        <div className="space-y-6">
          <WelcomeModal />
          <InboxHero
            firstName={firstName}
            todayLabel={todayLabel}
            subline={subline}
          />
          <FocalCard item={focal} />
          <AlsoWaitingList rows={alsoWaiting} />
          <BookWithStudios studios={studios} />
          <ActivityTail items={data.activity} />
        </div>

        {/* Right rail — desktop-only quiet context. On < lg it
            naturally falls below the main column (still flex flow,
            no grid), separated by mt-12. */}
        <aside
          aria-label="Context"
          className="mt-12 space-y-8 lg:mt-0 lg:sticky lg:top-10"
        >
          <ThisWeekStrip
            sessions={data.upcomingSessions.map((s) => ({ startsAt: s.startsAt }))}
            today={today}
          />
          <BalanceSnapshot balance={data.outstandingBalance} />
        </aside>
      </div>

      {/* Page-end byline — gives the page a clear bottom edge so it
          doesn't trail off into the persistent player. Faint mono,
          minimal weight; this is a wayfinder, not a CTA. Spans the
          full width below both columns. */}
      <footer className="mt-16 border-t border-[rgb(var(--border-subtle))] pt-6 text-center">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-faint))]">
          Skitza · powered by your producers
        </p>
      </footer>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

type LatestMix = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof appRouter.createCaller>["artist"]["home"]>
  >["latestMix"]
>;
type NextSession = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof appRouter.createCaller>["artist"]["home"]>
  >["nextSession"]
>;
type PendingPayment = Awaited<
  ReturnType<
    ReturnType<typeof appRouter.createCaller>["artist"]["book"]["myPendingPayments"]
  >
>["bookings"][number];

function pickFocal(input: {
  latestMix: LatestMix | null;
  firstPayment: PendingPayment | null;
  nextSession: NextSession | null;
}): FocalItem {
  if (input.latestMix) {
    return {
      kind: "mix",
      mix: {
        id: input.latestMix.id,
        trackTitle: input.latestMix.trackTitle,
        label: input.latestMix.label,
        producerName: input.latestMix.producerName,
        projectId: input.latestMix.projectId,
        audioUrl: input.latestMix.audioUrl,
        durationMs: input.latestMix.durationMs,
      },
    };
  }
  if (input.firstPayment) {
    return {
      kind: "payment",
      payment: {
        bookingId: input.firstPayment.id,
        producerName: input.firstPayment.producerName,
        packageName: input.firstPayment.packageName,
        amountFormatted: formatAmount(
          input.firstPayment.amountCents,
          input.firstPayment.currency,
        ),
      },
    };
  }
  if (input.nextSession && isWithinNextSevenDays(input.nextSession.startsAt)) {
    return {
      kind: "session",
      session: {
        id: input.nextSession.id,
        startsAt: input.nextSession.startsAt,
        durationMin: input.nextSession.durationMin,
        producerName: input.nextSession.producerName,
        productName: input.nextSession.productName,
      },
    };
  }
  return { kind: "quiet" };
}

function pickAlsoWaiting(input: {
  pendingPayments: PendingPayment[];
  nextSession: NextSession | null;
  focalKind: FocalItem["kind"];
}): WaitingRow[] {
  const rows: WaitingRow[] = [];

  // Payment row: if there's at least one and it's not the focal item.
  const paymentToShow =
    input.focalKind === "payment"
      ? input.pendingPayments[1] ?? null
      : input.pendingPayments[0] ?? null;

  if (paymentToShow) {
    rows.push({
      kind: "payment",
      bookingId: paymentToShow.id,
      amountFormatted: formatAmount(
        paymentToShow.amountCents,
        paymentToShow.currency,
      ),
      packageName: paymentToShow.packageName,
      producerName: paymentToShow.producerName,
    });
  }

  // Session row: skip if it's the focal one. We still show sessions
  // beyond the 7-day window here — they're informational, not urgent.
  if (input.focalKind !== "session" && input.nextSession) {
    rows.push({
      kind: "session",
      sessionId: input.nextSession.id,
      startsAt: input.nextSession.startsAt,
      durationMin: input.nextSession.durationMin,
      productName: input.nextSession.productName,
      producerName: input.nextSession.producerName,
    });
  }

  return rows.slice(0, 2);
}

function isWithinNextSevenDays(d: Date): boolean {
  const ms = d.getTime() - Date.now();
  return ms >= 0 && ms <= SEVEN_DAYS_MS;
}
