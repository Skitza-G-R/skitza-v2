import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila's server-to-server confirmation (notify_url POST). This is
// the AUTHORITATIVE confirmation channel — the browser-side success
// page is now pure UI and does NOT call confirmAfterPayment. Tranzila
// retries non-2xx responses, so we always return 200 even on internal
// errors (confirmAfterPayment is idempotent, so retries are safe).
//
// Tranzila posts the result as application/x-www-form-urlencoded in
// the request BODY, not the querystring — earlier versions of this
// handler read from URL.searchParams and logged empty params as a
// result. We parse the body via URLSearchParams to recover every field.
//
// Field conventions:
//   - `pdesc`     — bookingId (we set this in buildTranzilaRedirectUrl
//                   because Tranzila echoes pdesc back verbatim).
//   - `bookingId` — defensive fallback in case the routing changes.
//   - `Response`  — "000" means success; anything else means decline /
//                   error and we should NOT confirm the booking.
//
// SECURITY: trusts the bookingId field. See the SECURITY note on
// booking.confirmAfterPayment for the follow-up that should call
// Tranzila's confirm.php verification endpoint to harden this.

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  console.log("[tranzila callback POST]", {
    url: request.url,
    params,
  });

  const bookingId = params.pdesc ?? params.bookingId ?? null;
  const response = params.Response;

  if (!bookingId) {
    console.error("[tranzila callback POST] missing bookingId", { params });
    return new Response("OK", { status: 200 });
  }

  if (response !== "000") {
    console.error("[tranzila callback POST] non-success response", {
      response,
      bookingId,
    });
    return new Response("OK", { status: 200 });
  }

  try {
    const caller = appRouter.createCaller({ userId: null });
    await caller.booking.confirmAfterPayment({ bookingId });
    console.log("[tranzila callback POST] confirmed booking", { bookingId });
  } catch (err) {
    console.error("[tranzila callback POST] confirmAfterPayment failed", {
      bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Always 200 — Tranzila retries non-2xx responses, and the underlying
  // mutation is idempotent so retries are safe.
  return new Response("OK", { status: 200 });
}
