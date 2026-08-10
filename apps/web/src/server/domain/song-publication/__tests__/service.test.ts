import { describe, expect, it } from "vitest";

import {
  disableSongPublicLink,
  publishSongPublicLink,
  resetSongPublicLink,
  setPortfolioPublic,
  type ProducerSongPublicationCommand,
  type SongPublicAccessAuditEvent,
  type SongPublicationAtomicScope,
  type SongPublicationRepository,
  type SongPublicationSnapshot,
  type SongPublicationTrackRecord,
  type SongPublicationTransaction,
  type SongPublicLinkRecord,
} from "../service";
import { hashSongPublicToken, verifySongPublicToken } from "../tokens";

const PRODUCER_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const PURCHASE_ID = "33333333-3333-4333-8333-333333333333";
const LINK_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ID = "user_producer_1";
const SECRET = "sk98-public-song-secret-long-enough";
const NOW = new Date("2026-07-20T10:00:00.000Z");

type MemoryState = {
  track: SongPublicationTrackRecord;
  projectUpdatedAt: Date;
  link: SongPublicLinkRecord | null;
  remainingAudioCount: number;
  events: SongPublicAccessAuditEvent[];
};

function copyDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}

function copyTrack(track: SongPublicationTrackRecord): SongPublicationTrackRecord {
  return { ...track, portfolioPublishedAt: copyDate(track.portfolioPublishedAt) };
}

function copyLink(link: SongPublicLinkRecord | null): SongPublicLinkRecord | null {
  return link
    ? {
        ...link,
        enabledAt: new Date(link.enabledAt),
        disabledAt: copyDate(link.disabledAt),
        createdAt: new Date(link.createdAt),
        updatedAt: new Date(link.updatedAt),
      }
    : null;
}

function copyEvent(event: SongPublicAccessAuditEvent): SongPublicAccessAuditEvent {
  return { ...event, createdAt: new Date(event.createdAt) };
}

function copyState(state: MemoryState): MemoryState {
  return {
    track: copyTrack(state.track),
    projectUpdatedAt: new Date(state.projectUpdatedAt),
    link: copyLink(state.link),
    remainingAudioCount: state.remainingAudioCount,
    events: state.events.map(copyEvent),
  };
}

class MemoryRepository implements SongPublicationRepository {
  state: MemoryState;
  failNextAppend = false;
  failNextLinkWrite = false;
  operationLookups = 0;

  constructor(overrides: Partial<MemoryState> = {}) {
    this.state = {
      track: {
        id: TRACK_ID,
        purchaseId: PURCHASE_ID,
        producerId: PRODUCER_ID,
        portfolioPublishedAt: null,
      },
      projectUpdatedAt: new Date("2026-07-19T10:00:00.000Z"),
      link: null,
      remainingAudioCount: 2,
      events: [],
      ...overrides,
    };
  }

