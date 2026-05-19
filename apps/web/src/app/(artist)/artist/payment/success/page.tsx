import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila redirects the top-level browser window here after a charge
// (success_url in lib/tranzila.ts). The AUTHORITATIVE confirmation
// already happened server-to-server via /api/tranzila/callback
// (booking flow) or /api/tranzila/store-callback (SK-18 store flow) —
// this page is purely a celebration / "what happens next" surface.
//
// We resolve the most recent activity via the authenticated Clerk
// session: look up the artist's most-recent confirmed booking AND
// most-recent store purchase within the last 10 minutes, then render
// whichever is newer. If both lookups return null we fall back to the
// generic confirmation panel.

function formatStartsAt(startsAt: Date): string {
  // Server-side render; the booking time was authored in the producer's
  // timezone. We display it in en-US short form on a single line. The
  // home page's NextSessionCard surfaces the same time again with the
  // producer's TZ for the artist to reference.
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(startsAt);
}

function formatMoney(amountCents: number, currency: string | null): string {
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(0)} ${code}`;
  }
}

// Shape of the artist.recentConfirmedBooking result (non-null branch).
type RecentBooking = NonNullable<
  Awaited<
    ReturnType<
      ReturnType<typeof appRouter.createCaller>["artist"]["recentConfirmedBooking"]
    >
  >
>;

// Shape of the artist.recentStorePurchase result (non-null branch).
type RecentStorePurchase = NonNullable<
  Awaited<
    ReturnType<
      ReturnType<typeof appRouter.createCaller>["artist"]["recentStorePurchase"]
    >
  >
>;

export default async function PaymentSuccessPage() {
  const { userId } = await auth();

  let booking: RecentBooking | null = null;
  let storePurchase: RecentStorePurchase | null = null;
  if (userId) {
    const caller = appRouter.createCaller({ userId });
    const [bookingRes, storeRes] = await Promise.allSettled([
      caller.artist.recentConfirmedBooking(),
      caller.artist.recentStorePurchase(),
    ]);
    if (bookingRes.status === "fulfilled") {
      booking = bookingRes.value;
    } else {
      console.error(
        "[payment/success] recentConfirmedBooking failed",
        {
          userId,
          error:
            bookingRes.reason instanceof Error
              ? bookingRes.reason.message
              : String(bookingRes.reason),
        },
      );
    }
    if (storeRes.status === "fulfilled") {
      storePurchase = storeRes.value;
    } else {
      console.error("[payment/success] recentStorePurchase failed", {
        userId,
        error:
          storeRes.reason instanceof Error
            ? storeRes.reason.message
            : String(storeRes.reason),
      });
    }
  }

  // Pick whichever activity is newer. The booking flow stamps
  // statusChangedAt at confirmAfterPayment; the store flow stamps
  // paidAt at confirmAfterPayment. Both are within the same 10-minute
  // window when we get here, so a simple Date comparison is enough.
  const bookingTs = booking?.startsAt
    ? booking.startsAt.getTime()
    : null;
  // recentConfirmedBooking projects don't currently expose
  // statusChangedAt, only startsAt — fine as a tiebreaker proxy since
  // the artist almost never has both a fresh booking AND a fresh store
  // purchase pending at the same moment.
  const storeTs = storePurchase?.paidAt
    ? storePurchase.paidAt.getTime()
    : null;
  const preferStore =
    storePurchase !== null && (booking === null || (storeTs ?? 0) >= (bookingTs ?? 0));

  // Generic fallback — no Clerk session, no recent activity, or both
  // lookups blew up. The notify_url POST has already done the
  // authoritative confirmation; we just can't reference details.
  if (!booking && !storePurchase) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <div className="text-5xl">🎉</div>
        <h1 className="font-syne text-2xl font-bold text-[rgb(var(--fg-primary))]">
          Payment confirmed!
        </h1>
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          Your purchase has been confirmed.
        </p>
        <Link
          href="/artist"
          className="rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 py-3 text-sm font-medium text-white"
        >
          Go to my dashboard →
        </Link>
      </div>
    );
  }

  if (preferStore && storePurchase) {
    const sessionCount = storePurchase.sessionCount ?? 1;
    const sessionLabel = sessionCount === 1 ? "session" : "sessions";
    const totalLine =
      storePurchase.totalAmountCents != null
        ? formatMoney(
            storePurchase.totalAmountCents,
            storePurchase.currency,
          )
        : null;
    const producerName = storePurchase.producerName ?? "Your producer";
    const bookHref = `/artist/book?studio=${storePurchase.producerId}`;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 bg-[rgb(var(--bg-background))]">
        <div className="w-full max-w-sm rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-8 shadow-[var(--shadow-md)]">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--success)/0.1)]">
              <span className="text-3xl">✓</span>
            </div>
            <h1 className="font-syne text-xl font-bold text-[rgb(var(--fg-primary))]">
              🎉 Payment confirmed!
            </h1>
            <p className="text-center text-sm text-[rgb(var(--fg-muted))]">
              You purchased {storePurchase.title} — {sessionCount}{" "}
              {sessionLabel} ready to book.
            </p>
          </div>

          <dl className="mb-6 space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                Producer
              </dt>
              <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
                {producerName}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                Package
              </dt>
              <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
                {storePurchase.title}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                Sessions
              </dt>
              <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
                {sessionCount}
              </dd>
            </div>
            {totalLine ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                  Total paid
                </dt>
                <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
                  {totalLine}
                </dd>
              </div>
            ) : null}
          </dl>

          <Link
            href={bookHref}
            className="flex w-full items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            Book your first session →
          </Link>
        </div>
      </div>
    );
  }

  // Booking branch — existing rich card.
  if (!booking) {
    return null;
  }

  const sessionLine = formatStartsAt(booking.startsAt);
  const producerName = booking.producerName ?? "Your producer";
  const packageName = booking.packageNameSnapshot ?? "Session";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 bg-[rgb(var(--bg-background))]">
      <div className="w-full max-w-sm rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-8 shadow-[var(--shadow-md)]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--success)/0.1)]">
            <span className="text-3xl">✓</span>
          </div>
          <h1 className="font-syne text-xl font-bold text-[rgb(var(--fg-primary))]">
            🎉 Payment confirmed!
          </h1>
          <p className="text-center text-sm text-[rgb(var(--fg-muted))]">
            Your session has been booked successfully.
          </p>
        </div>

        {/* Booking detail rows. Each row is label (muted) → value
            (primary). Kept dense so the whole card fits in one
            viewport on a phone. */}
        <dl className="mb-6 space-y-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              When
            </dt>
            <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
              {sessionLine}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Producer
            </dt>
            <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
              {producerName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Package
            </dt>
            <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
              {packageName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Duration
            </dt>
            <dd className="text-right font-medium text-[rgb(var(--fg-primary))]">
              {booking.durationMin} min
            </dd>
          </div>
        </dl>

        {booking.tranzilaConfirmationCode ? (
          <div className="mb-4 rounded-lg bg-[rgb(var(--bg-base))] p-3">
            <p className="text-center font-mono text-xs text-[rgb(var(--fg-muted))]">
              Confirmation #{booking.tranzilaConfirmationCode}
            </p>
          </div>
        ) : null}

        <Link
          href="/artist"
          className="flex w-full items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          Go to my dashboard →
        </Link>
      </div>
    </div>
  );
}
