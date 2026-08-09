import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import {
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar/config";
import { appRouter } from "~/server/trpc/routers/_app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
} as const;

const STATE_MAX_BYTES = 1_024;
const CODE_MAX_BYTES = 4_096;
const ERROR_MAX_BYTES = 128;
const TEXT_ENCODER = new TextEncoder();

type SafeResultCode =
  | "selection"
  | "connected"
  | "denied"
  | "wrong-account"
  | "reconnect"
  | "error";

type BoundedValue = Readonly<{ ok: true; value: string | undefined } | { ok: false }>;

function privateResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: PRIVATE_HEADERS });
}

function boundedQueryValue(
  searchParams: URLSearchParams,
  key: "state" | "code" | "error",
  maxBytes: number,
  required = false,
): BoundedValue {
  const values = searchParams.getAll(key);
  if (values.length > 1) return { ok: false };
  const value = values[0];
  if (value === undefined) return required ? { ok: false } : { ok: true, value: undefined };
  if (value.length < 1 || TEXT_ENCODER.encode(value).byteLength > maxBytes) {
    return { ok: false };
  }
  return { ok: true, value };
}

function calendarRedirect(code: SafeResultCode): Response {
  const location = new URL("/dashboard/calendar", loadGoogleCalendarServerConfig().redirectUri);
  location.searchParams.set("tab", "availability");
  location.searchParams.set("google", code);
  return new Response(null, {
    status: 303,
    headers: {
      ...PRIVATE_HEADERS,
      Location: location.toString(),
    },
  });
}

function safeErrorCode(error: unknown): SafeResultCode {
  if (!(error instanceof TRPCError)) return "error";
  if (error.code === "PRECONDITION_FAILED") return "reconnect";
  if (
    error.code === "CONFLICT" &&
    error.message === "Choose the Google account already connected to Skitza"
  ) {
    return "wrong-account";
  }
  if (
    error.code === "BAD_REQUEST" &&
    error.message === "Google Calendar authorization was cancelled"
  ) {
    return "denied";
  }
  return "error";
}

export async function GET(request: Request): Promise<Response> {
  // Fail before auth and producer resolution while the capability is unavailable.
  if (!isGoogleCalendarServerConfigured()) {
    return privateResponse("Not found", 404);
  }

  const { userId } = await auth();
  if (!userId) return privateResponse("Unauthorized", 401);

  const searchParams = new URL(request.url).searchParams;
  const state = boundedQueryValue(searchParams, "state", STATE_MAX_BYTES, true);
  const code = boundedQueryValue(searchParams, "code", CODE_MAX_BYTES);
  const providerError = boundedQueryValue(searchParams, "error", ERROR_MAX_BYTES);
  if (
    !state.ok ||
    !code.ok ||
    !providerError.ok ||
    state.value === undefined ||
    (code.value !== undefined && providerError.value !== undefined)
  ) {
    return calendarRedirect("error");
  }

  try {
    const result = await appRouter.createCaller({ userId }).googleCalendar.oauth.complete({
      stateToken: state.value,
      ...(code.value !== undefined ? { code: code.value } : {}),
      ...(providerError.value !== undefined ? { providerError: providerError.value } : {}),
    });
    return calendarRedirect(result.status === "needs_selection" ? "selection" : "connected");
  } catch (error) {
    return calendarRedirect(safeErrorCode(error));
  }
}
