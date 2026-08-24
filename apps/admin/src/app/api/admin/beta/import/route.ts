import { NextResponse } from "next/server";

import { requireActiveAdminAccess } from "~/server/auth/access";
import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  AdminDataHttpError,
  adminDataErrorResponse,
  exactJsonObject,
  forbiddenAdminMutationResponse,
  operationKeyFromRequest,
  requiredBodyString,
} from "~/server/data-foundation/http";
import { BETA_LIST_MAX_INPUT_LENGTH, parseBetaListInput } from "~/server/beta/model";
import { createBetaRuntime } from "~/server/beta/runtime";

// SK-273 — import pasted beta-list lines as `pending` invitees. Purely
// additive and idempotent: existing emails are skipped, nobody is emailed.
export async function POST(request: Request) {
  try {
    await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) return forbiddenAdminMutationResponse();
    operationKeyFromRequest(request);

    const body = await exactJsonObject(request, ["list"]);
    const list = requiredBodyString(body, "list");
    if (list.length === 0 || list.length > BETA_LIST_MAX_INPUT_LENGTH) {
      throw new AdminDataHttpError();
    }

    const selected = new URL(request.url).searchParams.get("environment");
    const runtime = createBetaRuntime(selected ?? undefined);
    const parsed = parseBetaListInput(list);
    const imported = await runtime.repository.importRows(parsed.rows, new Date());

    return NextResponse.json(
      {
        duplicates: parsed.duplicates,
        inserted: imported.inserted,
        invalidCount: parsed.invalidLines.length,
        invalidLines: parsed.invalidLines.slice(0, 20),
        skipped: imported.skipped,
      },
      { headers: privateAdminResponseHeaders() },
    );
  } catch (error) {
    return adminDataErrorResponse(error);
  }
}
