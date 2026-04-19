import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

import { InvoicesList, type InvoiceRow } from "./invoices-list";

// /dashboard/invoices — flat list of every Stripe Checkout Session
// the producer has created. Server-rendered for the first paint;
// future polish can switch to a tRPC query if we add row-level
// actions (resend, void, refund-from-here). Drizzle Date columns are
// serialised to ISO strings so the client component receives plain
// data.
export default async function InvoicesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const rows = await caller.stripe.listInvoices();

  const invoices: InvoiceRow[] = rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    amountCents: r.amountCents,
    currency: r.currency,
    description: r.description,
    kind: r.kind,
    status: r.status,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <AppShell active="today">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up mb-8">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Invoices
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            What you&apos;ve billed.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Every Checkout Session you&apos;ve sent — deposits, finals, milestones. Paid
            ones flip green when Stripe confirms.
          </p>
        </header>

        <InvoicesList invoices={invoices} />
      </div>
    </AppShell>
  );
}
