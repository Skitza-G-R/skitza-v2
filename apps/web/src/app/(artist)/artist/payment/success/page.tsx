import { redirect } from "next/navigation";

// Tranzila redirects the top-level browser window here after a charge.
// This page is a pure UI redirect — the AUTHORITATIVE confirmation
// happens server-to-server via /api/tranzila/callback (notify_url POST)
// against the form-encoded body. We don't need (and don't trust) any
// querystring params Tranzila tacks on the success URL.
//
// Always bounce to /artist?payment=success so the artist home page can
// render its confirmation banner. If the notify POST hasn't been
// processed yet (race), /artist will briefly show the booking as
// pending — the next render reconciles within seconds.
export default function PaymentSuccessPage() {
  redirect("/artist?payment=success");
}
