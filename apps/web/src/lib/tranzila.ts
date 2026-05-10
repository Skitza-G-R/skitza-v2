import { getSiteUrl } from "~/server/stripe/client";

// Server-only — reads TRANZILA_TERMINAL_NAME from process.env. Don't
// import this from a client component.
//
// Tranzila DirectNG (directng.tranzila.com) requires a POST form
// submission, not a GET URL with query string. PCI scope stays with
// Tranzila: card details are typed into their iframe and never touch
// our origin. The payment page renders a hidden <form> that
// auto-submits to the iframe target on page load.
//
// Tranzila redirects the top-level browser window:
//   - on success → /artist/payment/success (server page confirms the booking)
//   - on failure → /artist/payment/{bookingId}?error=payment_failed
// notify_url is the server-to-server confirmation, posted to
// /api/tranzila/callback by Tranzila independently.

// Tranzila currency codes — ILS/USD use Tranzila's internal 1/2 codes;
// EUR/GBP use their ISO 4217 numeric codes per Tranzila's DirectNG docs.
const CURRENCY_MAP: Record<string, string> = {
  ILS: "1",
  USD: "2",
  EUR: "978",
  GBP: "826",
};

export function buildTranzilaPostParams(params: {
  amountCents: number;
  currency: string;
  bookingId: string;
  artistEmail?: string;
  artistName?: string;
  productName?: string;
  lang?: "il" | "en";
}): Record<string, string> {
  const terminalName = process.env.TRANZILA_TERMINAL_NAME;
  if (!terminalName) {
    throw new Error("TRANZILA_TERMINAL_NAME is not configured");
  }

  const siteUrl = getSiteUrl();
  const amount = (params.amountCents / 100).toFixed(2);
  const currencyCode = CURRENCY_MAP[params.currency] ?? "1";

  return {
    sum: amount,
    currency: currencyCode,
    tranmode: "A",
    cred_type: "1",
    lang: params.lang ?? "il",
    nologo: "1",
    contact: params.artistName ?? "Artist",
    company: "Skitza",
    email: params.artistEmail ?? "",
    country: "Israel",
    zip: "0000",
    address: "N/A",
    city: "N/A",
    pdesc: params.productName ?? "Studio Session",
    success_url_address: `${siteUrl}/artist/payment/success?bookingId=${params.bookingId}`,
    fail_url_address: `${siteUrl}/artist/payment/${params.bookingId}?error=payment_failed`,
    notify_url_address: `${siteUrl}/api/tranzila/callback?bookingId=${params.bookingId}`,
  };
}

export function getTranzilaFormAction(): string {
  const terminalName = process.env.TRANZILA_TERMINAL_NAME;
  if (!terminalName) {
    throw new Error("TRANZILA_TERMINAL_NAME is not configured");
  }
  return `https://directng.tranzila.com/${terminalName}/iframenew.php`;
}
