import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";

import type { InvitationEmailSender } from "./invitation-email";

export const SKITZA_PRODUCER_INVITATION_METADATA_KEY = "skitzaProducerInvitation" as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const INVITATION_PAGE_LIMIT = 100;

export type ProducerInvitationStatus = "accepted" | "expired" | "pending" | "revoked";

export type ProducerInvitationProviderUser = Readonly<{
  banned: boolean;
  emailAddresses: readonly Readonly<{
    emailAddress: string;
    id: string;
    verificationStatus: string | null;
  }>[];
  id: string;
  locked: boolean;
  primaryEmailAddressId: string | null;
}>;

export type ProducerInvitationProviderRecord = Readonly<{
  emailAddress: string;
  id: string;
  publicMetadata: Readonly<Record<string, unknown>> | null;
  status: ProducerInvitationStatus;
  /** Clerk only guarantees this on the create response. */
  url: string | null;
}>;

export type ProducerInvitationResult = Readonly<{
  emailed: boolean;
  invitationId: string;
  reused: boolean;
  status: "accepted" | "pending";
}>;

export interface ProducerInvitationProvider {
  createInvitation(
    input: Readonly<{
      emailAddress: string;
      expiresInDays: 7;
      ignoreExisting: true;
      // We send the invitation ourselves — see ./invitation-email.
      notify: false;
      redirectUrl: string;
      publicMetadata: Readonly<{
        [SKITZA_PRODUCER_INVITATION_METADATA_KEY]: true;
      }>;
    }>,
  ): Promise<ProducerInvitationProviderRecord>;
  getInstanceId(): Promise<string>;
  getUser(userId: string): Promise<ProducerInvitationProviderUser | null>;
  listInvitations(
    input: Readonly<{
      emailAddress: string;
      limit: typeof INVITATION_PAGE_LIMIT;
    }>,
  ): Promise<readonly ProducerInvitationProviderRecord[]>;
}

export type ProducerInvitationErrorCode = "INVALID_REQUEST" | "TARGET_NOT_ELIGIBLE" | "UNAVAILABLE";

export class ProducerInvitationError extends Error {
  constructor(readonly code: ProducerInvitationErrorCode) {
    super("PRODUCER_INVITATION_FAILED");
    this.name = "ProducerInvitationError";
  }
}

function stop(code: ProducerInvitationErrorCode): never {
  throw new ProducerInvitationError(code);
}

function requiredIdentifier(value: string): string {
  return IDENTIFIER_PATTERN.test(value) ? value : stop("INVALID_REQUEST");
}

function providerIdentifier(value: string): string {
  return IDENTIFIER_PATTERN.test(value) ? value : stop("UNAVAILABLE");
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > 320 ||
    email.includes("\u0000") ||
    !EMAIL_PATTERN.test(email)
  ) {
    return stop("UNAVAILABLE");
  }
  return email;
}

function requestedEmail(value: string): string {
  try {
    return normalizedEmail(value);
  } catch {
    return stop("INVALID_REQUEST");
  }
}

function invitationAcceptUrl(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > 2000) return null;
  let acceptUrl: URL;
  try {
    acceptUrl = new URL(value);
  } catch {
    return null;
  }
  if (acceptUrl.protocol !== "https:" || acceptUrl.username || acceptUrl.password) {
    return null;
  }
  return acceptUrl.toString();
}

function invitationRedirect(value: string): string {
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(value);
  } catch {
    return stop("INVALID_REQUEST");
  }
  if (
    redirectUrl.protocol !== "https:" ||
    redirectUrl.username ||
    redirectUrl.password ||
    redirectUrl.search ||
    redirectUrl.hash ||
    redirectUrl.pathname !== "/sign-up"
  ) {
    return stop("INVALID_REQUEST");
  }
  return redirectUrl.toString();
}

function exactVerifiedPrimaryEmail(user: ProducerInvitationProviderUser): string {
  if (user.banned || user.locked || !user.primaryEmailAddressId) {
    return stop("TARGET_NOT_ELIGIBLE");
  }
  const primary = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  if (!primary || primary.verificationStatus !== "verified") {
    return stop("TARGET_NOT_ELIGIBLE");
  }
  return normalizedEmail(primary.emailAddress);
}

