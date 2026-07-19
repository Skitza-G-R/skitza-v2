import { describe, expect, it } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
import { verifiedEmailHashesFromUser } from "../verified-email";

describe("verifiedEmailHashesFromUser", () => {
  it("returns unique hashes for verified addresses owned by the expected account", () => {
    expect(
      verifiedEmailHashesFromUser(
        {
          id: "user_artist",
          emailAddresses: [
            { emailAddress: "ARTIST@example.test", verification: { status: "verified" } },
            { emailAddress: "artist@example.test", verification: { status: "verified" } },
            { emailAddress: "pending@example.test", verification: { status: "unverified" } },
          ],
        },
        "user_artist",
      ),
    ).toEqual([emailHashFor("artist@example.test")]);
  });

  it("fails closed for the wrong Clerk account or an account without a verified address", () => {
    const user = {
      id: "user_other",
      emailAddresses: [
        { emailAddress: "artist@example.test", verification: { status: "verified" } },
      ],
    };

    expect(verifiedEmailHashesFromUser(user, "user_artist")).toEqual([]);
    expect(
      verifiedEmailHashesFromUser(
        {
          id: "user_artist",
          emailAddresses: [
            { emailAddress: "artist@example.test", verification: { status: "unverified" } },
          ],
        },
        "user_artist",
      ),
    ).toEqual([]);
    expect(verifiedEmailHashesFromUser(null, "user_artist")).toEqual([]);
  });
});
