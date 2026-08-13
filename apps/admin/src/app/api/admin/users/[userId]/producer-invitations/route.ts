import {
  createClerkIdentityBindingRepository,
  resolveActiveProviderClerkUserId,
  withNeonSessionAdvisoryLock,
} from "@skitza/db";
import { NextResponse } from "next/server";

import { isValidRegisteredUserId } from "~/features/registered-users/view-model";
import { requireActiveAdminAccess } from "~/server/auth/access";
import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { adminDataErrorResponse, operationKeyFromRequest } from "~/server/data-foundation/http";
import { resolveAdminEnvironment } from "~/server/environment";
import {
  resolveAdminClerkEnvironment,
  resolveAdminWebAppUrl,
} from "~/server/registered-users/clerk-environment";
import {
  createClerkProducerInvitationProvider,
  ProducerInvitationError,
  sendProducerInvitation,
} from "~/server/registered-users/producer-invitations";
import { createRegisteredUserRepository } from "~/server/registered-users/repository";

function producerInvitationErrorResponse(error: ProducerInvitationError): NextResponse {
  if (error.code === "INVALID_REQUEST") {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateAdminResponseHeaders() },
    );
  }
  if (error.code === "TARGET_NOT_ELIGIBLE") {
    return NextResponse.json(
      { error: "target_not_eligible" },
      { status: 409, headers: privateAdminResponseHeaders() },
    );
  }
  return NextResponse.json(
    { error: "producer_invitation_unavailable" },
    { status: 503, headers: privateAdminResponseHeaders() },
  );
}

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: privateAdminResponseHeaders() },
      );
    }

    const selected = new URL(request.url).searchParams.get("environment");
    const resolved = resolveAdminEnvironment(process.env, selected ?? undefined);
    const clerk = resolveAdminClerkEnvironment(process.env, resolved.publicContext.id);
    const webAppUrl = resolveAdminWebAppUrl(process.env, resolved.publicContext.id);
    const operationKey = operationKeyFromRequest(request);
    const { userId } = await context.params;
    if (!isValidRegisteredUserId(userId)) {
      throw new ProducerInvitationError("INVALID_REQUEST");
    }

    const result = await withNeonSessionAdvisoryLock(
      resolved.databaseUrl,
      `admin:producer-invitation:${resolved.publicContext.id}:${userId}`,
      async (db) => {
        const repository = createRegisteredUserRepository(db, resolved.publicContext.id);
        const target = await repository.findProfileHeader(userId);
        if (
          !target ||
          target.status === "Deleted" ||
          target.status === "Restricted" ||
          !target.roles.includes("Artist") ||
          target.roles.includes("Producer")
        ) {
          throw new ProducerInvitationError("TARGET_NOT_ELIGIBLE");
        }

        const provider = createClerkProducerInvitationProvider(clerk.secretKey);
        let targetProviderClerkUserId: string;
        try {
          targetProviderClerkUserId = await resolveActiveProviderClerkUserId(
            createClerkIdentityBindingRepository(db),
            {
              canonicalClerkUserId: userId,
              clerkInstanceId: clerk.instanceId,
            },
          );
        } catch {
          throw new ProducerInvitationError("UNAVAILABLE");
        }
        return sendProducerInvitation({
          clerkInstanceId: clerk.instanceId,
          operationKey,
          provider,
          redirectUrl: new URL("/sign-up", webAppUrl).toString(),
          targetClerkUserId: userId,
          targetProviderClerkUserId,
        });
      },
    );

    return NextResponse.json(result, {
      status: result.reused ? 200 : 201,
      headers: privateAdminResponseHeaders(),
    });
  } catch (error) {
    if (error instanceof ProducerInvitationError) {
      return producerInvitationErrorResponse(error);
    }
    return adminDataErrorResponse(error);
  }
}
