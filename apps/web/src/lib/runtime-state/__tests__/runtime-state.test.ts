import { describe, expect, it } from "vitest";

import {
  RUNTIME_DRAFT_MAX_AGE_MS,
  RUNTIME_STATE_SCHEMA_VERSION,
  RUNTIME_VIEW_MAX_AGE_MS,
  buildRuntimeStorageKey,
  clearRuntimeStateForUser,
  normalizeRuntimeHref,
  pruneRuntimeSafeViews,
  readRuntimeState,
  runtimeScope,
  writeRuntimeState,
  type ProducerPrivateOfferDraft,
  type ProducerStoreProductDraft,
  type RuntimeSlot,
} from "../runtime-state";

import { MemoryStorage } from "./memory-storage";

function requiredScope(
  userId = "user-a",
  role: "producer" | "artist" = "producer",
  contextId = "producer-a",
  href = "/dashboard",
) {
  const scope = runtimeScope(userId, role, contextId, href);
  if (!scope) throw new Error("Expected a valid runtime scope");
  return scope;
}

function storeProductDraft(): ProducerStoreProductDraft {
  return {
    open: true,
    mode: "new",
    productId: null,
    currentStep: "rights",
    draft: {
      _picked: "production",
      _legacyAgreementLink: false,
      name: "Production",
      tagline: "A complete production",
      type: "production",
      price: 2_500,
      currency: "USD",
      includesSessions: true,
      sessions: 8,
      unlimitedSessions: false,
      bookingEnabled: true,
      payment: {
        full: true,
        split50: true,
        monthly: false,
        monthlyInstallments: 4,
      },
      includes: ["Mix", "Master"],
      duration: "60 min",
      revisions: 3,
      unlimitedRevisions: false,
      agreementMode: "text",
      agreementText: "Exact terms",
      royalty: {
        masterMode: "none",
        masterPercentage: "",
        compositionMode: "percentage",
        compositionPercentage: "10",
        compositionRole: "composer",
        collectingSociety: "",
        notes: "",
      },
      pricingModel: "flat",
      volumeTiers: [],
    },
  };
}

function privateOfferDraft(
  overrides: Partial<ProducerPrivateOfferDraft> = {},
): ProducerPrivateOfferDraft {
  return {
    version: 1,
    entryKey: "new:store",
    mode: "new",
    existingOfferId: null,
    expectedUpdatedAt: null,
    currentStep: "recipient",
    draftJson: JSON.stringify({ recipientKind: "existing", selectedClientId: "client-a" }),
    submissionOfferId: null,
    ...overrides,
  };
}

