import { NextResponse } from "next/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila redirects the artist back here on success (GET) and also
// posts a server-to-server notification (POST). Tranzila is configured
// with separate success_url and fail_url, so landing on this route at
// all means Tranzila considered the charge successful — we trigger the
// booking flip on bookingId presence alone, ignoring our own status
// param. The mutation is idempotent on already-confirmed rows so a
// duplicate (browser GET + Tranzila POST) is fine.
//
// SECURITY: trusts the bookingId query param. See the SECURITY note on
// booking.confirmAfterPayment for the follow-up that should call
// Tranzila's confirm.php verification endpoint to harden this.

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

export async function GET(request: Request): Promise<Response> {
  console.log("[tranzila callback]", {
    url: request.url,
    params: Object.fromEntries(new URL(request.url).searchParams),
  });
  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get("bookingId");
  const status = searchParams.get("status");
  // Tranzila appends ConfirmationCode + Response on success.
  const confirmationCode = searchParams.get("ConfirmationCode");

  if (!bookingId) {
    return NextResponse.redirect(new URL("/artist", request.url));
  }

  // fail_url in tranzila.ts targets this same route with status=fail.
  // Without this guard, a cancel/decline would land here and confirm the
  // booking — we explicitly short-circuit to the payment page instead.
  if (status === "fail") {
    return NextResponse.redirect(
      new URL(`/artist/payment/${bookingId}?error=payment_failed`, request.url),
    );
  }

  const { ok } = await handle(bookingId, confirmationCode);
  if (ok) {
    return NextResponse.redirect(
      new URL("/artist?payment=success", request.url),
    );
  }
  return NextResponse.redirect(
    new URL(`/artist/payment/${bookingId}?error=payment_failed`, request.url),
  );
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
