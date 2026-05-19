import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila's server-to-server confirmation for store purchases — the
// notify_url POST mirrors /api/tranzila/callback (the booking flow)
// but flips a project row instead of a booking row. The browser-side
// success page is pure UI and does not call this; Tranzila retries
// non-2xx, so we always return 200 even on internal errors
// (artist.store.confirmAfterPayment is idempotent).
//
// Tranzila posts the result as application/x-www-form-urlencoded in
// the request BODY, not the querystring. Field conventions match the
// booking callback:
//   - `pdesc`     — projectId (set in buildTranzilaRedirectUrl from
//                   artist.store.checkout).
//   - `projectId` — defensive fallback if routing changes.
//   - `Response`  — "000" means success; anything else means decline /
//                   error and we should NOT flip the project.

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  console.log("[tranzila store-callback POST]", {
    url: request.url,
    params,
  });

  const projectId = params.pdesc ?? params.projectId ?? null;
  const response = params.Response;

  if (!projectId) {
    console.error("[tranzila store-callback POST] missing projectId", {
      params,
    });
    return new Response("OK", { status: 200 });
  }

  if (response !== "000") {
    console.error("[tranzila store-callback POST] non-success response", {
      response,
      projectId,
    });
    return new Response("OK", { status: 200 });
  }

  try {
    const caller = appRouter.createCaller({ userId: null });
    await caller.artist.store.confirmAfterPayment({
      projectId,
      ...(params.ConfirmationCode
        ? { tranzilaConfirmationCode: params.ConfirmationCode }
        : {}),
    });
    console.log("[tranzila store-callback POST] confirmed project", {
      projectId,
      confirmationCode: params.ConfirmationCode,
    });
  } catch (err) {
    console.error(
      "[tranzila store-callback POST] confirmAfterPayment failed",
      {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return new Response("OK", { status: 200 });
}
