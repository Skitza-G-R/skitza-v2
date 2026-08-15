import { clerkClient } from "@clerk/nextjs/server";
import { createDb, resolveActiveProviderClerkUserIdWithDb } from "@skitza/db";
import { NextResponse } from "next/server";

import {
  DESKTOP_AUTH_CODE_LIFETIME_SECONDS,
  DESKTOP_AUTH_EXCHANGE_PATH,
  consumeDesktopAuthorizationCode,
  createConfiguredDesktopSocialAuthStore,
  trustedDesktopAuthOrigin,
} from "~/server/auth/desktop-social-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;
const MAX_BODY_BYTES = 1_024;
const MAX_TICKET_LENGTH = 4_096;

function jsonResponse(body: Readonly<Record<string, unknown>>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function isExactExchangeUrl(url: URL): boolean {
  const trustedOrigin = trustedDesktopAuthOrigin();
  return (
    trustedOrigin !== null &&
    url.origin === trustedOrigin &&
    url.protocol === "https:" &&
    url.pathname === DESKTOP_AUTH_EXCHANGE_PATH &&
    !url.search &&
    !url.hash
  );
}

async function readExchangeBody(
  request: Request,
): Promise<Readonly<{ code: string; codeVerifier: string }> | null> {
  const mediaType = (request.headers.get("Content-Type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return null;
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !== "code,codeVerifier" ||
      typeof record.code !== "string" ||
      typeof record.codeVerifier !== "string"
    ) {
      return null;
    }
    return { code: record.code, codeVerifier: record.codeVerifier };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isExactExchangeUrl(new URL(request.url))) {
    return jsonResponse({ error: "bad_request" }, 400);
  }
  const body = await readExchangeBody(request);
  if (!body) return jsonResponse({ error: "bad_request" }, 400);

  const clerkInstanceId = process.env.CLERK_INSTANCE_ID?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!clerkInstanceId || !databaseUrl) {
    return jsonResponse({ error: "unavailable" }, 503);
  }

  try {
    const consumed = await consumeDesktopAuthorizationCode({
      code: body.code,
      codeVerifier: body.codeVerifier,
      store: createConfiguredDesktopSocialAuthStore(),
    });
    if (!consumed) return jsonResponse({ error: "invalid_grant" }, 401);

    const providerUserId = await resolveActiveProviderClerkUserIdWithDb(createDb(databaseUrl), {
      canonicalClerkUserId: consumed.clerkUserId,
      clerkInstanceId,
    });

    const client = await clerkClient();
    const signInToken = await client.signInTokens.createSignInToken({
      userId: providerUserId,
      expiresInSeconds: DESKTOP_AUTH_CODE_LIFETIME_SECONDS,
    });
    if (
      typeof signInToken.token !== "string" ||
      signInToken.token.length < 1 ||
      signInToken.token.length > MAX_TICKET_LENGTH
    ) {
      return jsonResponse({ error: "unavailable" }, 503);
    }
    return jsonResponse({ protocolVersion: 1, ticket: signInToken.token }, 200);
  } catch {
    return jsonResponse({ error: "unavailable" }, 503);
  }
}
