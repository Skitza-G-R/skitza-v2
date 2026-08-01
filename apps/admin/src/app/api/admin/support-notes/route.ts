import { NextResponse } from "next/server";

import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { requireActiveAdminAccess } from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  adminDataErrorResponse,
  exactJsonObject,
  forbiddenAdminMutationResponse,
  operationKeyFromRequest,
  requiredBodyString,
  runtimeForRequest,
} from "~/server/data-foundation/http";

export async function POST(request: Request) {
  try {
    const identity = await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return forbiddenAdminMutationResponse();
    }

    const { environment, foundation } = runtimeForRequest(request);
    const body = await exactJsonObject(request, ["body", "targetId", "targetType"]);
    const result = await foundation.addSupportNote({
      actorClerkUserId: identity.userId,
      body: requiredBodyString(body, "body"),
      environment,
      operationKey: operationKeyFromRequest(request),
      targetId: requiredBodyString(body, "targetId"),
      targetType: requiredBodyString(body, "targetType"),
    });

    return NextResponse.json(
      { id: result.id, replayed: result.replayed },
      {
        status: result.replayed ? 200 : 201,
        headers: privateAdminResponseHeaders(),
      },
    );
  } catch (error) {
    return adminDataErrorResponse(error);
  }
}
