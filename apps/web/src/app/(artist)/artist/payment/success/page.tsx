import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila redirects the top-level browser window here after a charge
// (success_url in lib/tranzila.ts). The AUTHORITATIVE booking
// confirmation already happened server-to-server via
// /api/tranzila/callback (notify_url POST) — this page is purely a
// celebration / "what happens next" surface for the artist.
//
// Tranzila strips arbitrary success_url params, so we don't have a
// bookingId on the querystring. We resolve the booking via the
// authenticated Clerk session instead: look up the artist's most
// recently confirmed booking (within the last 10 minutes). If anything
// goes wrong — no recent booking, no session, query throws — we fall
// back to a graceful generic confirmation panel.

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

// Shape of the artist.recentConfirmedBooking result (non-null branch).
// We extract it via two ReturnType peels — one through createCaller,
// one through the procedure call — so the success page stays in lock-
// step with the procedure's projection without a manual mirror type.
type RecentBooking = NonNullable<
  Awaited<
    ReturnType<
      ReturnType<typeof appRouter.createCaller>["artist"]["recentConfirmedBooking"]
    >
  >
>;

export default async function PaymentSuccessPage() {
  const { userId } = await auth();

  let booking: RecentBooking | null = null;
  if (userId) {
    try {
      const caller = appRouter.createCaller({ userId });
      booking = await caller.artist.recentConfirmedBooking();
    } catch (err) {
      // Don't let a lookup failure blank the page — log and fall through
      // to the generic confirmation.
      console.error("[payment/success] recentConfirmedBooking failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Generic fallback — no Clerk session, no recent booking, or the
  // lookup blew up. Booking is still confirmed by the notify_url POST;
  // we just can't reference its details in the UI.
  if (!booking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <div className="text-5xl">🎉</div>
        <h1 className="font-syne text-2xl font-bold text-[rgb(var(--fg-primary))]">
          Payment confirmed!
        </h1>
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          Your session has been booked successfully.
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
