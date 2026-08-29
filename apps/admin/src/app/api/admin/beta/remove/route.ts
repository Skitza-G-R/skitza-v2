import { NextResponse } from "next/server";

import { requireActiveAdminAccess } from "~/server/auth/access";
import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { normalizedBetaEmail } from "~/server/beta/model";
import { createBetaRuntime } from "~/server/beta/runtime";
import {
  AdminDataHttpError,
  adminDataErrorResponse,
  exactJsonObject,
  forbiddenAdminMutationResponse,
  operationKeyFromRequest,
} from "~/server/data-foundation/http";

// SK-273 — remove one invitee. Only `pending` rows can go: once someone was
// invited their history stays, so nudges and stats keep meaning something.
export async function POST(request: Request) {
  try {
    await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) return forbiddenAdminMutationResponse();
    operationKeyFromRequest(request);

    const body = await exactJsonObject(request, ["emailAddress"]);
    if (typeof body.emailAddress !== "string") throw new AdminDataHttpError();
    const email = normalizedBetaEmail(body.emailAddress);
    if (email === null) throw new AdminDataHttpError();

    const runtime = createBetaRuntime();
    const removed = await runtime.repository.removePending(email);
    if (!removed) {
      return NextResponse.json(
        { error: "state_conflict" },
        { status: 409, headers: privateAdminResponseHeaders() },
      );
    }

    return NextResponse.json({ ok: true }, { headers: privateAdminResponseHeaders() });
  } catch (error) {
    return adminDataErrorResponse(error);
  }
}
