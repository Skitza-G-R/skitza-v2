import { describe, expect, it } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
import {
  selectAcceptedProducerInvitation,
  type ProducerInvitationCandidate,
} from "../producer-invitation";

const CUTOFF = new Date("2026-08-12T00:00:00.000Z");
const CUTOFF_MS = CUTOFF.getTime();

const verifiedUser = {
  id: "user_artist",
  emailAddresses: [
    {
      emailAddress: " Artist@Example.Test ",
      verification: { status: "verified" },
    },
  ],
};

function invitation(
  overrides: Partial<ProducerInvitationCandidate> = {},
): ProducerInvitationCandidate {
  return {
    id: "inv_accepted",
    emailAddress: "artist@example.test",
    status: "accepted",
    createdAt: CUTOFF_MS,
    updatedAt: CUTOFF_MS + 1_000,
    ...overrides,
  };
}

describe("selectAcceptedProducerInvitation", () => {
  it("returns a safe proof for an accepted invitation matching the same user's verified email", () => {
    const candidateWithTicket = {
      ...invitation(),
      url: "https://accounts.example.test/invitation?__clerk_ticket=raw-secret",
      raw: { ticket: "raw-secret" },
    };

    const result = selectAcceptedProducerInvitation({
      clerkUser: verifiedUser,
      expectedClerkUserId: "user_artist",
      invitations: [candidateWithTicket],
      cutoff: CUTOFF,
    });

    expect(result).toEqual({
      status: "matched",
      invitation: {
        invitationId: "inv_accepted",
        clerkUserId: "user_artist",
        emailAddress: "artist@example.test",
        emailHash: emailHashFor("artist@example.test"),
        createdAt: CUTOFF_MS,
        updatedAt: CUTOFF_MS + 1_000,
      },
    });
    expect(JSON.stringify(result)).not.toContain("raw-secret");
    expect(JSON.stringify(result)).not.toContain("__clerk_ticket");
  });

  it("fails closed when the supplied Clerk user is not the expected signed-in user", () => {
    expect(
      selectAcceptedProducerInvitation({
        clerkUser: { ...verifiedUser, id: "user_someone_else" },
        expectedClerkUserId: "user_artist",
        invitations: [invitation()],
        cutoff: CUTOFF,
      }),
    ).toEqual({ status: "no_match" });
  });

  it("requires an exact normalized match to a verified email", () => {
    const unverifiedOwner = {
      id: "user_artist",
      emailAddresses: [
        {
          emailAddress: "artist@example.test",
          verification: { status: "unverified" },
        },
        {
          emailAddress: "verified@example.test",
          verification: { status: "verified" },
        },
      ],
    };

    expect(
      selectAcceptedProducerInvitation({
        clerkUser: unverifiedOwner,
        expectedClerkUserId: "user_artist",
        invitations: [
          invitation({ emailAddress: "artist@example.test" }),
          invitation({ id: "inv_prefix", emailAddress: "xverified@example.test" }),
          invitation({
            id: "inv_suffix",
            emailAddress: "verified@example.test.attacker.test",
          }),
        ],
        cutoff: CUTOFF,
      }),
    ).toEqual({ status: "no_match" });
  });

  it("rejects non-accepted, revoked, pre-cutoff, and malformed invitations", () => {
    expect(
      selectAcceptedProducerInvitation({
        clerkUser: verifiedUser,
        expectedClerkUserId: "user_artist",
        invitations: [
          invitation({ id: "inv_pending", status: "pending" }),
          invitation({ id: "inv_expired", status: "expired" }),
          invitation({ id: "inv_revoked_status", status: "revoked" }),
          invitation({ id: "inv_revoked_flag", revoked: true }),
          invitation({ id: "inv_before_cutoff", createdAt: CUTOFF_MS - 1 }),
          invitation({ id: "", createdAt: CUTOFF_MS + 1 }),
          invitation({ id: "inv_bad_date", createdAt: Number.NaN }),
        ],
        cutoff: CUTOFF,
      }),
    ).toEqual({ status: "no_match" });
  });

  it("treats the cutoff as inclusive and chooses the newest valid invitation", () => {
    const result = selectAcceptedProducerInvitation({
      clerkUser: verifiedUser,
      expectedClerkUserId: "user_artist",
      invitations: [
        invitation({ id: "inv_at_cutoff" }),
        invitation({
          id: "inv_newest",
          createdAt: CUTOFF_MS + 10_000,
          updatedAt: CUTOFF_MS + 11_000,
        }),
        invitation({
          id: "inv_middle",
          createdAt: CUTOFF_MS + 5_000,
          updatedAt: CUTOFF_MS + 50_000,
        }),
      ],
      cutoff: CUTOFF,
    });

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.invitation.invitationId).toBe("inv_newest");
    }
  });

  it("uses updated time and then invitation id to resolve exact creation-time ties", () => {
    const first = invitation({ id: "inv_b", createdAt: CUTOFF_MS + 10_000 });
    const updatedLater = invitation({
      id: "inv_c",
      createdAt: CUTOFF_MS + 10_000,
      updatedAt: CUTOFF_MS + 20_000,
    });
    const stableTie = invitation({
      id: "inv_a",
      createdAt: CUTOFF_MS + 10_000,
      updatedAt: CUTOFF_MS + 20_000,
    });

    for (const invitations of [
      [first, updatedLater, stableTie],
      [stableTie, updatedLater, first],
    ]) {
      const result = selectAcceptedProducerInvitation({
        clerkUser: verifiedUser,
        expectedClerkUserId: "user_artist",
        invitations,
        cutoff: CUTOFF,
      });

      expect(result.status).toBe("matched");
      if (result.status === "matched") {
        expect(result.invitation.invitationId).toBe("inv_a");
      }
    }
  });

  it("returns no_match for an invalid cutoff instead of authorizing", () => {
    expect(
      selectAcceptedProducerInvitation({
        clerkUser: verifiedUser,
        expectedClerkUserId: "user_artist",
        invitations: [invitation()],
        cutoff: new Date(Number.NaN),
      }),
    ).toEqual({ status: "no_match" });
  });
});
