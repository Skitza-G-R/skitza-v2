import { reverificationErrorResponse } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import {
  refreshAdminActivity,
  requireFounderWithMfaEnrollment,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: privateAdminResponseHeaders() },
    );
  }

  try {
    const identity = await requireFounderWithMfaEnrollment();
    if (!identity.hasRecentMultiFactorVerification) {
      const response = reverificationErrorResponse("strict_mfa");
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
      response.headers.set("Vary", "Cookie");
      return response;
    }

    await refreshAdminActivity(identity.sessionId);
    return NextResponse.json(
      { unlocked: true },
      { headers: privateAdminResponseHeaders() },
    );
  } catch (error) {
    return adminApiErrorResponse(error);
  }
}