  async atomically<T>(
    scope: SongPublicationAtomicScope,
    work: (transaction: SongPublicationTransaction) => Promise<T>,
  ): Promise<T> {
    const draft = copyState(this.state);
    const transaction: SongPublicationTransaction = {
      loadSnapshot: () =>
        Promise.resolve({
          track: copyTrack(draft.track),
          projectUpdatedAt: new Date(draft.projectUpdatedAt),
          link: copyLink(draft.link),
          remainingAudioCount: draft.remainingAudioCount,
          lastEventSequence: draft.events.at(-1)?.sequence ?? 0,
          lastEventCreatedAt: copyDate(draft.events.at(-1)?.createdAt ?? null),
        } satisfies SongPublicationSnapshot),
      findEventByOperationKey: (operationKey) => {
        this.operationLookups += 1;
        const event = draft.events.find((candidate) => candidate.operationKey === operationKey);
        return Promise.resolve(event ? copyEvent(event) : null);
      },
      insertLink: (input) => {
        if (this.failNextLinkWrite) {
          this.failNextLinkWrite = false;
          return Promise.resolve(null);
        }
        if (draft.link) return Promise.resolve(null);
        draft.link = copyLink(input);
        return Promise.resolve(copyLink(draft.link));
      },
      updateLink: (input) => {
        if (this.failNextLinkWrite) {
          this.failNextLinkWrite = false;
          return Promise.resolve(null);
        }
        if (
          !draft.link ||
          draft.link.id !== input.linkId ||
          draft.link.tokenVersion !== input.expectedTokenVersion ||
          draft.link.disabledAt?.getTime() !== input.expectedDisabledAt?.getTime()
        ) {
          return Promise.resolve(null);
        }
        draft.link = copyLink(input.next);
        return Promise.resolve(copyLink(draft.link));
      },
      setPortfolioPublishedAt: (input) => {
        if (
          draft.track.portfolioPublishedAt?.getTime() !==
          input.expectedPortfolioPublishedAt?.getTime()
        ) {
          return Promise.resolve(null);
        }
        draft.track = {
          ...draft.track,
          portfolioPublishedAt: copyDate(input.portfolioPublishedAt),
        };
        draft.projectUpdatedAt = new Date(input.changedAt);
        return Promise.resolve(copyTrack(draft.track));
      },
      appendAuditEvent: (event) => {
        if (this.failNextAppend) {
          this.failNextAppend = false;
          return Promise.resolve(null);
        }
        if (
          draft.events.some(
            (candidate) =>
              candidate.operationKey === event.operationKey ||
              candidate.sequence === event.sequence,
          )
        ) {
          return Promise.resolve(null);
        }
        draft.events.push(copyEvent(event));
        return Promise.resolve(copyEvent(event));
      },
    };

    // The service independently verifies the record resolved from this scope.
    void scope;
    const result = await work(transaction);
    this.state = draft;
    return result;
  }
}

function command(operationKey: string, overrides: Partial<ProducerSongPublicationCommand> = {}) {
  return {
    producerId: PRODUCER_ID,
    trackId: TRACK_ID,
    operationKey,
    changedByClerkUserId: ACTOR_ID,
    occurredAt: NOW,
    ...overrides,
  } satisfies ProducerSongPublicationCommand;
}

const options = { tokenSecret: SECRET, createLinkId: () => LINK_ID } as const;

