import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("registered-users page and control safety", () => {
  it.each([
    "src/app/(admin)/users/page.tsx",
    "src/app/(admin)/users/[userId]/page.tsx",
  ])("authorizes inside %s before reading route input", (path) => {
    const page = source(path);
    const authorization = page.indexOf("await requireActiveAdminPage()");
    // SK-288 removed the [environment] segment, so the directory page now
    // reads only searchParams. Either is route input and either must wait.
    const routeInput = Math.min(
      ...["await params", "await searchParams"]
        .map((token) => page.indexOf(token))
        .filter((index) => index > -1),
    );

    expect(authorization).toBeGreaterThan(-1);
    expect(Number.isFinite(routeInput)).toBe(true);
    expect(routeInput).toBeGreaterThan(authorization);
  });

  it("shows malformed directory and activity cursors as safe resets", () => {
    const directory = source("src/app/(admin)/users/page.tsx");
    const profile = source("src/app/(admin)/users/[userId]/page.tsx");

    expect(directory).toContain("malformedCursor && !data.cursorReset");
    expect(directory).toContain('cursorInput !== undefined && typeof cursorInput !== "string"');
    expect(directory).toContain("cursorReset: true");
    expect(profile).toContain("malformedActivityCursor");
    expect(profile).toContain('cursorInput !== undefined && typeof cursorInput !== "string"');
    expect(profile).toContain("cursorReset: true");
  });

  it("binds Summary access to the header's current tombstone state", () => {
    const profile = source("src/app/(admin)/users/[userId]/page.tsx");

    expect(profile).toContain('allowDeletedSummary: header.status === "Deleted"');
  });

  it("keeps one reveal idempotency key across failed retries", () => {
    const controls = source("src/features/registered-users/client-controls.tsx");

    expect(controls).toContain(
      'const requestKey = revealKey ?? operationKey("support-note-reveal")',
    );
    expect(controls).toContain('"idempotency-key": requestKey');
    expect(controls).not.toContain('"idempotency-key": operationKey("support-note-reveal")');
  });

  it("keeps profile invitations server-bound and adds a two-step marked email sender", () => {
    const controls = source("src/features/registered-users/client-controls.tsx");
    const profile = source("src/features/registered-users/profile-view.tsx");

    expect(controls).toContain("Invite as Producer");
    expect(controls).toContain("Send a real invitation?");
    // The environment is no longer anything a client can name: SK-288
    // removed the selector, so the browser must not send one at all.
    expect(controls).not.toContain("?environment=");
    expect(controls).toContain('body: "{}"');
    expect(controls).toContain("Invite Producer by email");
    expect(controls).toContain("Review invitation");
    expect(controls).toContain("includes the Skitza Producer marker");
    expect(controls).toContain("JSON.stringify({ emailAddress: confirmedEmail })");
    expect(profile).toContain('header.roles.includes("Artist")');
    expect(profile).toContain('!header.roles.includes("Producer")');
  });

  it("keeps the compact desktop signup sort and mobile touch targets", () => {
    const directory = source("src/features/registered-users/directory-view.tsx");
    const styles = source("src/features/registered-users/registered-users.module.css");

    expect(directory).toMatch(/sort="signup"[\s\S]*>\s*Signup\s*</);
    expect(styles).toContain("@media (max-width: 1120px)");
    expect(styles).toMatch(
      /@media \(max-width: 1120px\)[\s\S]*\.moreFilters summary[\s\S]*min-height: 2\.75rem/,
    );
  });

  it("uses truthful error copy without claiming the database stayed closed", () => {
    const error = source("src/app/(admin)/users/error.tsx");

    expect(error).toContain("no account changes were made");
    expect(error).not.toContain("environment stayed closed");
  });
});
