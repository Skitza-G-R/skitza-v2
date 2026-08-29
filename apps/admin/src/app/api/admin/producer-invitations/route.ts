import { createHash } from "node:crypto";

import { withNeonSessionAdvisoryLock } from "@skitza/db";
import { NextResponse } from "next/server";

import { requireActiveAdminAccess } from "~/server/auth/access";
import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import {
  adminDataErrorResponse,
  exactJsonObject,
  operationKeyFromRequest,
  requiredBodyString,
} from "~/server/data-foundation/http";
import { resolveAdminEnvironment } from "~/server/environment";
import {
  resolveAdminClerkEnvironment,
  resolveAdminWebAppUrl,
} from "~/server/registered-users/clerk-environment";
import {
  createResendInvitationEmailSender,
  resolveAdminInvitationEmailConfig,
} from "~/server/registered-users/invitation-email";
import {
  createClerkProducerInvitationProvider,
  ProducerInvitationError,
  sendProducerInvitationToEmail,
} from "~/server/registered-users/producer-invitations";

function failure(error: ProducerInvitationError): NextResponse {
  if (error.code === "INVALID_REQUEST") {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateAdminResponseHeaders() },
    );
  }
  return NextResponse.json(
    { error: "producer_invitation_unavailable" },
    { status: 503, headers: privateAdminResponseHeaders() },
  );
}

export async function POST(request: Request) {
  try {
    await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: privateAdminResponseHeaders() },
      );
    }

    const operationKey = operationKeyFromRequest(request);
    const body = await exactJsonObject(request, ["emailAddress"]);
    const emailAddress = requiredBodyString(body, "emailAddress");
    const resolved = resolveAdminEnvironment(process.env);
    const clerk = resolveAdminClerkEnvironment(process.env);
    const webAppUrl = resolveAdminWebAppUrl(process.env);
    const emailSender = createResendInvitationEmailSender(
      resolveAdminInvitationEmailConfig(process.env),
    );
    const emailLock = createHash("sha256").update(emailAddress.trim().toLowerCase()).digest("hex");

    const result = await withNeonSessionAdvisoryLock(
      resolved.databaseUrl,
      `admin:producer-invitation-email:${resolved.publicContext.id}:${emailLock}`,
      async () =>
        sendProducerInvitationToEmail({
          clerkInstanceId: clerk.instanceId,
          emailAddress,
          emailSender,
          operationKey,
          provider: createClerkProducerInvitationProvider(clerk.secretKey),
          redirectUrl: new URL("/sign-up", webAppUrl).toString(),
        }),
    );

    return NextResponse.json(result, {
      status: result.reused ? 200 : 201,
      headers: privateAdminResponseHeaders(),
    });
  } catch (error) {
    if (error instanceof ProducerInvitationError) return failure(error);
    return adminDataErrorResponse(error);
  }
}
