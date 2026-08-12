import { describe, expect, it } from "vitest";

import {
  filterPublicSongBrowserTelemetry,
  hasInvitationTicketAuthority,
  isPublicSongListenPath,
  isSensitiveAuthorityLocation,
  redactPublicSongTelemetry,
  redactPublicSongTelemetryString,
} from "./public-song-telemetry";

const LINK_TOKEN = "eyJsaW5rSWQiOiJsaXZlIn0.public-link-signature";
const AUDIO_CAPABILITY = "eyJ2ZXJzaW9uSWQiOiJ2MSJ9.audio-capability-signature";

describe("public-song telemetry privacy", () => {
  it("redacts listen bearer paths and public-audio query authorities", () => {
    const value =
      `https://skitza.app/listen/${LINK_TOKEN}` +
      `?token=${LINK_TOKEN}&cap=${AUDIO_CAPABILITY}&version=version-1`;

    const redacted = redactPublicSongTelemetryString(value);

    expect(redacted).toBe(
      "https://skitza.app/listen/[redacted]" + "?token=[redacted]&cap=[redacted]&version=version-1",
    );
    expect(redacted).not.toContain(LINK_TOKEN);
    expect(redacted).not.toContain(AUDIO_CAPABILITY);
  });

  it("redacts nested URLs, raw query strings, and token-shaped properties without mutation", () => {
    const payload = {
      request: {
        url: `/api/audio/public/song/version-1?token=${LINK_TOKEN}&cap=${AUDIO_CAPABILITY}`,
        query_string: `token=${LINK_TOKEN}&cap=${AUDIO_CAPABILITY}&range=1`,
      },
      contexts: [{ token: LINK_TOKEN }, { CAP: AUDIO_CAPABILITY }],
      safe: "version-1",
    };

    const redacted = redactPublicSongTelemetry(payload);

    expect(JSON.stringify(redacted)).not.toContain(LINK_TOKEN);
    expect(JSON.stringify(redacted)).not.toContain(AUDIO_CAPABILITY);
    expect(redacted).toMatchObject({
      request: {
        query_string: "token=[redacted]&cap=[redacted]&range=1",
      },
      contexts: [{ token: "[redacted]" }, { CAP: "[redacted]" }],
      safe: "version-1",
    });
    expect(payload.contexts[0]?.token).toBe(LINK_TOKEN);
  });

  it("redacts Clerk invitation tickets case-insensitively in URLs and payload properties", () => {
    const invitationTicket = "ticket_secret_from_clerk";
    const payload = {
      url: `/sign-up?__clerk_ticket=${invitationTicket}&redirect_url=%2Fauth%2Fresolve`,
      query: `__CLERK_TICKET=${invitationTicket}`,
      nested: { __Clerk_Ticket: invitationTicket },
    };

    const redacted = redactPublicSongTelemetry(payload);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(invitationTicket);
    expect(redacted).toMatchObject({
      url: "/sign-up?__clerk_ticket=[redacted]&redirect_url=%2Fauth%2Fresolve",
      query: "__CLERK_TICKET=[redacted]",
      nested: { __Clerk_Ticket: "[redacted]" },
    });
  });

  it("redacts encoded invitation parameter names before browser parsing", () => {
    const ticket = "encoded_name_ticket_secret";
    const rawUrl = `/sign-up?__clerk%5fticket=${ticket}`;

    expect(redactPublicSongTelemetryString(rawUrl)).toBe("/sign-up?__clerk%5fticket=[redacted]");
    expect(hasInvitationTicketAuthority(`?__clerk%5Fticket=${ticket}`)).toBe(true);
  });

  it("redacts non-plain URL and Error values before later telemetry normalization", () => {
    const ticket = "non_plain_ticket_secret";
    const url = new URL(`https://skitza.app/sign-up?__clerk_ticket=${ticket}`);
    const error = new Error(`Failed at ${url.toString()}`);
    const redacted = redactPublicSongTelemetry({ arguments: [url, error] });
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(ticket);
    expect(serialized).toContain("[redacted]");
    expect(redacted.arguments[0]).toBe("https://skitza.app/sign-up?__clerk_ticket=[redacted]");
  });

  it("classifies invitation-ticket URLs as sensitive without broad query matches", () => {
    expect(hasInvitationTicketAuthority("?__clerk_ticket=secret")).toBe(true);
    expect(hasInvitationTicketAuthority("next=%2F&__CLERK_TICKET=secret")).toBe(true);
    expect(hasInvitationTicketAuthority("?__clerk%5fticket=secret")).toBe(true);
    expect(hasInvitationTicketAuthority("?not__clerk_ticket=secret")).toBe(false);
    expect(isSensitiveAuthorityLocation("/sign-up", "?__clerk_ticket=secret")).toBe(true);
    expect(isSensitiveAuthorityLocation("/sign-up", "")).toBe(false);
  });

  it("drops browser telemetry on listen pages and keeps lookalike routes", () => {
    const payload = { event: "pageview", url: `/listen/${LINK_TOKEN}` };

    expect(filterPublicSongBrowserTelemetry(payload, `/listen/${LINK_TOKEN}`)).toBeNull();
    expect(filterPublicSongBrowserTelemetry(payload, "/listen")).toBeNull();
    expect(filterPublicSongBrowserTelemetry(payload, "/listener/settings")).toEqual({
      event: "pageview",
      url: "/listen/[redacted]",
    });
  });

  it.each([
    ["/listen", true],
    ["/listen/", true],
    [`/listen/${LINK_TOKEN}`, true],
    ["/listener/token", false],
    ["/dashboard/listen/token", false],
  ])("classifies %s without broad prefix matches", (pathname, expected) => {
    expect(isPublicSongListenPath(pathname)).toBe(expected);
  });
});
