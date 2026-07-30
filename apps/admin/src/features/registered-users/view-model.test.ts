import { describe, expect, it } from "vitest";

import { parseRegisteredUserDirectoryQuery } from "~/server/registered-users/model";
import {
  buildUserProfileHref,
  buildUsersDirectoryHref,
  formatAdminDate,
  hasAdvancedDirectoryState,
  hasDirectoryFilters,
  humanizeAdminCode,
  initials,
  isValidRegisteredUserId,
  safeMetadataEntries,
} from "./view-model";

describe("registered-users UI model", () => {
  it("builds canonical URL-owned directory state and resets stale cursors", () => {
    const query = parseRegisteredUserDirectoryQuery({
      cursor: "old_cursor",
      q: "  Gili  ",
      role: "producer",
      sort: "name",
    });

    expect(buildUsersDirectoryHref("test", query)).toBe(
      "/test/users?q=Gili&role=producer&sort=name",
    );
    expect(
      buildUsersDirectoryHref("test", query, {
        cursor: "next_cursor",
      }),
    ).toBe(
      "/test/users?q=Gili&role=producer&sort=name&cursor=next_cursor",
    );
    expect(
      buildUsersDirectoryHref("test", query, {
        query: "new",
      }),
    ).toBe("/test/users?q=new&role=producer&sort=name");
  });

  it("keeps profile tabs and activity cursors explicit", () => {
    expect(buildUserProfileHref("live", "user_1", "summary")).toBe(
      "/live/users/user_1",
    );
    expect(
      buildUserProfileHref("live", "user_1", "activity", "next_page"),
    ).toBe("/live/users/user_1?tab=activity&cursor=next_page");
  });

  it("detects visible and advanced filter state", () => {
    const defaults = parseRegisteredUserDirectoryQuery({});
    const filtered = parseRegisteredUserDirectoryQuery({
      activity: "7d",
      role: "artist",
    });

    expect(hasDirectoryFilters(defaults)).toBe(false);
    expect(hasAdvancedDirectoryState(defaults)).toBe(false);
    expect(hasDirectoryFilters(filtered)).toBe(true);
    expect(hasAdvancedDirectoryState(filtered)).toBe(true);
    expect(
      hasAdvancedDirectoryState(
        parseRegisteredUserDirectoryQuery({
          dir: "asc",
          sort: "status",
          status: "restricted",
        }),
      ),
    ).toBe(false);
  });

  it("formats bounded, safe support metadata without nested content", () => {
    expect(
      safeMetadataEntries({
        body: { private: "never render" },
        count: 2,
        ok: true,
        provider_state: "active",
      }),
    ).toEqual([
      { key: "Count", value: "2" },
      { key: "Ok", value: "true" },
      { key: "Provider state", value: "active" },
    ]);
    expect(humanizeAdminCode("payment_proof.created")).toBe(
      "Payment proof created",
    );
  });

  it("keeps identity and date fallbacks clear", () => {
    expect(initials("Gili Asraf")).toBe("GA");
    expect(initials("")).toBe("?");
    expect(formatAdminDate(null)).toBe("Not recorded");
    expect(formatAdminDate(new Date("2026-07-30T09:15:00.000Z"))).toContain(
      "30 Jul 2026",
    );
    expect(isValidRegisteredUserId("user_123")).toBe(true);
    expect(isValidRegisteredUserId("../../secret")).toBe(false);
  });
});
