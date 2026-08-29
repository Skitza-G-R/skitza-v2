import { NextResponse } from "next/server";

import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import { requireActiveAdminAccess } from "~/server/auth/access";
import { resolveAdminEnvironment } from "~/server/environment";

export async function GET() {
  try {
    await requireActiveAdminAccess();
  } catch (error) {
    return adminApiErrorResponse(error);
  }


  try {
    const resolved = resolveAdminEnvironment(process.env);
    return NextResponse.json(
      {
        authorized: true,
        environment: resolved.publicContext,
      },
      { headers: privateAdminResponseHeaders() },
    );
  } catch {
    // SK-288 — there is no environment to get wrong any more, so the only
    // way this throws is a missing or malformed live binding.
    return NextResponse.json(
      { error: "admin_unavailable" },
      { status: 503, headers: privateAdminResponseHeaders() },
    );
  }
}
