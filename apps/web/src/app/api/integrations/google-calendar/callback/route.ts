import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import {
  isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig,
} from "~/server/google-calendar/config";
import {
  GOOGLE_CALENDAR_OAUTH_BROWSER_COOKIE_NAME,
  GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH,
  isGoogleCalendarOAuthBrowserBinding,
} from "~/server/google-calendar/oauth";
import { createGoogleCalendarProvider } from "~/server/google-calendar/provider";
import { createGoogleCalendarRepository } from "~/server/google-calendar/repository-drizzle";
import {
  createGoogleCalendarService,
  GoogleCalendarServiceError,
} from "~/server/google-calendar/service";

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
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      ...PRIVATE_HEADERS,
      Location: location.toString(),
    },
  });
  response.cookies.set({
    name: GOOGLE_CALENDAR_OAUTH_BROWSER_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH,
    maxAge: 0,
  });
  return response;
}

function safeErrorCode(error: unknown): SafeResultCode {
  if (!(error instanceof GoogleCalendarServiceError)) return "error";
  if (error.code === "reconnect_required" || error.code === "refresh_token_missing") {
    return "reconnect";
  }
  if (error.code === "wrong_account") return "wrong-account";
  if (error.code === "authorization_cancelled") return "denied";
  return "error";
}

function readBrowserBinding(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const prefix = `${GOOGLE_CALENDAR_OAUTH_BROWSER_COOKIE_NAME}=`;
  const matches = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix))
    .map((part) => part.slice(prefix.length));
  if (matches.length !== 1) return null;
  const value = matches[0];
  return isGoogleCalendarOAuthBrowserBinding(value) ? value : null;
}

async function completeOAuthCallback(
  input: Readonly<{
    stateToken: string;
    browserBinding: string;
    code?: string;
    providerError?: string;
  }>,
): Promise<Readonly<{ status: "connected" | "needs_selection" }>> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("Google Calendar is unavailable");
  const config = loadGoogleCalendarServerConfig();
  const result = await createGoogleCalendarService({
    repository: createGoogleCalendarRepository(createDb(dbUrl)),
    provider: createGoogleCalendarProvider({ config }),
    config,
  }).completeOAuth(input);
  return { status: result.status };
}

export async function GET(request: Request): Promise<Response> {
  // Fail before state or database work while the capability is unavailable.
  if (!isGoogleCalendarServerConfigured()) {
    return privateResponse("Not found", 404);
  }

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

  const browserBinding = readBrowserBinding(request);
  if (!browserBinding) return calendarRedirect("error");

  try {
    const result = await completeOAuthCallback({
      stateToken: state.value,
      browserBinding,
      ...(code.value !== undefined ? { code: code.value } : {}),
      ...(providerError.value !== undefined ? { providerError: providerError.value } : {}),
    });
    return calendarRedirect(result.status === "needs_selection" ? "selection" : "connected");
  } catch (error) {
    return calendarRedirect(safeErrorCode(error));
  }
}
