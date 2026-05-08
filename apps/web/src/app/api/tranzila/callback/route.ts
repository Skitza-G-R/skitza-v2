import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila's server-to-server confirmation (notify_url POST). The
// browser flow now redirects directly to /artist/payment/success — this
// route only handles the S2S confirmation. confirmAfterPayment is
// idempotent so a duplicate (browser-side success page + this POST) is
// fine.
//
// SECURITY: trusts the bookingId query/form param. See the SECURITY
// note on booking.confirmAfterPayment for the follow-up that should
// call Tranzila's confirm.php verification endpoint to harden this.

async function handle(
  bookingId: string | null,
  confirmationCode: string | null,
): Promise<{ ok: boolean }> {
  if (!bookingId) return { ok: false };
  try {
    const caller = appRouter.createCaller({ userId: null });
    await caller.booking.confirmAfterPayment({
      bookingId,
      ...(confirmationCode ? { tranzilaConfirmationCode: confirmationCode } : {}),
    });
    return { ok: true };
  } catch (err) {
    console.error("[tranzila] confirmAfterPayment failed", err);
    return { ok: false };
  }
}

export async function POST(request: Request): Promise<Response> {
  console.log("[tranzila callback POST]", {
    url: request.url,
    params: Object.fromEntries(new URL(request.url).searchParams),
  });
  // Tranzila's notify_url posts form-encoded fields. Parse what's
  // available; either query string OR body may carry the params
  // depending on the integration mode.
  const { searchParams } = new URL(request.url);
  let bookingId = searchParams.get("bookingId");
  let confirmationCode = searchParams.get("ConfirmationCode");

  if (!bookingId) {
    try {
      const form = await request.formData();
      bookingId = bookingId ?? (form.get("bookingId") as string | null);
      confirmationCode =
        confirmationCode ?? (form.get("ConfirmationCode") as string | null);
    } catch {
      // ignore — fall through with what we have
    }
  }

  await handle(bookingId, confirmationCode);
  // Always 200 — Tranzila retries non-2xx responses, and we're idempotent.
  return new Response("OK", { status: 200 });
}
