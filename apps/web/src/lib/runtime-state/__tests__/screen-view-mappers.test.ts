import { describe, expect, it } from "vitest";

import {
  SCREEN_VIEW_MAPPER_LIMITS,
  mapArtistHomeSafeScreen,
  mapArtistMusicSafeScreen,
  mapArtistStoreSafeScreen,
  mapProducerMusicSafeScreen,
  mapProducerOverviewSafeScreen,
  mapProducerWorkspaceSafeScreen,
} from "../screen-view-mappers";

const FORBIDDEN_SENTINELS = [
  "secret-email@example.com",
  "+972-555-SECRET",
  "PRIVATE CLIENT NOTE",
  "VIP-TAG-SECRET",
  "987654321-cents",
  "https://signed.example/private-audio",
  "/live/action/secret",
  "purchase-secret-id",
  "entitlement-secret-id",
  "session-secret-id",
  "payment-secret-id",
  "booking-secret-id",
  "private-offer-secret",
  "project-a",
  "version-a",
  "client-a",
  "track-a",
  "studio-a",
  "mix-a",
  "product-a",
] as const;

function expectNoForbiddenData(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of FORBIDDEN_SENTINELS) {
    expect(serialized).not.toContain(sentinel);
  }
  for (const forbiddenKey of [
    "email",
    "phone",
    "notes",
    "tags",
    "price",
    "money",
    "audioUrl",
    "actionHref",
    "purchaseId",
    "entitlement",
    "session",
    "payment",
    "booking",
    "privateOffer",
  ]) {
    expect(serialized).not.toContain(`"${forbiddenKey}"`);
  }
}

