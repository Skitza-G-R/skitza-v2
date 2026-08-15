import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const service = readFileSync(
  new URL("../../../../../server/contacts/join-continuation.ts", import.meta.url),
  "utf8",
);
const action = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const accountSwitch = readFileSync(
  new URL("./join-account-switch-button.tsx", import.meta.url),
  "utf8",
);
const shell = readFileSync(new URL("./join-continuation-shell.tsx", import.meta.url), "utf8");

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

  it("auto-resumes only a trusted action and normalizes legacy Store to Home", () => {
    expect(page).toContain("expectedAction: trustedAction");
    expect(page).toContain("<ResumeTrustedJoin slug={slug} action={trustedAction} />");
    expect(page).toContain('query.action === "store" ? "home" : query.action');
    expect(page).toContain("Your original booking intent expired.");
    expect(page).toContain("Continue to your studio");
    expect(page).toContain(
      "Your unlock request expired. Continue to open this studio in your Artist workspace.",
    );
    expect(page).not.toContain("Sign up to unlock this studio");
    expect(page).toContain('requestedAction === "unlock"');
    expect(page).toContain('"Artist Home"');
    expect(page).toContain("Opening your Artist workspace and unlocked tracks.");
    expect(page).toContain("Opening your Artist Home with this studio selected.");
    expect(page).not.toContain("Continue to Artist Store");
    expect(page).not.toContain("open this studio's Artist Store");
    expect(action.match(/clearJoinIntentCookie\(/g)).toHaveLength(2);
  });

  it("rechecks identity, prevents self-join, and proves the active contact before booking", () => {
    expect(page).toContain("isSelfJoin(session.userId, target)");
    expect(service).toContain("verifiedEmailHashesFromUser");
    expect(service).toContain("eq(clientContacts.clerkUserId, input.userId)");
    expect(service).toContain("isNull(clientContacts.archivedAt)");
    expect(service).toContain('JoinContinuationError("CONNECTION_NOT_CONFIRMED")');
  });

  it("renders every continuation state inside a centered bounded shell", () => {
    expect(page.match(/<JoinContinuationShell/g)).toHaveLength(6);
    expect(page).toContain('data-auth-page="join-account-conflict"');
    expect(accountSwitch).toContain('action === "offer"');
    expect(accountSwitch).toContain('"Switch account"');
    expect(page).toContain("This offer was sent to another email");
    expect(page).toContain("Back to {studioName}");
    expect(shell).toContain("max-w-[440px]");
    expect(shell).toContain("px-4");
    expect(shell).toContain("sm:px-6");
    expect(page.match(/\[overflow-wrap:anywhere\]/g)).toHaveLength(4);
    expect(page.match(/whitespace-normal/g)).toHaveLength(4);
  });

  it("turns only the expected account ownership conflict into recovery UX", () => {
    expect(action.match(/redirectForKnownJoinError\(/g)).toHaveLength(3);
    expect(action).toContain("isJoinAccountConflict(error)");
    expect(action).toContain("joinAccountConflictHref(slug, action, offerId)");
  });

  it("checks offer identity before metadata and routes an authorized artist directly", () => {
    expect(page).toContain("getPrivateOfferJoinAccess");
    expect(page).toContain('if (access === "authorized") redirect(`/artist/offers/${offerId}`)');
    expect(page).toContain('if (access === "wrong_account")');
    expect(page.indexOf('if (access === "wrong_account")')).toBeLessThan(
      page.indexOf("const studioName"),
    );
    expect(page).not.toContain("invited address");
  });

  it("renders allowlisted verification retry states through the explicit POST action", () => {
    expect(page).toContain("query.problem === JOIN_UNVERIFIED_EMAIL");
    expect(page).toContain("query.problem === JOIN_CONNECTION_PENDING");
    expect(page).toContain("Verify your email, then retry");
    expect(page).toContain("Connection is still finishing");
    expect(page).toContain("<form action={action}>");
    expect(page).toContain("Retry");
    expect(page).toContain("<JoinAccountSwitchButton");
  });
});