function isMarkedInvitation(invitation: ProducerInvitationProviderRecord): boolean {
  return invitation.publicMetadata?.[SKITZA_PRODUCER_INVITATION_METADATA_KEY] === true;
}

function validateInvitation(
  invitation: ProducerInvitationProviderRecord,
): ProducerInvitationProviderRecord {
  providerIdentifier(invitation.id);
  normalizedEmail(invitation.emailAddress);
  if (
    !["accepted", "expired", "pending", "revoked"].includes(invitation.status) ||
    (invitation.publicMetadata !== null &&
      (typeof invitation.publicMetadata !== "object" || Array.isArray(invitation.publicMetadata)))
  ) {
    return stop("UNAVAILABLE");
  }
  return invitation;
}

async function createOrReuseMarkedInvitation(
  input: Readonly<{
    emailAddress: string;
    provider: ProducerInvitationProvider;
    redirectUrl: string;
  }>,
): Promise<
  Readonly<{
    /** null when the invitee already accepted — nothing left to send. */
    acceptUrl: string | null;
    invitationId: string;
    reused: boolean;
    status: "accepted" | "pending";
  }>
> {
  const candidates = await input.provider.listInvitations({
    emailAddress: input.emailAddress,
    limit: INVITATION_PAGE_LIMIT,
  });
  if (candidates.length > INVITATION_PAGE_LIMIT) return stop("UNAVAILABLE");

  for (const rawCandidate of candidates) {
    const candidate = validateInvitation(rawCandidate);
    if (
      normalizedEmail(candidate.emailAddress) !== input.emailAddress ||
      !isMarkedInvitation(candidate)
    ) {
      continue;
    }
    if (candidate.status === "accepted") {
      return {
        acceptUrl: null,
        invitationId: candidate.id,
        reused: true,
        status: "accepted",
      };
    }
    if (candidate.status === "pending") {
      // Clerk documents `url` as optional and only guarantees it on the
      // create response. A pending invitation we cannot read a link off is
      // useless to us now that we send the mail ourselves, so fall through
      // and mint one we can address. `ignoreExisting` permits the duplicate.
      const acceptUrl = invitationAcceptUrl(candidate.url);
      if (acceptUrl !== null) {
        return {
          acceptUrl,
          invitationId: candidate.id,
          reused: true,
          status: "pending",
        };
      }
    }
  }

  const created = validateInvitation(
    await input.provider.createInvitation({
      emailAddress: input.emailAddress,
      expiresInDays: 7,
      ignoreExisting: true,
      notify: false,
      redirectUrl: input.redirectUrl,
      publicMetadata: {
        [SKITZA_PRODUCER_INVITATION_METADATA_KEY]: true,
      },
    }),
  );
  const createdAcceptUrl = invitationAcceptUrl(created.url);
  if (
    normalizedEmail(created.emailAddress) !== input.emailAddress ||
    !isMarkedInvitation(created) ||
    (created.status !== "pending" && created.status !== "accepted") ||
    // With `notify: false` nobody else will deliver this link. A pending
    // invitation without one would strand the invitee silently.
    (created.status === "pending" && createdAcceptUrl === null)
  ) {
    return stop("UNAVAILABLE");
  }
  return {
    acceptUrl: created.status === "accepted" ? null : createdAcceptUrl,
    invitationId: created.id,
    reused: false,
    status: created.status,
  };
}

/**
 * Delivers the accept link unless the invitee already accepted. Any send
 * failure surfaces as UNAVAILABLE so the caller reports the row as failed
 * and can retry — the retry reuses the pending invitation it just made.
 */
async function deliverInvitation(
  input: Readonly<{
    emailAddress: string;
    emailSender: InvitationEmailSender;
    outcome: Readonly<{
      acceptUrl: string | null;
      invitationId: string;
      reused: boolean;
      status: "accepted" | "pending";
    }>;
  }>,
): Promise<ProducerInvitationResult> {
  if (input.outcome.acceptUrl !== null) {
    await input.emailSender.send({
      acceptUrl: input.outcome.acceptUrl,
      to: input.emailAddress,
    });
  }
  return {
    emailed: input.outcome.acceptUrl !== null,
    invitationId: input.outcome.invitationId,
    reused: input.outcome.reused,
    status: input.outcome.status,
  };
}