function tokenFromUrl(url: string | null): string {
  if (url === null) throw new Error("Expected a live public URL");
  expect(url).toMatch(/^\/listen\//);
  return url.slice("/listen/".length);
}

describe("producer song-publication operations", () => {
  it("publishes one deterministic live link and an ordered audit snapshot", async () => {
    const repository = new MemoryRepository();
    const result = await publishSongPublicLink(repository, command("publish-1"), options);
    const token = tokenFromUrl(result.state.publicUrl);

    expect(result).toMatchObject({
      replayed: false,
      state: {
        linkId: LINK_ID,
        linkEnabled: true,
        portfolioPublished: false,
        remainingAudioCount: 2,
        tokenVersion: 1,
      },
      event: {
        action: "link_published",
        sequence: 1,
        changed: true,
        linkEnabled: true,
        portfolioPublished: false,
        remainingAudioCount: 2,
        operationKey: "publish-1",
      },
    });
    expect(result.state.tokenHash).toBe(hashSongPublicToken(token));
    expect(verifySongPublicToken(SECRET, token)).toMatchObject({ linkId: LINK_ID, tokenVersion: 1 });
    expect(repository.state.events).toHaveLength(1);
  });

  it("requires completed stored audio before publishing or making the portfolio public", async () => {
    const repository = new MemoryRepository({ remainingAudioCount: 0 });

    await expect(
      publishSongPublicLink(repository, command("publish-empty"), options),
    ).rejects.toMatchObject({ code: "NO_STORED_AUDIO" });
    await expect(
      setPortfolioPublic(
        repository,
        { ...command("portfolio-empty"), published: true },
        options,
      ),
    ).rejects.toMatchObject({ code: "NO_STORED_AUDIO" });
    expect(repository.state.link).toBeNull();
    expect(repository.state.events).toHaveLength(0);
  });

  it("replays the same operation without another write and rejects key reuse for another command", async () => {
    const repository = new MemoryRepository();
    const first = await publishSongPublicLink(repository, command("same-key"), options);
    const replay = await publishSongPublicLink(
      repository,
      command("same-key", { occurredAt: new Date("2026-07-21T10:00:00.000Z") }),
      options,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.state.publicUrl).toBe(first.state.publicUrl);
    expect(repository.state.events).toHaveLength(1);
    await expect(
      disableSongPublicLink(repository, command("same-key"), options),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });
    expect(repository.state.events).toHaveLength(1);
  });

  it("resets to a new generation so the old URL hash stops matching immediately", async () => {
    const repository = new MemoryRepository();
    const published = await publishSongPublicLink(repository, command("publish"), options);
    const oldToken = tokenFromUrl(published.state.publicUrl);
    const reset = await resetSongPublicLink(
      repository,
      command("reset", { occurredAt: new Date("2026-07-20T10:01:00.000Z") }),
      options,
    );
    const newToken = tokenFromUrl(reset.state.publicUrl);

    expect(reset.state.tokenVersion).toBe(2);
    expect(newToken).not.toBe(oldToken);
    expect(hashSongPublicToken(oldToken)).not.toBe(reset.state.tokenHash);
    expect(hashSongPublicToken(newToken)).toBe(reset.state.tokenHash);
    expect(repository.state.events.map((event) => [event.action, event.sequence])).toEqual([
      ["link_published", 1],
      ["link_reset", 2],
    ]);
  });

  it("commits monotonic state and audit times when older requests acquire the lock later", async () => {
    const latestCommittedTime = new Date("2026-07-20T10:06:00.000Z");
    const repository = new MemoryRepository({ projectUpdatedAt: latestCommittedTime });
    const latestRequestTime = new Date("2026-07-20T10:05:00.000Z");
    await publishSongPublicLink(
      repository,
      command("publish-latest", { occurredAt: latestRequestTime }),
      options,
    );
    await disableSongPublicLink(
      repository,
      command("disable-older", { occurredAt: new Date("2026-07-20T10:04:00.000Z") }),
      options,
    );
    await publishSongPublicLink(
      repository,
      command("republish-oldest", { occurredAt: new Date("2026-07-20T10:03:00.000Z") }),
      options,
    );
    await resetSongPublicLink(
      repository,
      command("reset-oldest", { occurredAt: new Date("2026-07-20T10:02:00.000Z") }),
      options,
    );

    expect(repository.state.link).toMatchObject({
      disabledAt: null,
      enabledAt: latestCommittedTime,
      updatedAt: latestCommittedTime,
      tokenVersion: 3,
    });
    expect(repository.state.events.map((event) => event.createdAt.getTime())).toEqual([
      latestCommittedTime.getTime(),
      latestCommittedTime.getTime(),
      latestCommittedTime.getTime(),
      latestCommittedTime.getTime(),
    ]);
    expect(repository.state.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("does not regress the project update time when an older portfolio request runs later", async () => {
    const latestProjectUpdate = new Date("2026-07-20T10:06:00.000Z");
    const repository = new MemoryRepository({ projectUpdatedAt: latestProjectUpdate });

    await setPortfolioPublic(
      repository,
      {
        ...command("portfolio-after-project-update"),
        occurredAt: new Date("2026-07-20T10:05:00.000Z"),
        published: true,
      },
      options,
    );

    expect(repository.state.track.portfolioPublishedAt).toEqual(latestProjectUpdate);
    expect(repository.state.projectUpdatedAt).toEqual(latestProjectUpdate);
    expect(repository.state.events[0]?.createdAt).toEqual(latestProjectUpdate);
  });

  it("disables only the standalone link and rotates before republishing it", async () => {
    const repository = new MemoryRepository();
    const published = await publishSongPublicLink(repository, command("publish"), options);
    await setPortfolioPublic(repository, { ...command("portfolio-on"), published: true }, options);
    const disabled = await disableSongPublicLink(
      repository,
      command("disable", { occurredAt: new Date("2026-07-20T10:02:00.000Z") }),
      options,
    );

    expect(disabled.state).toMatchObject({
      linkEnabled: false,
      publicUrl: null,
      portfolioPublished: true,
      tokenVersion: 1,
    });
    const republished = await publishSongPublicLink(
      repository,
      command("republish", { occurredAt: new Date("2026-07-20T10:03:00.000Z") }),
      options,
    );
    const oldToken = tokenFromUrl(published.state.publicUrl);
    const newToken = tokenFromUrl(republished.state.publicUrl);
    expect(newToken).not.toBe(oldToken);
    expect(republished.state.tokenVersion).toBe(2);
    expect(hashSongPublicToken(oldToken)).not.toBe(republished.state.tokenHash);
    expect(hashSongPublicToken(newToken)).toBe(republished.state.tokenHash);
    expect(republished.state.portfolioPublished).toBe(true);
  });

  it("does not let Artist link creation reverse a Producer disable", async () => {
    const repository = new MemoryRepository();
    await publishSongPublicLink(repository, command("publish-before-disable"), options);
    await disableSongPublicLink(repository, command("producer-disable"), options);

    await expect(
      publishSongPublicLink(repository, command("artist-publish"), {
        ...options,
        canEnableDisabledLink: false,
      }),
    ).rejects.toMatchObject({ code: "LINK_NOT_LIVE" });
    expect(repository.state.link?.disabledAt).not.toBeNull();
    expect(repository.state.events).toHaveLength(2);
  });

  it("publishes and unpublishes the portfolio without creating or mutating a link", async () => {
    const repository = new MemoryRepository();
    const on = await setPortfolioPublic(
      repository,
      { ...command("portfolio-on"), published: true },
      options,
    );
    const retryWithNewKey = await setPortfolioPublic(
      repository,
      { ...command("portfolio-on-again"), published: true },
      options,
    );
    const off = await setPortfolioPublic(
      repository,
      { ...command("portfolio-off"), published: false },
      options,
    );

    expect(on.state).toMatchObject({ linkId: null, publicUrl: null, portfolioPublished: true });
    expect(retryWithNewKey.event.changed).toBe(false);
    expect(off.state).toMatchObject({ linkId: null, publicUrl: null, portfolioPublished: false });
    expect(repository.state.link).toBeNull();
    expect(repository.state.events.map((event) => [event.action, event.sequence, event.changed])).toEqual([
      ["portfolio_published", 1, true],
      ["portfolio_published", 2, false],
      ["portfolio_unpublished", 3, true],
    ]);
  });

  it("checks ownership before operation lookup and fails foreign ids generically", async () => {
    const repository = new MemoryRepository();

    await expect(
      publishSongPublicLink(
        repository,
        command("foreign", { producerId: "99999999-9999-4999-8999-999999999999" }),
        options,
      ),
    ).rejects.toMatchObject({
      name: "SongPublicationDomainError",
      code: "NOT_FOUND",
      message: "The song publication target was not found",
    });
    expect(repository.operationLookups).toBe(0);
    expect(repository.state.events).toHaveLength(0);
  });

  it("rolls back link changes when the append-only audit write loses a race", async () => {
    const repository = new MemoryRepository();
    repository.failNextAppend = true;

    await expect(
      publishSongPublicLink(repository, command("racing-publish"), options),
    ).rejects.toMatchObject({ code: "CONCURRENT_CHANGE" });
    expect(repository.state.link).toBeNull();
    expect(repository.state.events).toHaveLength(0);
  });

  it("rejects a reset after disable without generating a replacement token", async () => {
    const repository = new MemoryRepository();
    await publishSongPublicLink(repository, command("publish"), options);
    await disableSongPublicLink(repository, command("disable"), options);

    await expect(resetSongPublicLink(repository, command("reset-disabled"), options)).rejects.toMatchObject({
      code: "LINK_NOT_LIVE",
    });
    expect(repository.state.link?.tokenVersion).toBe(1);
    expect(repository.state.events).toHaveLength(2);
  });
});
