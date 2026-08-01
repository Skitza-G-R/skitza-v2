import { NextResponse } from "next/server";

import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import {
  beginAdminReauthentication,
  lockAdminActivityIfInactive,
  requireFounderRole,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";

export async function POST(request: Request) {
  try {
    const identity = await requireFounderRole();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: privateAdminResponseHeaders() },
      );
    }

    const decision = await lockAdminActivityIfInactive(identity);
    if (!decision.locked) {
      return NextResponse.json(
        { locked: false, retryAfterMs: decision.retryAfterMs },
        { status: 409, headers: privateAdminResponseHeaders() },
      );
    }
    await beginAdminReauthentication(identity);
    return new NextResponse(null, {
      status: 204,
      headers: privateAdminResponseHeaders(),
    });
  } catch (error) {
    return adminApiErrorResponse(error);
  }
}
