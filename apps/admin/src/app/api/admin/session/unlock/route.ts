import { NextResponse } from "next/server";

import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import {
  requireFounderRole,
  unlockAdminSession,
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

    const decision = await unlockAdminSession(identity);
    if (!decision.unlocked) {
      return NextResponse.json(
        {
          error: "cloudflare_reauthentication_required",
          logoutPath: decision.logoutPath,
        },
        { status: 409, headers: privateAdminResponseHeaders() },
      );
    }

    return NextResponse.json(
      { unlocked: true },
      { headers: privateAdminResponseHeaders() },
    );
  } catch (error) {
    return adminApiErrorResponse(error);
  }
}
