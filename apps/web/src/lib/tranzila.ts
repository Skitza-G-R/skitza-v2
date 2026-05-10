import { getSiteUrl } from "~/server/stripe/client";

// Server-only — reads TRANZILA_TERMINAL_NAME from process.env. Don't
// import this from a client component.
//
// Builds the URL for Tranzila's `iframenew.php` hosted-fields iframe.
// PCI scope stays with Tranzila: card details are typed into their
// iframe and never touch our origin.
//
// Tranzila redirects the top-level browser window:
//   - on success → /artist/payment/success (server page confirms the booking)
//   - on failure → /artist/payment/{bookingId}?error=payment_failed
// notify_url is the server-to-server confirmation, posted to
// /api/tranzila/callback by Tranzila independently.

const CURRENCY_CODES: Record<string, number> = {
  ILS: 1,
  USD: 2,
  EUR: 3,
};

export function buildTranzilaIframeUrl(params: {
  amountCents: number;
  currency: string;
  bookingId: string;
  lang?: "il" | "en";
}): string {
  const terminal = process.env.TRANZILA_TERMINAL_NAME;
  if (!terminal) {
    throw new Error("TRANZILA_TERMINAL_NAME is not configured");
  }

  const sumMajor = (params.amountCents / 100).toFixed(2);
  const currencyCode =
    CURRENCY_CODES[params.currency.toUpperCase()] ?? CURRENCY_CODES.ILS;
  const lang = params.lang ?? "il";

  const baseUrl = getSiteUrl();
  const successUrl = `${baseUrl}/artist/payment/success?bookingId=${params.bookingId}`;
  const failUrl = `${baseUrl}/artist/payment/${params.bookingId}?error=payment_failed`;
  const notifyUrl = `${baseUrl}/api/tranzila/callback?bookingId=${params.bookingId}`;

  const query = new URLSearchParams({
    sum: sumMajor,
    currency: String(currencyCode),
    tranmode: "V",
    cred_type: "1",
    lang,
    nologo: "1",
    trButtonId: "skitza-pay",
    success_url: successUrl,
    fail_url: failUrl,
    notify_url: notifyUrl,
  });

  return `https://direct.tranzila.com/${encodeURIComponent(terminal)}/iframenew.php?${query.toString()}`;
}