describe("account-scoped runtime storage", () => {
  it("puts every required privacy dimension in the key", () => {
    const key = buildRuntimeStorageKey(
      requiredScope("clerk/user", "producer", "studio:one", "/dashboard?view=all"),
      "producer.overview.safe-view",
    );

    expect(key).toContain("user=clerk%2Fuser");
    expect(key).toContain(`schema=${String(RUNTIME_STATE_SCHEMA_VERSION)}`);
    expect(key).toContain("role=producer");
    expect(key).toContain("context=studio%3Aone");
    expect(key).toContain("route=%2Fdashboard%3Fview%3Dall");
    expect(key).toContain("slot=producer.overview.safe-view");
  });

  it("never lets another Clerk account, role, context, or route read a view", () => {
    const storage = new MemoryStorage();
    const owner = requiredScope();
    expect(
      writeRuntimeState(storage, owner, "producer.overview.safe-view", {
        displayName: "Owner",
        activeProjects: 3,
      }),
    ).toBe(true);

    const otherScopes = [
      requiredScope("user-b"),
      requiredScope("user-a", "producer", "producer-b"),
      requiredScope("user-a", "producer", "producer-a", "/dashboard?view=all"),
      requiredScope("user-a", "artist", "producer-a", "/artist"),
    ];
    for (const scope of otherScopes) {
      expect(readRuntimeState(storage, scope, "producer.overview.safe-view")).toBeNull();
    }
    expect(readRuntimeState(storage, owner, "producer.overview.safe-view")).toEqual({
      displayName: "Owner",
      activeProjects: 3,
    });
  });

  it("clears the previous user synchronously without touching another user", () => {
    const storage = new MemoryStorage();
    const first = requiredScope("user-a");
    const second = requiredScope("user-b");
    writeRuntimeState(storage, first, "producer.overview.safe-view", {
      displayName: "First",
      activeProjects: 1,
    });
    writeRuntimeState(storage, second, "producer.overview.safe-view", {
      displayName: "Second",
      activeProjects: 2,
    });

    expect(clearRuntimeStateForUser(storage, "user-a")).toBe(1);
    expect(readRuntimeState(storage, first, "producer.overview.safe-view")).toBeNull();
    expect(readRuntimeState(storage, second, "producer.overview.safe-view")).toEqual({
      displayName: "Second",
      activeProjects: 2,
    });
  });

  it("rejects unknown slots and payloads containing forbidden extra fields", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope();
    expect(() => buildRuntimeStorageKey(scope, "payment.snapshot" as RuntimeSlot)).toThrow();

    expect(
      writeRuntimeState(storage, scope, "producer.overview.safe-view", {
        displayName: "Studio",
        activeProjects: 1,
        paymentInstructions: "secret",
      } as never),
    ).toBe(false);

    const artistHome = requiredScope(
      "artist-user",
      "artist",
      "studio-a",
      "/artist?studio=studio-a",
    );
    expect(
      writeRuntimeState(storage, artistHome, "artist.home.safe-view", {
        firstName: "Artist",
        studios: [],
        paymentBalance: 10_000,
        bookingId: "booking-a",
        audioUrl: "https://signed.example/audio",
      } as never),
    ).toBe(false);

    const producerMusic = requiredScope(
      "producer-user",
      "producer",
      "producer-a",
      "/dashboard/music?mode=songs&view=table",
    );
    expect(
      writeRuntimeState(storage, producerMusic, "producer.music.safe-view", {
        projectCount: 2,
        songCount: 8,
        archivedSongCount: 1,
        audioUrl: "https://signed.example/private-audio",
      } as never),
    ).toBe(false);

    const artistMusic = requiredScope(
      "artist-user",
      "artist",
      "studio-a",
      "/artist/music?studio=studio-a",
    );
    expect(
      writeRuntimeState(storage, artistMusic, "artist.music.safe-view", {
        mode: "songs",
        view: "table",
        search: "",
        sort: "recent",
        archive: "active",
        projectCount: 2,
        songCount: 8,
        signedUrl: "https://signed.example/private-audio",
      } as never),
    ).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("rejects a forged envelope whose echoed scope does not match its key", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope();
    const key = buildRuntimeStorageKey(scope, "producer.overview.safe-view");
    storage.setItem(
      key,
      JSON.stringify({
        schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
        scope: { ...scope, userId: "other-user" },
        slot: "producer.overview.safe-view",
        updatedAt: 10,
        payload: { displayName: "Leaked", activeProjects: 1 },
      }),
    );

    expect(readRuntimeState(storage, scope, "producer.overview.safe-view", 10)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it("expires views after seven days and drafts after 30 days", () => {
    const storage = new MemoryStorage();
    const viewScope = requiredScope();
    const draftScope = requiredScope(
      "user-a",
      "producer",
      "producer-a",
      "/dashboard/settings?section=profile",
    );
    writeRuntimeState(
      storage,
      viewScope,
      "producer.overview.safe-view",
      { displayName: "Studio", activeProjects: 1 },
      1,
    );
    writeRuntimeState(
      storage,
      draftScope,
      "producer.settings.display-name-draft",
      { displayName: "Draft" },
      1,
    );

    expect(
      readRuntimeState(
        storage,
        viewScope,
        "producer.overview.safe-view",
        1 + RUNTIME_VIEW_MAX_AGE_MS,
      ),
    ).not.toBeNull();
    expect(
      readRuntimeState(
        storage,
        viewScope,
        "producer.overview.safe-view",
        2 + RUNTIME_VIEW_MAX_AGE_MS,
      ),
    ).toBeNull();
    expect(
      readRuntimeState(
        storage,
        draftScope,
        "producer.settings.display-name-draft",
        1 + RUNTIME_DRAFT_MAX_AGE_MS,
      ),
    ).not.toBeNull();
    expect(
      readRuntimeState(
        storage,
        draftScope,
        "producer.settings.display-name-draft",
        2 + RUNTIME_DRAFT_MAX_AGE_MS,
      ),
    ).toBeNull();
  });

  it("stores an exact account-scoped product-editor draft for 30 days", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user-a", "producer", "producer-a", "/dashboard/store");
    const draft = storeProductDraft();

    expect(writeRuntimeState(storage, scope, "producer.store.product-draft", draft, 1)).toBe(true);
    expect(
      readRuntimeState(
        storage,
        scope,
        "producer.store.product-draft",
        1 + RUNTIME_DRAFT_MAX_AGE_MS,
      ),
    ).toEqual(draft);
    expect(
      readRuntimeState(
        storage,
        scope,
        "producer.store.product-draft",
        2 + RUNTIME_DRAFT_MAX_AGE_MS,
      ),
    ).toBeNull();
  });

  it("keeps pre-SK-155 Store drafts readable so the editor can normalize them", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user-a", "producer", "producer-a", "/dashboard/store");
    const legacy = storeProductDraft() as ProducerStoreProductDraft & {
      draft: ProducerStoreProductDraft["draft"] & { includesSessions?: boolean };
    };
    delete legacy.draft.includesSessions;

    expect(
      writeRuntimeState(
        storage,
        scope,
        "producer.store.product-draft",
        legacy as ProducerStoreProductDraft,
        1,
      ),
    ).toBe(true);
    expect(
      readRuntimeState(storage, scope, "producer.store.product-draft", 2),
    ).toMatchObject({
      mode: "new",
      draft: { duration: "60 min" },
    });
  });

  it("keeps drafts saved before booking permission was added readable", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user-a", "producer", "producer-a", "/dashboard/store");
    const legacy = storeProductDraft();
    delete legacy.draft.bookingEnabled;

    expect(
      writeRuntimeState(storage, scope, "producer.store.product-draft", legacy, 1),
    ).toBe(true);
    expect(
      readRuntimeState(storage, scope, "producer.store.product-draft", 2),
    ).toMatchObject({
      mode: "new",
      draft: { duration: "60 min" },
    });
  });

  it("keeps drafts missing both newer session flags readable", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user-a", "producer", "producer-a", "/dashboard/store");
    const legacy = storeProductDraft();
    delete legacy.draft.includesSessions;
    delete legacy.draft.bookingEnabled;

    expect(
      writeRuntimeState(storage, scope, "producer.store.product-draft", legacy, 1),
    ).toBe(true);
    expect(
      readRuntimeState(storage, scope, "producer.store.product-draft", 2),
    ).toMatchObject({
      mode: "new",
      draft: { duration: "60 min" },
    });
  });

  it("rejects transaction, URL, token, and extra fields in product-editor drafts", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user-a", "producer", "producer-a", "/dashboard/store");
    const draft = storeProductDraft();

    expect(
      writeRuntimeState(storage, scope, "producer.store.product-draft", {
        ...draft,
        paymentIntentId: "secret",
      } as never),
    ).toBe(false);
    expect(
      writeRuntimeState(storage, scope, "producer.store.product-draft", {
        ...draft,
        draft: {
          ...draft.draft,
          signedUrl: "https://signed.example/private",
        },
      } as never),
    ).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("stores an exact account-scoped private-offer draft for 30 days", () => {
    const storage = new MemoryStorage();
    const owner = requiredScope("user-a", "producer", "producer-a", "/dashboard/store");
    const draft = privateOfferDraft();

    expect(writeRuntimeState(storage, owner, "producer.private-offer.draft", draft, 1)).toBe(
      true,
    );
    expect(
      readRuntimeState(
        storage,
        owner,
        "producer.private-offer.draft",
        1 + RUNTIME_DRAFT_MAX_AGE_MS,
      ),
    ).toEqual(draft);
    expect(
      readRuntimeState(
        storage,
        requiredScope("user-b", "producer", "producer-a", "/dashboard/store"),
        "producer.private-offer.draft",
        2,
      ),
    ).toBeNull();
    expect(
      readRuntimeState(
        storage,
        requiredScope("user-a", "producer", "producer-b", "/dashboard/store"),
        "producer.private-offer.draft",
        2,
      ),
    ).toBeNull();
    expect(
      readRuntimeState(
        storage,
        requiredScope(
          "user-a",
          "producer",
          "producer-a",
          "/dashboard/clients-projects/clients/client-a",
        ),
        "producer.private-offer.draft",
        2,
      ),
    ).toBeNull();
    expect(
      readRuntimeState(
        storage,
        owner,
        "producer.private-offer.draft",
        2 + RUNTIME_DRAFT_MAX_AGE_MS,
      ),
    ).toBeNull();
  });

  it("bounds every private-offer draft field and rejects extra keys", () => {
    const scope = requiredScope("user-a", "producer", "producer-a", "/dashboard/store");
    const invalidDrafts: unknown[] = [
      { ...privateOfferDraft(), paymentIntentId: "secret" },
      privateOfferDraft({ entryKey: "k".repeat(513) }),
      privateOfferDraft({ currentStep: "s".repeat(129) }),
      privateOfferDraft({ draftJson: "d".repeat(200_001) }),
      privateOfferDraft({ submissionOfferId: "o".repeat(129) }),
      privateOfferDraft({
        mode: "edit",
        existingOfferId: "o".repeat(129),
        expectedUpdatedAt: "2026-08-11T00:00:00.000Z",
      }),
      privateOfferDraft({
        mode: "edit",
        existingOfferId: "offer-a",
        expectedUpdatedAt: "t".repeat(129),
      }),
    ];

    for (const invalidDraft of invalidDrafts) {
      const storage = new MemoryStorage();
      expect(
        writeRuntimeState(
          storage,
          scope,
          "producer.private-offer.draft",
          invalidDraft as ProducerPrivateOfferDraft,
        ),
      ).toBe(false);
      expect(storage.length).toBe(0);
    }
  });

  it("allows private-offer drafts only on Store and client-detail composer routes", () => {
    const allowedScopes = [
      requiredScope("user-a", "producer", "producer-a", "/dashboard/store"),
      requiredScope(
        "user-a",
        "producer",
        "producer-a",
        "/dashboard/clients-projects/clients/client-a",
      ),
    ];
    for (const scope of allowedScopes) {
      expect(() => buildRuntimeStorageKey(scope, "producer.private-offer.draft")).not.toThrow();
    }

    const deniedScopes = [
      requiredScope("user-a", "producer", "producer-a", "/dashboard/clients-projects"),
      requiredScope(
        "user-a",
        "producer",
        "producer-a",
        "/dashboard/clients-projects/project-a",
      ),
      requiredScope("artist-a", "artist", "producer-a", "/artist/store"),
    ];
    for (const scope of deniedScopes) {
      expect(() => buildRuntimeStorageKey(scope, "producer.private-offer.draft")).toThrow();
    }
  });

  it("caps safe views to the 20 newest route states per role and context", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 21; index += 1) {
      const scope = requiredScope(
        "user-a",
        "producer",
        "producer-a",
        `/dashboard/clients-projects?search=${String(index)}`,
      );
      expect(
        writeRuntimeState(
          storage,
          scope,
          "producer.workspace.safe-view",
          { clientCount: index, projectCount: index, needsAttentionCount: 0 },
          index + 1,
        ),
      ).toBe(true);
    }

    expect(
      pruneRuntimeSafeViews(storage, {
        userId: "user-a",
        role: "producer",
        contextId: "producer-a",
      }),
    ).toBe(1);
    expect(storage.length).toBe(20);
    expect(
      readRuntimeState(
        storage,
        requiredScope("user-a", "producer", "producer-a", "/dashboard/clients-projects?search=0"),
        "producer.workspace.safe-view",
        21,
      ),
    ).toBeNull();
  });
});

