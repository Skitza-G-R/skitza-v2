import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import { requireActiveAdminAccess } from "~/server/auth/access";
import {
  privateAdminResponseHeaders,
} from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  adminDataErrorResponse,
  operationKeyFromRequest,
} from "~/server/data-foundation/http";
import { resolveAdminEnvironment } from "~/server/environment";
import { resolveAdminClerkEnvironment } from "~/server/registered-users/clerk-environment";
import {
  createClerkReconciliationProvider,
  createRegisteredAccountReconciliationRepository,
  reconcileRegisteredAccounts,
  RegisteredAccountReconciliationError,
} from "~/server/registered-users/reconciliation";

export async function POST(request: Request) {
  try {
    const identity = await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: privateAdminResponseHeaders() },
      );
    }
    const selected = new URL(request.url).searchParams.get("environment");
    const cursor = new URL(request.url).searchParams.get("cursor");
    const resolved = resolveAdminEnvironment(
      process.env,
      selected ?? undefined,
    );
    const clerk = resolveAdminClerkEnvironment(
      process.env,
      resolved.publicContext.id,
    );
    const result = await reconcileRegisteredAccounts({
      actorClerkUserId: identity.userId,
      clerkInstanceId: clerk.instanceId,
      cursor,
      environment: resolved.publicContext.id,
      operationKey: operationKeyFromRequest(request),
      provider: createClerkReconciliationProvider(clerk.secretKey),
      repository: createRegisteredAccountReconciliationRepository(
        createDb(resolved.databaseUrl),
        resolved.publicContext.id,
      ),
    });

    return NextResponse.json(result, {
      headers: privateAdminResponseHeaders(),
    });
  } catch (error) {
    if (error instanceof RegisteredAccountReconciliationError) {
      return NextResponse.json(
        {
          error:
            error.code === "INVALID_REQUEST"
              ? "invalid_request"
              : "reconciliation_unavailable",
        },
        {
          status: error.code === "INVALID_REQUEST" ? 400 : 503,
          headers: privateAdminResponseHeaders(),
        },
      );
    }
    return adminDataErrorResponse(error);
  }
}
