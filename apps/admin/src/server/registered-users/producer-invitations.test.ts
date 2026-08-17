import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendProducerInvitation,
  sendProducerInvitationToEmail,
  SKITZA_PRODUCER_INVITATION_METADATA_KEY,
  ProducerInvitationError,
  type ProducerInvitationProvider,
} from "./producer-invitations";

const target = {
  banned: false,
  emailAddresses: [
    {
      emailAddress: " Artist@Example.com ",
      id: "email_primary",
      verificationStatus: "verified",
    },
  ],
  id: "user_artist",
  locked: false,
  primaryEmailAddressId: "email_primary",
} as const;

const invitation = {
  emailAddress: "artist@example.com",
  id: "inv_new",
  publicMetadata: {
    [SKITZA_PRODUCER_INVITATION_METADATA_KEY]: true,
  },
  status: "pending" as const,
};

const getInstanceId = vi.fn();
const getUser = vi.fn();
const listInvitations = vi.fn();
const createInvitation = vi.fn();
const provider: ProducerInvitationProvider = {
  createInvitation,
  getInstanceId,
  getUser,
  listInvitations,
};

function send(redirectUrl = "https://skitza-test.example/sign-up") {
  return sendProducerInvitation({
    clerkInstanceId: "ins_test",
    operationKey: "producer-invite:request-1",
    provider,
    redirectUrl,
    targetClerkUserId: "user_artist",
    targetProviderClerkUserId: "user_artist",
  });
}

function sendEmail(emailAddress = " New.Producer@Example.com ") {
  return sendProducerInvitationToEmail({
    clerkInstanceId: "ins_test",
    emailAddress,
    operationKey: "producer-invite-email:request-1",
    provider,
    redirectUrl: "https://skitza-test.example/sign-up",
  });
}

describe("founder Producer invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInstanceId.mockResolvedValue("ins_test");
    getUser.mockResolvedValue(target);
    listInvitations.mockResolvedValue([]);
    createInvitation.mockResolvedValue(invitation);
  });

  it("verifies the bound Clerk instance and sends one seven-day marked email invitation", async () => {
    await expect(send()).resolves.toEqual({
      invitationId: "inv_new",
      reused: false,
      status: "pending",
    });

    expect(getInstanceId).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledWith("user_artist");
    expect(listInvitations).toHaveBeenCalledWith({
      emailAddress: "artist@example.com",
      limit: 100,
    });
    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: "artist@example.com",
      expiresInDays: 7,
      ignoreExisting: true,
      notify: true,
      redirectUrl: "https://skitza-test.example/sign-up",
      publicMetadata: {
        skitzaProducerInvitation: true,
      },
    });
    expect(getInstanceId.mock.invocationCallOrder[0]).toBeLessThan(
      getUser.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
    );
  });

  it("sends a marked Producer invitation directly to a new email", async () => {
    createInvitation.mockResolvedValueOnce({
      ...invitation,
      emailAddress: "new.producer@example.com",
    });

    await expect(sendEmail()).resolves.toEqual({
      invitationId: "inv_new",
      reused: false,
      status: "pending",
    });

    expect(getUser).not.toHaveBeenCalled();
    expect(listInvitations).toHaveBeenCalledWith({
      emailAddress: "new.producer@example.com",
      limit: 100,
    });
    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: "new.producer@example.com",
      expiresInDays: 7,
      ignoreExisting: true,
      notify: true,
      redirectUrl: "https://skitza-test.example/sign-up",
      publicMetadata: { skitzaProducerInvitation: true },
    });
  });

  it("rejects malformed direct-email invitations before Clerk is called", async () => {
    await expect(sendEmail("not-an-email")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(getInstanceId).not.toHaveBeenCalled();
    expect(listInvitations).not.toHaveBeenCalled();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    "http://skitza-test.example/sign-up",
    "https://skitza-test.example/other",
    "https://user@skitza-test.example/sign-up",
    "https://skitza-test.example/sign-up?ticket=leak",
  ])("rejects an unsafe invitation redirect: %s", async (redirectUrl) => {
    await expect(send(redirectUrl)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(getInstanceId).not.toHaveBeenCalled();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("reuses only a marked exact-email pending or accepted invitation", async () => {
    listInvitations.mockResolvedValueOnce([
      {
        ...invitation,
        emailAddress: "someone@example.com",
        id: "inv_other_email",
      },
      {
        ...invitation,
        id: "inv_historical_unmarked",
        publicMetadata: null,
      },
      {
        ...invitation,
        id: "inv_marked_pending",
      },
    ]);

    await expect(send()).resolves.toEqual({
      invitationId: "inv_marked_pending",
      reused: true,
      status: "pending",
    });
    expect(createInvitation).not.toHaveBeenCalled();

    listInvitations.mockResolvedValueOnce([
      {
        ...invitation,
        id: "inv_marked_accepted",
        status: "accepted",
      },
    ]);
    await expect(send()).resolves.toEqual({
      invitationId: "inv_marked_accepted",
      reused: true,
      status: "accepted",
    });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("creates a replacement after marked invitations expire or are revoked", async () => {
    listInvitations.mockResolvedValueOnce([
      { ...invitation, id: "inv_expired", status: "expired" },
      { ...invitation, id: "inv_revoked", status: "revoked" },
    ]);

    await expect(send()).resolves.toMatchObject({
      invitationId: "inv_new",
      reused: false,
    });
    expect(createInvitation).toHaveBeenCalledOnce();
  });

  it("does not reuse a historical pending invitation without this sender's marker", async () => {
    listInvitations.mockResolvedValueOnce([
      {
        ...invitation,
        id: "inv_historical_unmarked",
        publicMetadata: null,
      },
    ]);

    await expect(send()).resolves.toEqual({
      invitationId: "inv_new",
      reused: false,
      status: "pending",
    });
    expect(createInvitation).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "wrong Clerk instance",
      setup: () => getInstanceId.mockResolvedValue("ins_live"),
    },
    {
      name: "missing target",
      setup: () => getUser.mockResolvedValue(null),
    },
    {
      name: "banned target",
      setup: () => getUser.mockResolvedValue({ ...target, banned: true }),
    },
    {
      name: "locked target",
      setup: () => getUser.mockResolvedValue({ ...target, locked: true }),
    },
    {
      name: "unverified primary email",
      setup: () =>
        getUser.mockResolvedValue({
          ...target,
          emailAddresses: [{ ...target.emailAddresses[0], verificationStatus: "unverified" }],
        }),
    },
  ])("fails closed for $name", async ({ setup }) => {
    setup();

    await expect(send()).rejects.toBeInstanceOf(ProducerInvitationError);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("keeps provider failures private and retryable", async () => {
    createInvitation.mockRejectedValueOnce(
      new Error("provider included sk_test_private in its error"),
    );

    let error: unknown;
    try {
      await send();
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "UNAVAILABLE" });
    expect(String(error)).not.toContain("sk_test_private");
  });
});