describe("route policy", () => {
  it("allows music navigation restoration without permitting audio view payloads", () => {
    const storage = new MemoryStorage();
    const musicScope = requiredScope(
      "artist-a",
      "artist",
      "studio-a",
      "/artist/music/song/version-a?studio=studio-a",
    );

    expect(musicScope.route).toBe("/artist/music/song/version-a?studio=studio-a");
    expect(() => buildRuntimeStorageKey(musicScope, "artist.home.safe-view")).toThrow();
    expect(
      writeRuntimeState(storage, musicScope, "runtime.navigation.snapshot", {
        href: musicScope.route,
        scrollTop: 42,
        filters: [{ key: "studio", value: "studio-a" }],
      }),
    ).toBe(true);
  });

  it.each([
    ["/artist/book", "artist"],
    ["/artist/payments/purchase-a", "artist"],
    ["/artist/purchase/product-a", "artist"],
    ["/artist/sessions/session-a", "artist"],
    ["/artist/offers/offer-a", "artist"],
    ["/artist/music/no-charge/proposal-a", "artist"],
    ["/artist/store/product-a", "artist"],
  ] as const)("denies transactional route persistence for %s", (href, role) => {
    expect(normalizeRuntimeHref(href, role)).toBeNull();
  });

  it("keeps producer calendar and payments navigation payload-free", () => {
    expect(
      normalizeRuntimeHref(
        "/dashboard/calendar?tab=availability&booking=booking-a&token=secret",
        "producer",
      ),
    ).toBe("/dashboard/calendar?tab=availability");
    expect(
      normalizeRuntimeHref(
        "/dashboard/payments/proof-a?proof=private&signedUrl=secret",
        "producer",
      ),
    ).toBe("/dashboard/payments/proof-a");
  });

  it.each([
    ["/dashboard", "producer"],
    ["/dashboard/calendar?tab=sessions", "producer"],
    ["/dashboard/clients-projects?filter=urgent&tab=projects", "producer"],
    ["/dashboard/clients-projects/project-a/songs/song-a", "producer"],
    ["/dashboard/clients-projects/clients/client-a", "producer"],
    ["/dashboard/music?mode=songs&sort=notes&view=table", "producer"],
    ["/dashboard/music/project/project-a", "producer"],
    ["/dashboard/payments/proof-a", "producer"],
    ["/dashboard/portfolio", "producer"],
    ["/dashboard/requests/request-a", "producer"],
    ["/dashboard/settings?section=region", "producer"],
    ["/dashboard/store", "producer"],
    ["/artist?studio=studio-a", "artist"],
    ["/artist/music?filter=archived&mode=songs&studio=studio-a", "artist"],
    ["/artist/music/project-a?studio=studio-a", "artist"],
    ["/artist/music/song/version-a?studio=studio-a", "artist"],
    ["/artist/store?studio=studio-a", "artist"],
    ["/artist/settings?studio=studio-a", "artist"],
  ] as const)("allows the known safe route %s", (href, role) => {
    expect(normalizeRuntimeHref(href, role)).toBe(href);
  });

  it.each([
    ["/dashboard/invented", "producer"],
    ["/dashboard/music/project", "producer"],
    ["/dashboard/clients-projects/clients", "producer"],
    ["/dashboard//music", "producer"],
    ["/artist/invented", "artist"],
    ["/artist/music/song", "artist"],
    ["/artist/listen/token", "artist"],
    ["/listen/token", "artist"],
    ["//evil.example/dashboard", "producer"],
  ] as const)("fails closed for unknown or public route %s", (href, role) => {
    expect(normalizeRuntimeHref(href, role)).toBeNull();
  });

  it("drops non-allowlisted and secret-like query parameters", () => {
    expect(
      normalizeRuntimeHref(
        "/artist/music/song/version-a?studio=studio-a&token=secret&req=purchase-a",
        "artist",
      ),
    ).toBe("/artist/music/song/version-a?studio=studio-a");
  });

  it("isolates safe route views by account, role, context, and exact route", () => {
    const storage = new MemoryStorage();
    const owner = requiredScope(
      "artist-a",
      "artist",
      "studio-a",
      "/artist/music?mode=songs&studio=studio-a",
    );
    const payload = {
      mode: "songs",
      view: "grid",
      search: "",
      sort: "recent",
      archive: "active",
      projectCount: 2,
      songCount: 5,
    } as const;
    expect(writeRuntimeState(storage, owner, "artist.music.safe-view", payload)).toBe(true);

    const otherAccount = requiredScope(
      "artist-b",
      "artist",
      "studio-a",
      "/artist/music?mode=songs&studio=studio-a",
    );
    const otherStudio = requiredScope(
      "artist-a",
      "artist",
      "studio-b",
      "/artist/music?mode=songs&studio=studio-a",
    );
    const otherRoute = requiredScope(
      "artist-a",
      "artist",
      "studio-a",
      "/artist/music?studio=studio-a",
    );

    expect(readRuntimeState(storage, otherAccount, "artist.music.safe-view")).toBeNull();
    expect(readRuntimeState(storage, otherStudio, "artist.music.safe-view")).toBeNull();
    expect(readRuntimeState(storage, otherRoute, "artist.music.safe-view")).toBeNull();
    expect(readRuntimeState(storage, owner, "artist.music.safe-view")).toEqual(payload);
  });

  it("rejects forged navigation filters that are not present in the safe href", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope(
      "artist-a",
      "artist",
      "studio-a",
      "/artist/music/song/version-a?studio=studio-a",
    );
    expect(
      writeRuntimeState(storage, scope, "runtime.navigation.snapshot", {
        href: scope.route,
        scrollTop: 1,
        filters: [{ key: "token", value: "secret" }],
      }),
    ).toBe(false);
  });
});
