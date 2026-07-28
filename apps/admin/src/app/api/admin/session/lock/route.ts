import { NextResponse } from "next/server";

import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import {
  lockAdminActivityIfInactive,
  requireFounderRole,
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
    const identity = await requireFounderRole();
    const decision = await lockAdminActivityIfInactive(identity.sessionId);
    if (!decision.locked) {
      return NextResponse.json(
        { locked: false, retryAfterMs: decision.retryAfterMs },
        { status: 409, headers: privateAdminResponseHeaders() },
      );
    }
    return new NextResponse(null, {
      status: 204,
      headers: privateAdminResponseHeaders(),
    });
  } catch (error) {
    return adminApiErrorResponse(error);
  }
}
