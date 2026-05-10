import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  buildTranzilaPostParams,
  getTranzilaFormAction,
} from "~/lib/tranzila";
import { appRouter } from "~/server/trpc/routers/_app";
import { PaymentIframe } from "./payment-iframe";

type PageProps = {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ error?: string }>;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function formatAmount(amountCents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const major = (amountCents / 100).toFixed(2);
  return `${symbol}${major}`;
}

export default async function PaymentPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { bookingId } = await params;
  const { error } = await searchParams;

  const caller = appRouter.createCaller({ userId });

  let details: Awaited<
    ReturnType<typeof caller.payment.getPaymentDetails>
  >;
  try {
    details = await caller.payment.getPaymentDetails({ bookingId });
  } catch {
    redirect("/artist");
  }

  const tranzilaPostParams = buildTranzilaPostParams({
    amountCents: details.amountCents,
    currency: details.currency,
    bookingId,
    artistEmail: details.booking.artistEmail,
    artistName: details.booking.artistName,
    productName: details.product.name,
  });
  const tranzilaFormAction = getTranzilaFormAction();

  const isHalf = details.planKind === "split_50_50";
  const remaining = details.product.priceCents - details.amountCents;
  const subtext = isHalf
    ? `50% deposit — remaining ${formatAmount(remaining, details.currency)} due after delivery`
    : details.planKind === "monthly"
      ? `First installment — paid monthly`
      : "Flat payment";

  return (
    <div className="reveal-up space-y-4">
      {/* Dark hero — product + producer */}
      <div
        className="overflow-hidden rounded-[var(--radius-lg)] p-5 text-[rgb(var(--fg-onsidebar))]"
        style={{
          background:
            "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
        }}
      >
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider opacity-70">
          Complete payment
        </p>
        <p className="mt-1 font-display text-[22px] font-extrabold leading-none tracking-tight">
          {details.product.name}
        </p>
        <p className="mt-1.5 text-[13px] opacity-85">
          {details.producerName}
        </p>
      </div>

      {/* Amount */}
      <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Amount due
        </p>
        <p
          className="mt-1 text-[34px] font-extrabold leading-none tracking-tight text-[rgb(var(--fg-default))]"
          style={{ fontFamily: "var(--font-mono, 'JetBrains Mono'), monospace" }}
        >
          {formatAmount(details.amountCents, details.currency)}
          {isHalf ? (
            <span className="ml-2 text-[15px] font-medium text-[rgb(var(--fg-muted))]">
              deposit
            </span>
          ) : null}
        </p>
        <p className="mt-2 text-[12px] text-[rgb(var(--fg-muted))]">{subtext}</p>
      </div>

      {error === "payment_failed" ? (
        <div className="rounded-[var(--radius-md)] border border-red-500/40 bg-red-500/[0.06] p-3">
          <p className="text-sm text-[rgb(var(--fg-default))]">
            Payment didn&apos;t go through. Try again below.
          </p>
        </div>
      ) : null}

      {/* Tranzila iframe — PCI scope stays with Tranzila. */}
      <PaymentIframe
        formAction={tranzilaFormAction}
        postParams={tranzilaPostParams}
      />

      <p className="px-1 text-center text-[11px] text-[rgb(var(--fg-muted))]">
        Secured by Tranzila · SSL encrypted
      </p>
    </div>
  );
}
