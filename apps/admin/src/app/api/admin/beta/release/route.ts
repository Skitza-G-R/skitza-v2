import { createHash } from "node:crypto";

import { withNeonSessionAdvisoryLock } from "@skitza/db";
import { NextResponse } from "next/server";

import { requireActiveAdminAccess } from "~/server/auth/access";
import { privateAdminResponseHeaders } from "~/server/auth/api-access";
import { isSameOriginMutation } from "~/server/auth/request-security";
import { normalizedBetaEmail, parsedBetaWave } from "~/server/beta/model";
import { createBetaRuntime } from "~/server/beta/runtime";
import {
  AdminDataHttpError,
  adminDataErrorResponse,
  exactJsonObject,
  forbiddenAdminMutationResponse,
  operationKeyFromRequest,
} from "~/server/data-foundation/http";
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

// SK-273 — release a beta wave (every `pending` invitee in the wave) or
// re-send a single invitee's invitation. Each email goes through the same
// marked-Clerk-invitation path and per-email advisory lock as the existing
// single producer-invitation route, so a pending unexpired invitation is
// reused instead of duplicated and double-clicks can't double-invite.
// Failures are reported per email; the wave button retries only those,
// because successes flip rows to `invited` and leave the pending set.

const MAX_RELEASE_BATCH = 200;

export async function POST(request: Request) {
  try {
    await requireActiveAdminAccess();
    if (!isSameOriginMutation(request)) return forbiddenAdminMutationResponse();
    const operationKey = operationKeyFromRequest(request);

    const body = await exactJsonObject(request, ["emailAddress", "wave"]);
    const waveProvided = body.wave !== undefined;
    const emailProvided = body.emailAddress !== undefined;
    if (waveProvided === emailProvided) throw new AdminDataHttpError();

    const selected = new URL(request.url).searchParams.get("environment");
    const runtime = createBetaRuntime(selected ?? undefined);

    let emails: readonly string[];
    if (waveProvided) {
      const wave = parsedBetaWave(body.wave);
      if (wave === null) throw new AdminDataHttpError();
      emails = await runtime.repository.listPendingEmailsInWave(wave);
    } else {
      if (typeof body.emailAddress !== "string") throw new AdminDataHttpError();
      const email = normalizedBetaEmail(body.emailAddress);
      if (email === null) throw new AdminDataHttpError();
      const row = await runtime.repository.findByEmail(email);
      if (row === null) throw new AdminDataHttpError();
      if (row.status !== "pending" && row.status !== "invited") {
        return NextResponse.json(
          { error: "state_conflict" },
          { status: 409, headers: privateAdminResponseHeaders() },
        );
      }
      emails = [email];
    }

    if (emails.length > MAX_RELEASE_BATCH) throw new AdminDataHttpError();
    if (emails.length === 0) {
      return NextResponse.json(
        { attempted: 0, failures: [], invited: 0 },
        { headers: privateAdminResponseHeaders() },
      );
    }

    const clerk = resolveAdminClerkEnvironment(process.env, runtime.environment);
    const webAppUrl = resolveAdminWebAppUrl(process.env, runtime.environment);
    const provider = createClerkProducerInvitationProvider(clerk.secretKey);
    const emailSender = createResendInvitationEmailSender(
      resolveAdminInvitationEmailConfig(process.env, runtime.environment),
    );
    const redirectUrl = new URL("/sign-up", webAppUrl).toString();

    let invited = 0;
    const failures: { code: string; email: string }[] = [];
    for (const [index, email] of emails.entries()) {
      const emailLock = createHash("sha256").update(email).digest("hex");
      try {
        await withNeonSessionAdvisoryLock(
          runtime.databaseUrl,
          `admin:producer-invitation-email:${runtime.environment}:${emailLock}`,
          async () =>
            sendProducerInvitationToEmail({
              clerkInstanceId: clerk.instanceId,
              emailAddress: email,
              emailSender,
              operationKey: `${operationKey}:${String(index)}`,
              provider,
              redirectUrl,
            }),
        );
        await runtime.repository.markInvited(email, new Date());
        invited += 1;
      } catch (error) {
        failures.push({
          code: error instanceof ProducerInvitationError ? error.code : "UNAVAILABLE",
          email,
        });
      }
    }

    return NextResponse.json(
      { attempted: emails.length, failures, invited },
      { headers: privateAdminResponseHeaders() },
    );
  } catch (error) {
    return adminDataErrorResponse(error);
  }
}
