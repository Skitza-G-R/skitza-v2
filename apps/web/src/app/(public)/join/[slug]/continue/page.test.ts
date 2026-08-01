import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const service = readFileSync(
  new URL("../../../../../server/contacts/join-continuation.ts", import.meta.url),
  "utf8",
);
const action = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

describe("join confirmation and continuation", () => {
  it("uses the exact approved Producer confirmation copy", () => {
    expect(page).toContain("Join ${studioName} as an Artist?");
    expect(page).toContain(
      "Your Producer workspace will stay exactly as it is. You can switch back anytime.",
    );
    expect(page).toContain("Continue as Artist");
    expect(page).toContain("Back to my studio");
  });

  it("keeps confirmation for complete and incomplete Producer profiles", () => {
    expect(page).toContain('memberships.producer.status === "complete"');
    expect(page).toContain('memberships.producer.status === "incomplete"');
  });

  it("keeps the GET read-only and requires an explicit server-action POST", () => {
    expect(page).not.toContain("connectCurrentUserForJoin");
    expect(page).toContain("<form action={action}>");
    expect(page).toContain("Continue to booking");
    expect(action).toContain("connectCurrentUserForJoin");
  });

  it("auto-resumes only a trusted action and keeps unlock copy out of the expired-booking state", () => {
    expect(page).toContain("expectedAction: requestedAction");
    expect(page).toContain("<ResumeTrustedJoin slug={slug} action={requestedAction} />");
    expect(page).toContain("Your original booking intent expired.");
    expect(page).toContain("Continue to your studio");
    expect(page).toContain(
      "Your unlock request expired. Continue to open this studio in your Artist workspace.",
    );
    expect(page).not.toContain("Sign up to unlock this studio");
    expect(page).toContain('requestedAction === "book" ? "Booking" : "Your music"');
    expect(page).toContain("Opening your Artist workspace and unlocked tracks.");
    expect(action.match(/clearJoinIntentCookie\(/g)).toHaveLength(2);
  });

  it("rechecks identity, prevents self-join, and proves the active contact before booking", () => {
    expect(page).toContain("isSelfJoin(session.userId, target)");
    expect(service).toContain("verifiedEmailHashesFromUser");
    expect(service).toContain("eq(clientContacts.clerkUserId, input.userId)");
    expect(service).toContain("isNull(clientContacts.archivedAt)");
    expect(service).toContain('JoinContinuationError("CONNECTION_NOT_CONFIRMED")');
  });
});
