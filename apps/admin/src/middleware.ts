import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";

import {
  resolveAdminAccessMode,
  type AdminAccessMode,
} from "./server/auth/access-mode";
import { verifyCloudflareAccessHeaders } from "./server/auth/cloudflare-access";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

type VerifiedAccessContinuation = () =>
  ReturnType<NextMiddleware>;
type AccessHeaderVerifier = (
  headers: Headers,
) => Promise<unknown>;

export type ClerkRouteProtector = Readonly<{
  protect(options: {
    unauthenticatedUrl: string;
  }): unknown;
}>;

function accessDeniedResponse(): NextResponse {
  return NextResponse.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: PRIVATE_NO_STORE_HEADERS,
    },
  );
}

function isPostAccessException(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname.startsWith("/sign-in/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

/**
 * Runs only after Cloudflare Access has been verified by the outer middleware.
 * Clerk sign-in stays reachable and APIs continue to their server-side founder
 * authorization; every other page requires a primary Clerk session.
 */
export async function protectVerifiedAccessRoute(
  auth: ClerkRouteProtector,
  request: NextRequest,
): Promise<void> {
  if (isPostAccessException(request.nextUrl.pathname)) return;

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set(
    "redirect_url",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
}

/**
 * Testable outer seam: in cloudflare-access mode no route classification or
 * Clerk work occurs until the Cloudflare assertion and canonical host have
 * both been verified. In vercel-protection mode (SK-274) the outer wall is
 * Vercel Deployment Protection, so the request continues straight to Clerk.
 * Unknown or broken mode configuration fails closed.
 */
export async function handleAdminMiddleware(
  request: NextRequest,
  continueWithClerk: VerifiedAccessContinuation,
  verifyAccess: AccessHeaderVerifier = verifyCloudflareAccessHeaders,
  resolveMode: () => AdminAccessMode = resolveAdminAccessMode,
): Promise<Awaited<ReturnType<NextMiddleware>>> {
  let mode: AdminAccessMode;
  try {
    mode = resolveMode();
  } catch {
    return accessDeniedResponse();
  }

  if (mode === "cloudflare-access") {
    try {
      await verifyAccess(request.headers);
    } catch {
      return accessDeniedResponse();
    }
  }

  return continueWithClerk();
}

const clerkAuthenticationMiddleware = clerkMiddleware(
  protectVerifiedAccessRoute,
);

export default function adminMiddleware(
  request: NextRequest,
  event: NextFetchEvent,
): Promise<Awaited<ReturnType<NextMiddleware>>> {
  return handleAdminMiddleware(request, () =>
    clerkAuthenticationMiddleware(request, event),
  );
}

export const config = {
  matcher: [
    "/((?!_next/static(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$).*)",
  ],
};
