import { NextResponse } from "next/server";

import { AdminAccessError } from "./access";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;

export function adminApiErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof AdminAccessError)) {
    return NextResponse.json(
      { error: "admin_unavailable" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }

  switch (error.reason) {
    case "signed-out":
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    case "founder-role-required":
    case "impersonated-session":
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    case "mfa-enrollment-required":
      return NextResponse.json(
        { error: "mfa_enrollment_required" },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    case "second-factor-required":
      return NextResponse.json(
        { error: "mfa_verification_required" },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    case "activity-lock-required":
      return NextResponse.json(
        { error: "admin_session_locked" },
        { status: 423, headers: PRIVATE_HEADERS },
      );
    case "configuration-invalid":
      return NextResponse.json(
        { error: "admin_unavailable" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
  }
}

export function privateAdminResponseHeaders(): HeadersInit {
  return PRIVATE_HEADERS;
}
