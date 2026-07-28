import { NextResponse } from "next/server";

import {
  adminApiErrorResponse,
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import { requireActiveAdminAccess } from "~/server/auth/access";
import {
  AdminEnvironmentConfigurationError,
  resolveAdminEnvironment,
} from "~/server/environment";

export async function GET(request: Request) {
  try {
    await requireActiveAdminAccess();
  } catch (error) {
    return adminApiErrorResponse(error);
  }

  const selectedEnvironment = new URL(request.url).searchParams.get(
    "environment",
  );

  try {
    const resolved = resolveAdminEnvironment(
      process.env,
      selectedEnvironment ?? undefined,
    );
    return NextResponse.json(
      {
        authorized: true,
        environment: resolved.publicContext,
      },
      { headers: privateAdminResponseHeaders() },
    );
  } catch (error) {
    const status =
      error instanceof AdminEnvironmentConfigurationError &&
      error.code === "ADMIN_ENVIRONMENT_INVALID"
        ? 400
        : 503;
    return NextResponse.json(
      { error: status === 400 ? "invalid_environment" : "admin_unavailable" },
      { status, headers: privateAdminResponseHeaders() },
    );
  }
}
