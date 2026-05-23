import { auth, currentUser } from "@clerk/nextjs/server";

import {
  AlsoWaitingList,
  type WaitingRow,
} from "~/components/artist/home/also-waiting-list";
import { BookWithStudios } from "~/components/artist/home/book-with-studios";
import {
  FocalCard,
  type FocalItem,
} from "~/components/artist/home/focal-card";
import { InboxHero } from "~/components/artist/home/inbox-hero";
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

  const subline = buildSubline(focal.kind);

  return (
    <div className="mx-auto w-full max-w-[600px] space-y-10 lg:space-y-12 lg:pt-4">
      <WelcomeModal />
      <InboxHero
        firstName={firstName}
        todayLabel={todayLabel}
        subline={subline}
      />
      <FocalCard item={focal} />
      <AlsoWaitingList rows={alsoWaiting} />
      <BookWithStudios studios={studios} />
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

function buildSubline(kind: FocalItem["kind"]): string {
  switch (kind) {
    case "mix":
      return "Your new mix is ready.";
    case "payment":
      return "One payment to complete.";
    case "session":
      return "Session this week.";
    case "quiet":
      return "All quiet.";
  }
}

function isWithinNextSevenDays(d: Date): boolean {
  const ms = d.getTime() - Date.now();
  return ms >= 0 && ms <= SEVEN_DAYS_MS;
}