export function createClerkProducerInvitationProvider(
  secretKey: string,
): ProducerInvitationProvider {
  const clerk = createClerkClient({ secretKey });
  return {
    async createInvitation(input) {
      const created = await clerk.invitations.createInvitation(input);
      return {
        emailAddress: created.emailAddress,
        id: created.id,
        publicMetadata: created.publicMetadata,
        status: created.status,
        url: created.url ?? null,
      };
    },
    async getInstanceId() {
      const instance = await clerk.instance.get();
      return instance.id;
    },
    async getUser(userId) {
      try {
        const user = await clerk.users.getUser(userId);
        return {
          banned: user.banned,
          emailAddresses: user.emailAddresses.map((email) => ({
            emailAddress: email.emailAddress,
            id: email.id,
            verificationStatus: email.verification?.status ?? null,
          })),
          id: user.id,
          locked: user.locked,
          primaryEmailAddressId: user.primaryEmailAddressId,
        };
      } catch (error) {
        if (isClerkAPIResponseError(error) && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    async listInvitations(input) {
      const page = await clerk.invitations.getInvitationList({
        limit: input.limit,
        orderBy: "-created_at",
        query: input.emailAddress,
      });
      return page.data.map((candidate) => ({
        emailAddress: candidate.emailAddress,
        id: candidate.id,
        publicMetadata: candidate.publicMetadata,
        status: candidate.status,
        url: candidate.url ?? null,
      }));
    },
  };
}

export async function sendProducerInvitation(
  input: Readonly<{
    clerkInstanceId: string;
    emailSender: InvitationEmailSender;
    operationKey: string;
    provider: ProducerInvitationProvider;
    redirectUrl: string;
    targetClerkUserId: string;
    targetProviderClerkUserId: string;
  }>,
): Promise<ProducerInvitationResult> {
  const clerkInstanceId = requiredIdentifier(input.clerkInstanceId);
  requiredIdentifier(input.targetClerkUserId);
  const targetProviderClerkUserId = requiredIdentifier(input.targetProviderClerkUserId);
  requiredIdentifier(input.operationKey);
  const redirectUrl = invitationRedirect(input.redirectUrl);

  try {
    const actualInstanceId = await input.provider.getInstanceId();
    if (actualInstanceId !== clerkInstanceId) return stop("UNAVAILABLE");

    const user = await input.provider.getUser(targetProviderClerkUserId);
    if (!user) return stop("TARGET_NOT_ELIGIBLE");
    if (user.id !== targetProviderClerkUserId) return stop("UNAVAILABLE");
    const emailAddress = exactVerifiedPrimaryEmail(user);

    return await deliverInvitation({
      emailAddress,
      emailSender: input.emailSender,
      outcome: await createOrReuseMarkedInvitation({
        emailAddress,
        provider: input.provider,
        redirectUrl,
      }),
    });
  } catch (error) {
    if (error instanceof ProducerInvitationError) throw error;
    throw new ProducerInvitationError("UNAVAILABLE");
  }
}

/**
 * Sends the same server-marked Producer invitation to an email that may not
 * have a Clerk account yet. This is the safe founder entry for brand-new
 * Producers; direct Clerk Dashboard invitations cannot carry our marker.
 */
export async function sendProducerInvitationToEmail(
  input: Readonly<{
    clerkInstanceId: string;
    emailAddress: string;
    emailSender: InvitationEmailSender;
    operationKey: string;
    provider: ProducerInvitationProvider;
    redirectUrl: string;
  }>,
): Promise<ProducerInvitationResult> {
  const clerkInstanceId = requiredIdentifier(input.clerkInstanceId);
  requiredIdentifier(input.operationKey);
  const emailAddress = requestedEmail(input.emailAddress);
  const redirectUrl = invitationRedirect(input.redirectUrl);

  try {
    const actualInstanceId = await input.provider.getInstanceId();
    if (actualInstanceId !== clerkInstanceId) return stop("UNAVAILABLE");

    return await deliverInvitation({
      emailAddress,
      emailSender: input.emailSender,
      outcome: await createOrReuseMarkedInvitation({
        emailAddress,
        provider: input.provider,
        redirectUrl,
      }),
    });
  } catch (error) {
    if (error instanceof ProducerInvitationError) throw error;
    throw new ProducerInvitationError("UNAVAILABLE");
  }
}
