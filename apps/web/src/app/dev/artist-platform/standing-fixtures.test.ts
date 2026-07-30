import { describe, expect, it } from "vitest";

import {
  DEV_ARTIST_HOME_MAIN,
  DEV_ARTIST_NOTIFICATIONS,
  DEV_ARTIST_NOW_ISO,
  DEV_ARTIST_SESSIONS,
  DEV_ARTIST_STUDIOS,
  DEV_ARTIST_STORE_PRODUCTS,
} from "~/components/dev/artist-platform-standing-fixtures";

describe("artist platform standing preview fixtures", () => {
  it("uses one fixed clock and fixed session instants", () => {
    expect(DEV_ARTIST_NOW_ISO).toBe("2026-08-04T09:00:00.000Z");
    expect(DEV_ARTIST_SESSIONS).toHaveLength(3);
    expect(
      DEV_ARTIST_SESSIONS.every((session) => {
        return (
          Number.isFinite(Date.parse(session.startsAtISO)) &&
          Number.isFinite(Date.parse(session.policy.cancellationDeadlineISO))
        );
      }),
    ).toBe(true);
  });

  it("covers the populated Home and catalog approval states", () => {
    expect(DEV_ARTIST_HOME_MAIN).toMatchObject({
      kind: "new_song",
      isNew: true,
    });
    expect(DEV_ARTIST_STORE_PRODUCTS).toHaveLength(3);
    expect(new Set(DEV_ARTIST_STORE_PRODUCTS.map((product) => product.pricingModel))).toEqual(
      new Set(["flat", "per_song", "bundle"]),
    );
    const pricingModels: string[] = DEV_ARTIST_STORE_PRODUCTS.map(
      (product) => product.pricingModel,
    );
    expect(pricingModels).not.toContain("hourly");
  });

  it("shows three unread events and dots for both studios", () => {
    const unread = DEV_ARTIST_NOTIFICATIONS.filter(
      (notification) => notification.readAtIso === null,
    );
    expect(unread).toHaveLength(3);
    expect(new Set(unread.map((notification) => notification.producerId))).toEqual(
      new Set(DEV_ARTIST_STUDIOS.map((studio) => studio.producerId)),
    );
  });
});