describe("safe screen view mappers", () => {
  it("maps only approved producer overview metadata", () => {
    const input = {
      displayName: "Gili Studio",
      activeProjects: 4,
      urgentProjects: [
        {
          id: "project-a",
          title: "Northern Lights",
          clientName: "Maya",
          stage: "mixing",
          urgency: "overdue",
          payment: "payment-secret-id",
          booking: "booking-secret-id",
          actionHref: "/live/action/secret",
        },
      ],
      recentUploads: [
        {
          versionId: "version-a",
          title: "Final Chorus",
          versionLabel: "V4",
          projectClientName: "Maya",
          audioUrl: "https://signed.example/private-audio",
          sessionId: "session-secret-id",
        },
      ],
      paymentBalance: "987654321-cents",
    };

    const result = mapProducerOverviewSafeScreen(input);

    expect(result).toMatchObject({
      kind: "producer-overview",
      metrics: [
        { label: "Active projects", value: "4" },
        { label: "Need attention", value: "1" },
        { label: "Recent uploads", value: "1" },
      ],
    });
    expect(result.sections[0]?.items[0]).toMatchObject({
      key: "urgent-0",
      title: "Northern Lights",
      detail: "Maya",
      badge: "Overdue",
    });
    expect(result.sections[1]?.items[0]).toMatchObject({
      key: "upload-0",
      title: "Final Chorus",
      badge: "V4",
    });
    expectNoForbiddenData(result);
  });

  it("drops contact, notes, tags, commercial values, and actions from producer workspace", () => {
    const input = {
      projects: [
        {
          id: "project-a",
          title: "Glass House",
          client: "Noa",
          status: "On track",
          deadline: "Aug 2",
          clientEmail: "secret-email@example.com",
          balance: "987654321-cents",
          actionHref: "/live/action/secret",
        },
      ],
      clients: [
        {
          id: "client-a",
          name: "Noa",
          projects: 2,
          needsAttention: true,
          email: "secret-email@example.com",
          phone: "+972-555-SECRET",
          notes: "PRIVATE CLIENT NOTE",
          tags: ["VIP-TAG-SECRET"],
          lifetime: "987654321-cents",
        },
      ],
      needsAttentionCount: 1,
    };
    const result = mapProducerWorkspaceSafeScreen(input);

    expect(result.kind).toBe("producer-workspace");
    expect(result.sections[0]?.items[0]).toEqual({
      key: "project-0",
      title: "Glass House",
      detail: "Noa · Aug 2",
      badge: "On Track",
    });
    expect(result.sections[1]?.items[0]).toEqual({
      key: "client-0",
      title: "Noa",
      detail: "2 projects",
      badge: "Needs attention",
    });
    expectNoForbiddenData(result);
  });

  it.each([
    ["producer", mapProducerMusicSafeScreen, "producer-music"],
    ["artist", mapArtistMusicSafeScreen, "artist-music"],
  ] as const)(
    "maps %s music without audio, actions, purchases, or entitlements",
    (_role, mapper, kind) => {
      const input = {
        projects: [
          {
            id: "project-a",
            title: "Afterglow",
            artistLabel: "Maya",
            visibleSpaceCount: 2,
            projectLifecycleStatus: "active",
            privateOfferId: "private-offer-secret",
          },
        ],
        tracks: [
          {
            kind: "track",
            id: "row-a",
            trackId: "track-a",
            trackTitle: "Gold",
            trackArtist: "Maya",
            projectTitle: "Afterglow",
            label: "V3",
            audioUrl: "https://signed.example/private-audio",
            actionHref: "/live/action/secret",
            purchaseId: "purchase-secret-id",
          },
          {
            kind: "empty-slot",
            id: "slot-a",
            trackTitle: "Purchased song",
            projectTitle: "Afterglow",
            purchaseId: "purchase-secret-id",
            entitlementId: "entitlement-secret-id",
          },
        ],
      } as const;
      const result = mapper(input);

      expect(result.kind).toBe(kind);
      expect(result.sections[1]?.items).toHaveLength(1);
      expect(result.sections[1]?.items[0]).toMatchObject({
        key: "song-0",
        title: "Gold",
        detail: "Maya · Afterglow",
        badge: "V3",
      });
      expectNoForbiddenData(result);
    },
  );

  it("maps artist home without audio, session, booking, or payment data", () => {
    const input = {
      firstName: "Maya",
      studios: [
        {
          producerId: "studio-a",
          producerName: "North Studio",
          bookingId: "booking-secret-id",
          paymentId: "payment-secret-id",
        },
      ],
      latestMix: {
        id: "mix-a",
        trackTitle: "Gold",
        producerName: "North Studio",
        label: "V3",
        audioUrl: "https://signed.example/private-audio",
        sessionId: "session-secret-id",
        actionHref: "/live/action/secret",
      },
      nextSession: "session-secret-id",
      payment: "payment-secret-id",
    };
    const result = mapArtistHomeSafeScreen(input);

    expect(result).toMatchObject({
      kind: "artist-home",
      title: "Hi, Maya",
    });
    expect(result.sections[0]?.items[0]).toEqual({
      key: "latest-mix-0",
      title: "Gold",
      detail: "North Studio",
      badge: "V3",
    });
    expectNoForbiddenData(result);
  });

  it("maps artist store labels without price, purchase, or private-offer data", () => {
    const input = {
      studioName: "North Studio",
      products: [
        {
          id: "product-a",
          name: "Mix",
          description: "A focused stereo mix",
          type: "mix",
          priceCents: "987654321-cents",
          purchaseId: "purchase-secret-id",
          actionHref: "/live/action/secret",
          privateOfferId: "private-offer-secret",
        },
      ],
    };
    const result = mapArtistStoreSafeScreen(input);

    expect(result).toEqual({
      kind: "artist-store",
      title: "Store",
      subtitle: "North Studio",
      metrics: [{ label: "Products", value: "1" }],
      sections: [
        {
          label: "Catalog",
          items: [
            {
              key: "store-product-0",
              title: "Mix",
              detail: "A focused stereo mix",
              badge: "Mix",
            },
          ],
        },
      ],
    });
    expectNoForbiddenData(result);
  });

  it("caps collections and every string at the runtime safe-view bounds", () => {
    const huge = "x".repeat(1_000);
    const projects = Array.from({ length: 100 }, (_, index) => ({
      id: `${huge}-${String(index)}`,
      title: `${huge}-${String(index)}`,
      artistLabel: huge,
      visibleSpaceCount: index,
      projectLifecycleStatus: huge,
    }));
    const tracks = Array.from({ length: 100 }, (_, index) => ({
      kind: "track" as const,
      id: `row-${String(index)}`,
      trackId: `${huge}-${String(index)}`,
      trackTitle: `${huge}-${String(index)}`,
      trackArtist: huge,
      projectTitle: huge,
      label: huge,
    }));

    const result = mapProducerMusicSafeScreen({ projects, tracks });
    const items = result.sections.flatMap((section) => section.items);

    expect(result.metrics.length).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.metrics);
    expect(result.sections.length).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.sections);
    expect(items.length).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.totalItems);
    for (const section of result.sections) {
      expect(section.label.length).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.label);
      expect(section.items.length).toBeLessThanOrEqual(
        SCREEN_VIEW_MAPPER_LIMITS.itemsPerSection,
      );
    }
    for (const item of items) {
      expect(item.key.length).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.key);
      expect(item.title.length).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.title);
      expect(item.detail?.length ?? 0).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.detail);
      expect(item.badge?.length ?? 0).toBeLessThanOrEqual(SCREEN_VIEW_MAPPER_LIMITS.badge);
    }
  });
});
