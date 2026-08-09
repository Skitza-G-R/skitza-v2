import { auth } from "@clerk/nextjs/server";

import { isGoogleCalendarServerConfigured } from "~/server/google-calendar/config";
import { appRouter } from "~/server/trpc/routers/_app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
} as const;

const OAUTH_INTENTS = new Set(["connect", "reconnect", "switch_account"] as const);
type OAuthIntent = "connect" | "reconnect" | "switch_account";

function privateResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: PRIVATE_HEADERS });
}

function readIntent(request: Request): OAuthIntent | null {
  const values = new URL(request.url).searchParams.getAll("intent");
  if (values.length !== 1) return null;
  const value = values[0];
  return value && OAUTH_INTENTS.has(value as OAuthIntent) ? (value as OAuthIntent) : null;
}

export async function GET(request: Request): Promise<Response> {
  // Keep the hidden capability indistinguishable from a missing route. This
  // check must happen before Clerk or the producer-scoped tRPC caller runs.
  if (!isGoogleCalendarServerConfigured()) {
    return privateResponse("Not found", 404);
  }

  const { userId } = await auth();
  if (!userId) return privateResponse("Unauthorized", 401);

  const intent = readIntent(request);
  if (!intent) return privateResponse("Bad request", 400);

  try {
    const result = await appRouter.createCaller({ userId }).googleCalendar.oauth.begin({
      intent,
      ...(intent === "switch_account" ? { switchConfirmed: true } : {}),
    });
    return new Response(null, {
      status: 303,
      headers: {
        ...PRIVATE_HEADERS,
        Location: result.authorizationUrl,
      },
    });
  } catch {
    return privateResponse("Google Calendar is unavailable", 502);
  }
}
