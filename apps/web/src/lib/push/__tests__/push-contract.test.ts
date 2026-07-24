import { describe, expect, it } from "vitest";

import { normalizePushCategories, PUSH_CATEGORIES, PUSH_CATEGORY_COPY } from "../categories";
import { validatePushDeepLink } from "../deep-link";

const ID = "00000000-0000-4000-8000-000000000112";
const OTHER_ID = "00000000-0000-4000-8000-000000000113";

describe("SK-112 push category contract", () => {
  it("contains only real categories and defaults to no enabled category", () => {
    expect(PUSH_CATEGORIES).toEqual([
      "booking",
      "payment",
      "comment",
      "project_status",
      "song_status",
      "purchase_status",
    ]);
    expect(normalizePushCategories([])).toEqual([]);
    expect(Object.keys(PUSH_CATEGORY_COPY)).toEqual(PUSH_CATEGORIES);
  });

  it("deduplicates known values and rejects fake preference keys", () => {
    expect(
      normalizePushCategories(["comment", "weekly", "comment", "approval", "booking"]),
    ).toEqual(["booking", "comment"]);
  });
});

describe("SK-112 exact same-origin push links", () => {
  it.each([
    [`/dashboard/calendar?booking=${ID}`, `/dashboard/calendar?booking=${ID}`],
    [`/dashboard/payments/${ID}`, `/dashboard/payments/${ID}`],
    [`/dashboard/music/${ID}`, `/dashboard/music/${ID}`],
    [`/dashboard/requests/${ID}`, `/dashboard/requests/${ID}`],
    [
      `/dashboard/clients-projects/${ID}/songs/${OTHER_ID}`,
      `/dashboard/clients-projects/${ID}/songs/${OTHER_ID}`,
    ],
    [`/artist/sessions/${ID}`, `/artist/sessions/${ID}`],
    [`/artist/payments/${ID}`, `/artist/payments/${ID}`],
    [`/artist/music/${ID}`, `/artist/music/${ID}`],
    [`/artist/music/song/${ID}`, `/artist/music/song/${ID}`],
    [`/artist/purchase/${ID}/pay?req=${OTHER_ID}`, `/artist/purchase/${ID}/pay?req=${OTHER_ID}`],
    [`/artist/purchase/${ID}/sent?req=${OTHER_ID}`, `/artist/purchase/${ID}/sent?req=${OTHER_ID}`],
  ])("accepts the exact item route %s", (input, expected) => {
    expect(validatePushDeepLink(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/dashboard",
    "//evil.example/dashboard",
    "/api/push",
    "/sign-in",
    "/join/studio",
    "/listen/secret-token",
    "/dashboard",
    `/dashboard/calendar?booking=${ID}&next=https://evil.example`,
    `/dashboard/calendar?booking=${ID}#secret`,
    `/dashboard/payments/not-a-uuid`,
    `/artist/payments/${ID}?token=secret`,
    `/artist/purchase/${ID}/pay?req=${OTHER_ID}&studio=${ID}`,
    `/artist/purchase/${ID}/sent?req=not-a-uuid`,
  ])("rejects unsafe or inexact route %s", (input) => {
    expect(validatePushDeepLink(input)).toBeNull();
  });
});
