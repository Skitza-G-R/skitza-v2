import { createDb, eq, invoices } from "@skitza/db";

// Stripe redirects the visitor here after a successful Checkout. The
// session id is in `?session_id=`. We do a fast lookup against our
// invoices table to surface the correct status — if the webhook has
// already fired the row is "paid"; if the visitor outran the webhook
// we still show a friendly "we got it, processing" page. Either way
// the visitor leaves with confidence.
//
// Server component — no JS shipped — keeps this page fast on the post-
// payment redirect (visitor's bandwidth has just been spent on the
// Stripe round-trip).
export default async function BookSuccessPage(
  props: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ session_id?: string }>;
  },
) {
  const { slug } = await props.params;
  const { session_id } = await props.searchParams;

  let status: "paid" | "processing" | "unknown" = "unknown";
  if (session_id && process.env.DATABASE_URL) {
    const db = createDb(process.env.DATABASE_URL);
    const [inv] = await db
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.stripeCheckoutSessionId, session_id))
      .limit(1);
    if (inv?.status === "paid") status = "paid";
    else if (inv) status = "processing";
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
        {status === "paid" ? "Payment confirmed" : "Payment received"}
      </p>
      <h1
        className="mt-4 font-display text-4xl leading-tight tracking-tight"
        style={{ fontWeight: 800 }}
      >
        {status === "paid"
          ? "You're booked."
          : "Hang tight — we're confirming with Stripe."}
      </h1>
      <p className="mx-auto mt-5 max-w-md text-[rgb(var(--fg-secondary))]">
        {status === "paid"
          ? "A receipt is on its way to your inbox. The producer has been notified."
          : "This page will reflect 'paid' once Stripe pings us — usually within a few seconds."}
      </p>
      <a
        href={`/p/${slug}`}
        className="mt-8 inline-block rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-3 font-mono text-sm hover:border-[rgb(var(--border-strong))]"
      >
        Back to portfolio →
      </a>
    </main>
  );
}
