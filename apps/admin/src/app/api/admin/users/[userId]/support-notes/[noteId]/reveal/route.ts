import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";

import { requireActiveAdminAccess } from "~/server/auth/access";
import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  adminDataErrorResponse,
  exactJsonObject,
  forbiddenAdminMutationResponse,
  operationKeyFromRequest,
  requiredBodyString,
} from "~/server/data-foundation/http";
import type { SensitiveRevealReason } from "~/server/data-foundation/service";
import { resolveAdminEnvironment } from "~/server/environment";
import {
  createRegisteredUserSensitiveRevealService,
  RegisteredUserRevealError,
} from "~/server/registered-users/sensitive-reveal";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ noteId: string; userId: string }>;
  },
) {
  try {
    const identity = await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return forbiddenAdminMutationResponse();
    }
    const { noteId, userId } = await context.params;
    const resolved = resolveAdminEnvironment(process.env);
    const environment = resolved.publicContext.id;
    const body = await exactJsonObject(request, ["reason"]);
    const reason = requiredBodyString(body, "reason");
    if (reason !== "safety_issue" && reason !== "support_investigation") {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers: privateAdminResponseHeaders() },
      );
    }
    const result = await createRegisteredUserSensitiveRevealService({
      database: createDb(resolved.databaseUrl),
      environment,
    }).revealSupportNote({
      actorClerkUserId: identity.userId,
      clerkUserId: userId,
      noteId,
      operationKey: operationKeyFromRequest(request),
      reason: reason as SensitiveRevealReason,
    });

    return NextResponse.json(result, {
      headers: privateAdminResponseHeaders(),
    });
  } catch (error) {
    if (error instanceof RegisteredUserRevealError) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: privateAdminResponseHeaders() },
      );
    }
    return adminDataErrorResponse(error);
  }
}
