import { NextResponse } from "next/server";

import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { requireActiveAdminAccess } from "~/server/auth/access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  adminDataErrorResponse,
  forbiddenAdminMutationResponse,
  runtimeForRequest,
} from "~/server/data-foundation/http";

export async function POST(request: Request) {
  try {
    await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return forbiddenAdminMutationResponse();
    }

    const { environment, foundation } = runtimeForRequest();
    const deleted = await foundation.purgeExpiredAdminHistory(environment);
    return NextResponse.json({ deleted }, { headers: privateAdminResponseHeaders() });
  } catch (error) {
    return adminDataErrorResponse(error);
  }
}
