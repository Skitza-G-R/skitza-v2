import { describe, expect, it } from "vitest";

import {
  ARTIST_PUSH_CATEGORY_COPY,
  PUSH_CATEGORIES,
  PUSH_CATEGORY_COPY,
  pushCategoryCopyForRole,
} from "~/lib/push/categories";

describe("push category copy", () => {
  it("covers every category in both role maps with real copy", () => {
    for (const category of PUSH_CATEGORIES) {
      for (const copy of [PUSH_CATEGORY_COPY[category], ARTIST_PUSH_CATEGORY_COPY[category]]) {
        expect(copy.label.trim().length).toBeGreaterThan(0);
        expect(copy.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("rewords the artist view without touching producer labels", () => {
    expect(pushCategoryCopyForRole("producer")).toBe(PUSH_CATEGORY_COPY);
    expect(pushCategoryCopyForRole("artist")).toBe(ARTIST_PUSH_CATEGORY_COPY);
    expect(PUSH_CATEGORY_COPY.booking.label).toBe("Bookings");
    expect(ARTIST_PUSH_CATEGORY_COPY.booking.label).toBe("Sessions");
    expect(ARTIST_PUSH_CATEGORY_COPY.song_status.label).toBe("Song updates");
    expect(ARTIST_PUSH_CATEGORY_COPY.purchase_status.label).toBe("Purchase steps");
  });
});
