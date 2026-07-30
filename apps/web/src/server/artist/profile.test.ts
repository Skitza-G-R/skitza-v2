import { describe, expect, it } from "vitest";

import {
  defaultArtistNotificationPreferences,
  isValidIanaTimezone,
  resolveArtistNotificationPreferences,
} from "./profile";

describe("artist profile preferences", () => {
  it("uses the approved notification defaults", () => {
    const defaults = defaultArtistNotificationPreferences();

    expect(defaults.purchase).toEqual({
      inApp: true,
      transactionalEmail: true,
      activityEmail: false,
    });
    expect(defaults.new_music).toEqual({
      inApp: true,
      transactionalEmail: false,
      activityEmail: false,
    });
  });

  it("accepts only supported channel overrides for each category", () => {
    const resolved = resolveArtistNotificationPreferences({
      purchase: { inApp: false, transactionalEmail: false, activityEmail: true },
      new_music: {
        inApp: false,
        transactionalEmail: true,
        activityEmail: true,
      },
    });

    expect(resolved.purchase).toEqual({
      inApp: false,
      transactionalEmail: false,
      activityEmail: false,
    });
    expect(resolved.new_music).toEqual({
      inApp: false,
      transactionalEmail: false,
      activityEmail: true,
    });
  });

  it("validates runtime IANA zones and rejects fixed offsets", () => {
    expect(isValidIanaTimezone("Asia/Jerusalem")).toBe(true);
    expect(isValidIanaTimezone("UTC")).toBe(true);
    expect(isValidIanaTimezone("+02:00")).toBe(false);
    expect(isValidIanaTimezone(" Asia/Jerusalem")).toBe(false);
    expect(isValidIanaTimezone("Not/A_Zone")).toBe(false);
  });
});
