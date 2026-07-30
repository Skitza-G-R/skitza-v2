import { describe, expect, it } from "vitest";

import {
  selectArtistHomeMainAction,
  type ArtistHomeAction,
  withoutArtistHomeDuplicate,
} from "../home-priority";

function action(
  id: string,
  kind: ArtistHomeAction["kind"],
  options: { upcomingAt?: string; occurredAt?: string } = {},
): ArtistHomeAction {
  return {
    id,
    kind,
    title: id,
    detail: "Detail",
    href: "/artist",
    actionLabel: "Open",
    upcomingAt: options.upcomingAt ? new Date(options.upcomingAt) : null,
    occurredAt: new Date(options.occurredAt ?? "2026-07-30T08:00:00.000Z"),
  };
}

describe("artist Home priority", () => {
  it("uses the approved cross-kind priority", () => {
    const result = selectArtistHomeMainAction([
      action("services", "services"),
      action("song", "new_song"),
      action("package", "ready_to_schedule"),
      action("payment", "payment_action"),
      action("session", "today_session"),
    ]);
    expect(result?.id).toBe("session");
  });

  it("chooses the nearest time within one priority", () => {
    const result = selectArtistHomeMainAction([
      action("later", "payment_action", { upcomingAt: "2026-08-03T10:00:00.000Z" }),
      action("sooner", "payment_action", { upcomingAt: "2026-08-01T10:00:00.000Z" }),
    ]);
    expect(result?.id).toBe("sooner");
  });

  it("uses newest activity and then stable id as deterministic tie-breakers", () => {
    expect(
      selectArtistHomeMainAction([
        action("old", "new_song", { occurredAt: "2026-07-28T10:00:00.000Z" }),
        action("new", "new_song", { occurredAt: "2026-07-29T10:00:00.000Z" }),
      ])?.id,
    ).toBe("new");
    expect(
      selectArtistHomeMainAction([action("b", "services"), action("a", "services")])?.id,
    ).toBe("a");
  });

  it("removes the main item from quiet supporting rows", () => {
    const candidates = [action("main", "payment_action"), action("other", "new_song")];
    expect(
      withoutArtistHomeDuplicate(candidates, candidates[0] ?? null).map((item) => item.id),
    ).toEqual(["other"]);
  });
});
