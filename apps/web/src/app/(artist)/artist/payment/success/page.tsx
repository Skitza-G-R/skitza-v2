import Link from "next/link";

// Tranzila redirects the top-level browser window here after a charge
// (success_url in lib/tranzila.ts). The AUTHORITATIVE booking
// confirmation already happened server-to-server via
// /api/tranzila/callback (notify_url POST) — this page is purely a
// celebration / "what happens next" surface for the artist.
//
// `pdesc` echoes the bookingId we sent; `ConfirmationCode` is Tranzila's
// txn receipt. Both are best-effort — if Tranzila omits them, we render
// a graceful generic success.
//
// Future: when there's a public `booking.getById` that the unauthenticated
// caller can hit (Tranzila's success redirect runs without our session
// cookies in some flows), enrich this surface with the actual booking
// fields (producer name, session start, amount paid).

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  // pdesc is the canonical transport (Tranzila echoes it back verbatim);
  // explicit `bookingId` stays as a defensive fallback for future
  // routing changes.
  const bookingId = params.pdesc ?? params.bookingId ?? null;
  const confirmationCode = params.ConfirmationCode ?? null;

  console.log("[payment/success] render", {
    bookingId,
    confirmationCode,
    pdesc: params.pdesc,
    response: params.Response,
  });

  // No bookingId in the URL → minimal centered confirmation. The booking
  // is still confirmed by the notify_url POST; we just can't reference
  // its id in the UI.
  if (!bookingId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <div className="text-5xl">🎉</div>
        <h1 className="font-syne text-2xl font-bold text-[rgb(var(--fg-primary))]">
          Payment confirmed!
        </h1>
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          Your session has been booked successfully.
        </p>
        {confirmationCode ? (
          <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            Confirmation: {confirmationCode}
          </p>
        ) : null}
        <Link
          href="/artist"
          className="rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 py-3 text-sm font-medium text-white"
        >
          Go to my dashboard →
        </Link>
      </div>
    );
  }

  // Carded confirmation — we have a bookingId reference, render a
  // proper "receipt" card with the Tranzila confirmation number and
  // a single CTA back to the dashboard.
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 bg-[rgb(var(--bg-background))]">
      <div className="w-full max-w-sm rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-8 shadow-[var(--shadow-md)]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--success)/0.1)]">
            <span className="text-3xl">✓</span>
          </div>
          <h1 className="font-syne text-xl font-bold text-[rgb(var(--fg-primary))]">
            Payment confirmed!
          </h1>
          <p className="text-center text-sm text-[rgb(var(--fg-muted))]">
            Your session has been booked successfully.
          </p>
        </div>

        {confirmationCode ? (
          <div className="mb-4 rounded-lg bg-[rgb(var(--bg-base))] p-3">
            <p className="text-center font-mono text-xs text-[rgb(var(--fg-muted))]">
              Confirmation #{confirmationCode}
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
