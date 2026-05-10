// Server-only — reads TRANZILA_TERMINAL_NAME from process.env. Don't
// import this from a client component.
//
// Builds the URL for Tranzila's `iframenew.php` hosted page. The
// payment page redirects the browser directly to this URL — the artist
// pays on Tranzila's own page, then Tranzila redirects them back to:
//   - on success → /artist/payment/success (server page confirms the booking)
//   - on failure → /artist/payment/{bookingId}?error=payment_failed
// notify_url_address is the server-to-server confirmation, posted to
// /api/tranzila/callback by Tranzila independently.

export function buildTranzilaRedirectUrl(params: {
  amountCents: number;
  currency: string;
  bookingId: string;
  artistEmail?: string;
  artistName?: string;
  productName?: string;
  lang?: "il" | "en";
}): string {
  const terminalName = process.env.TRANZILA_TERMINAL_NAME;
  if (!terminalName) {
    throw new Error("TRANZILA_TERMINAL_NAME is not configured");
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://skitza.app";
  const amount = (params.amountCents / 100).toFixed(2);

  // ILS/USD use Tranzila's internal 1/2 codes; EUR/GBP use ISO 4217
  // numeric codes per Tranzila's docs.
  const CURRENCY_MAP: Record<string, string> = {
    ILS: "1",
    USD: "2",
    EUR: "978",
    GBP: "826",
  };
  const currencyCode = CURRENCY_MAP[params.currency] ?? "1";

  const urlParams = new URLSearchParams({
    sum: amount,
    currency: currencyCode,
    tranmode: "A",
    cred_type: "1",
    lang: params.lang ?? "il",
    nologo: "1",
    contact: params.artistName ?? "Artist",
    email: params.artistEmail ?? "",
    pdesc: params.productName ?? "Studio Session",
    success_url_address: `${siteUrl}/artist/payment/success?bookingId=${params.bookingId}`,
    fail_url_address: `${siteUrl}/artist/payment/${params.bookingId}?error=payment_failed`,
    notify_url_address: `${siteUrl}/api/tranzila/callback?bookingId=${params.bookingId}`,
  });

  return `https://direct.tranzila.com/${terminalName}/iframenew.php?${urlParams.toString()}`;
}
