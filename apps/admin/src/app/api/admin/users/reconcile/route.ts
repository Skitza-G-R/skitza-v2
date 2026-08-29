import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import { requireActiveAdminAccess } from "~/server/auth/access";
import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { adminDataErrorResponse, operationKeyFromRequest } from "~/server/data-foundation/http";
import { resolveAdminEnvironment } from "~/server/environment";
import { resolveAdminClerkEnvironment } from "~/server/registered-users/clerk-environment";
import {
  createClerkReconciliationProvider,
  createRegisteredAccountReconciliationRepository,
  createRegisteredAccountReconciliationIdentityResolver,
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
    const cursor = new URL(request.url).searchParams.get("cursor");
    const resolved = resolveAdminEnvironment(process.env);
    const clerk = resolveAdminClerkEnvironment(process.env);
    const database = createDb(resolved.databaseUrl);
    const result = await reconcileRegisteredAccounts({
      actorClerkUserId: identity.userId,
      clerkInstanceId: clerk.instanceId,
      cursor,
      environment: resolved.publicContext.id,
      operationKey: operationKeyFromRequest(request),
      provider: createClerkReconciliationProvider(clerk.secretKey),
      identityResolver: createRegisteredAccountReconciliationIdentityResolver(database),
      repository: createRegisteredAccountReconciliationRepository(
        database,
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
            error.code === "INVALID_REQUEST" ? "invalid_request" : "reconciliation_unavailable",
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
