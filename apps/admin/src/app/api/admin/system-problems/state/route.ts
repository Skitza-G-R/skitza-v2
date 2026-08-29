import { NextResponse } from "next/server";

import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { requireActiveAdminAccess } from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  adminDataErrorResponse,
  exactJsonObject,
  forbiddenAdminMutationResponse,
  nullableBodyString,
  operationKeyFromRequest,
  requiredBodyString,
  runtimeForRequest,
} from "~/server/data-foundation/http";
import type { AdminSystemProblemState } from "~/server/data-foundation/service";

export async function POST(request: Request) {
  try {
    const identity = await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return forbiddenAdminMutationResponse();
    }

    const { environment, foundation } = runtimeForRequest();
    const body = await exactJsonObject(request, ["privateNote", "problemId", "state"]);
    const privateNote = nullableBodyString(body, "privateNote");
    const result = await foundation.transitionSystemProblem({
      actorClerkUserId: identity.userId,
      environment,
      operationKey: operationKeyFromRequest(request),
      ...(privateNote === undefined ? {} : { privateNote }),
      problemId: requiredBodyString(body, "problemId"),
      state: requiredBodyString(body, "state") as AdminSystemProblemState,
    });

    return NextResponse.json(
      {
        id: result.id,
        replayed: result.replayed,
        state: result.state,
      },
      {
        status: result.replayed ? 200 : 201,
        headers: privateAdminResponseHeaders(),
      },
    );
  } catch (error) {
    return adminDataErrorResponse(error);
  }
}
