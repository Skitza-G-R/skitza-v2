import { getSiteUrl } from "~/server/stripe/client";

// Server-only — reads TRANZILA_TERMINAL_NAME from process.env. Don't
// import this from a client component.
//
// Builds the URL for Tranzila's `iframenew.php` hosted-fields iframe.
// PCI scope stays with Tranzila: card details are typed into their
// iframe and never touch our origin. Success/failure flows route back
// through `/api/tranzila/callback` (same handler for both the user's
// browser redirect and Tranzila's server-to-server `notify_url`).

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

  const callbackBase = `${getSiteUrl()}/api/tranzila/callback`;
  const successUrl = `${callbackBase}?bookingId=${params.bookingId}&status=success`;
  const failUrl = `${callbackBase}?bookingId=${params.bookingId}&status=fail`;

  const query = new URLSearchParams({
    sum: sumMajor,
    currency: String(currencyCode),
    tranmode: "A",
    lang,
    nologo: "1",
    trButtonId: "skitza-pay",
    success_url: successUrl,
    fail_url: failUrl,
    notify_url: successUrl,
  });

  return `https://direct.tranzila.com/${encodeURIComponent(terminal)}/iframenew.php?${query.toString()}`;
}
