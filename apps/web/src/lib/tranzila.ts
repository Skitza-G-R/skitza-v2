// Server-only — falls back to TRANZILA_TERMINAL_NAME from process.env
// when no per-producer terminal is passed in. Don't import this from a
// client component.
//
// Builds the URL for Tranzila's `iframenew.php` hosted page. The
// payment page redirects the browser directly to this URL — the artist
// pays on Tranzila's own page, then Tranzila redirects them back to
// the configured success / fail paths. notify_url is the server-to-
// server confirmation, posted independently by Tranzila.
//
// `pdesc` carries the id Tranzila echoes back on both the redirect and
// the notify_url POST. Booking flow passes a bookingId; store flow
// passes a projectId. Each caller owns the success/notify/fail paths
// (with whatever query params they need on the way back).
//
// `terminalName` is the per-producer Tranzila terminal (producers.tranzila_terminal_name).
// When provided, payments route to that terminal so funds flow directly
// to the producer; when null/undefined, we fall back to the master
// sandbox terminal in env so the flow keeps working pre-onboarding.

export function buildTranzilaRedirectUrl(params: {
  amountCents: number;
  currency: string;
  pdesc: string;
  successPath: string;
  notifyPath: string;
  failPath: string;
  artistEmail?: string;
  artistName?: string;
  productName?: string;
  lang?: "il" | "en";
  terminalName?: string;
}): string {
  const terminalName =
    params.terminalName ?? process.env.TRANZILA_TERMINAL_NAME;
  if (!terminalName) {
    throw new Error("No Tranzila terminal configured");
  }

  // Trim leading/trailing whitespace (env values pasted via the Vercel
  // dashboard often carry a trailing newline). Then validate the URL
  // starts with https:// — if internal whitespace or other corruption
  // mangled the protocol, fall back to the hardcoded canonical origin
  // rather than send Tranzila a malformed URL.
  const FALLBACK_SITE_URL = "https://skitza.app";
  const rawSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    FALLBACK_SITE_URL;
  const trimmedSiteUrl = rawSiteUrl.trim();
  const safeSiteUrl = trimmedSiteUrl.startsWith("https://")
    ? trimmedSiteUrl
    : FALLBACK_SITE_URL;
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
    // Tranzila echoes pdesc back on both the success redirect query and
    // the notify_url POST body, so the callback can recover the id even
    // if the success_url query string gets mangled.
    pdesc: params.pdesc,
    // Use the legacy `*_url` parameter names — the newer `*_url_address`
    // variants mangle `https://` into `https:/` in Tranzila's redirect.
    success_url: `${safeSiteUrl}${params.successPath}`,
    fail_url: `${safeSiteUrl}${params.failPath}`,
    notify_url: `${safeSiteUrl}${params.notifyPath}`,
  });

  return `https://direct.tranzila.com/${terminalName}/iframenew.php?${urlParams.toString()}`;
}
