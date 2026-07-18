import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";

import { BookingCancelledOrRescheduled } from "../booking-cancelled-or-rescheduled";
import { NewCommentFromArtist } from "../new-comment-from-artist";
import { ProducerRepliedToComment } from "../producer-replied-to-comment";
import { TrackVersionUploaded } from "../track-version-uploaded";

// Smoke tests for the remaining transactional email templates
// (2026-04-22). Each test renders the component with realistic props
// and asserts that (a) the render doesn't throw and (b) the output
// includes the key content we'd grep for in a production send log
// when debugging delivery.
//
// These are deliberately lightweight — we don't snapshot the full
// HTML because React Email's output changes between versions and
// we'd rather the tests be robust to markup churn. We just prove the
// React tree compiles + the props flow through to the rendered HTML.

describe("email templates smoke render (audit Task 13)", () => {
  it("TrackVersionUploaded renders with version label + producer name", async () => {
    const html = await render(
      <TrackVersionUploaded
        artistName="Ada"
        producerName="Gili Asraf"
        projectName="Summer EP"
        versionLabel="Mix v2"
        reviewUrl="https://skitza.app/artist/music/p1"
      />,
    );
    expect(html).toContain("Ada");
    expect(html).toContain("Mix v2");
    expect(html).toContain("Gili Asraf");
    expect(html).toContain("Summer EP");
    expect(html).toContain("https://skitza.app/artist/music/p1");
  });

  it("ProducerRepliedToComment renders quote block + CTA link", async () => {
    const html = await render(
      <ProducerRepliedToComment
        artistName="Ada"
        producerName="Gili Asraf"
        trackTitle="Summer EP — Track 03"
        replyBody="Boosted the vocals at 0:34 — let me know if it lands."
        threadUrl="https://skitza.app/artist/music/p1#c42"
      />,
    );
    expect(html).toContain("Ada");
    expect(html).toContain("Gili Asraf");
    expect(html).toContain("Summer EP — Track 03");
    // Text inside the blockquote should survive rendering.
    expect(html).toContain("Boosted the vocals at 0:34");
    expect(html).toContain("https://skitza.app/artist/music/p1#c42");
  });

  it("NewCommentFromArtist renders the comment body + track title", async () => {
    const html = await render(
      <NewCommentFromArtist
        producerName="Gili Asraf"
        artistName="Ada"
        trackTitle="Summer EP — Track 03"
        commentBody="Loving where this is going — the bridge hits."
        threadUrl="https://skitza.app/dashboard/clients-projects/p1#c42"
      />,
    );
    expect(html).toContain("Ada");
    expect(html).toContain("Summer EP — Track 03");
    expect(html).toContain("Loving where this is going");
    expect(html).toContain("https://skitza.app/dashboard/clients-projects/p1#c42");
  });

  it("BookingCancelledOrRescheduled (cancelled variant) shows original time + no new slot", async () => {
    const oldStartsAt = new Date("2026-05-01T18:00:00Z");
    const html = await render(
      <BookingCancelledOrRescheduled
        recipientName="Ada"
        counterpartName="Gili Asraf"
        productName="3-hour mixing session"
        status="cancelled"
        oldStartsAt={oldStartsAt}
        newStartsAt={null}
        producerTimezone="Asia/Jerusalem"
        reason="Studio equipment failure."
      />,
    );
    expect(html).toContain("Ada");
    expect(html).toContain("Gili Asraf");
    expect(html).toContain("3-hour mixing session");
    expect(html).toContain("cancelled");
    // Reason attribution preserved.
    expect(html).toContain("Studio equipment failure");
    // "Now" row should NOT appear on cancellation.
    expect(html).not.toMatch(/\bNow\s*·/);
  });

  it("BookingCancelledOrRescheduled (rescheduled variant) shows both old + new slots", async () => {
    const oldStartsAt = new Date("2026-05-01T18:00:00Z");
    const newStartsAt = new Date("2026-05-03T20:00:00Z");
    const html = await render(
      <BookingCancelledOrRescheduled
        recipientName="Ada"
        counterpartName="Gili Asraf"
        productName="3-hour mixing session"
        status="rescheduled"
        oldStartsAt={oldStartsAt}
        newStartsAt={newStartsAt}
        producerTimezone="Asia/Jerusalem"
        reason={null}
      />,
    );
    expect(html).toContain("rescheduled");
    expect(html).toContain("Was");
    expect(html).toContain("Now");
  });
});
