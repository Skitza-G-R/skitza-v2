import { NextResponse } from "next/server";

import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import {
  refreshAdminActivity,
  requireActiveAdminAccess,
} from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";

export async function POST(request: Request) {
  try {
    const identity = await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: privateAdminResponseHeaders() },
      );
    }

    await refreshAdminActivity(identity);
    return new NextResponse(null, {
      status: 204,
      headers: privateAdminResponseHeaders(),
    });
  } catch (error) {
    return adminApiErrorResponse(error);
  }
}
