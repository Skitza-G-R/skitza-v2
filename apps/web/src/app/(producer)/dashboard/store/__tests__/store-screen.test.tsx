// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrivateOfferTemplateProduct } from "~/components/dashboard/offers/private-offer-template-types";

const mocks = vi.hoisted(() => ({
  composerProps: vi.fn(),
  refresh: vi.fn(),
  removeProduct: vi.fn(),
  reorderProducts: vi.fn(),
  setPackageActive: vi.fn(),
  storeDraft: {
    clear: vi.fn(),
    loaded: true,
    record: null,
    save: vi.fn(),
  },
  toast: vi.fn(),
}));

interface ComposerMockProps {
  onCreated?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocusRef?: { current: HTMLElement | null };
  templateProduct?: PrivateOfferTemplateProduct;
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/store",
  useRouter: () => ({ refresh: mocks.refresh }),
  useSearchParams: () => ({ toString: () => "" }),
}));

vi.mock("~/app/(producer)/dashboard/booking/actions", () => ({
  reorderProducts: mocks.reorderProducts,
  setPackageActive: mocks.setPackageActive,
}));

vi.mock("~/components/dashboard/offers/private-offer-composer", () => ({
  PrivateOfferComposer: (props: ComposerMockProps) => {
    mocks.composerProps(props);
    if (!props.open) return null;

    function closeAndRestoreFocus() {
      const focusTarget = props.returnFocusRef?.current;
      props.onOpenChange(false);
      focusTarget?.focus();
    }

    return (
      <div data-testid="private-offer-composer">
        <span>{props.templateProduct?.source.productName}</span>
        <button type="button" onClick={closeAndRestoreFocus}>
          Close private offer
        </button>
        <button
          type="button"
          onClick={() => {
            props.onCreated?.();
            closeAndRestoreFocus();
          }}
        >
          Complete private offer
        </button>
      </div>
    );
  },
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/runtime-state/use-runtime-state", () => ({
  useProducerStoreProductDraft: () => mocks.storeDraft,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("../artist-store-preview", () => ({ ArtistStorePreview: () => null }));
vi.mock("../product-editor", () => ({ ProductEditor: () => null }));
vi.mock("../product-removal-modal", () => ({ ProductRemovalModal: () => null }));
vi.mock("../use-product-removal", () => ({
  useProductRemoval: () => mocks.removeProduct,
}));

import { StoreScreen, type StoreProduct } from "../store-screen";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-screen.tsx"), "utf8");

function offerTemplate(
  productId: string,
  productName: string,
): PrivateOfferTemplateProduct {
  return {
    source: {
      productId,
      productName,
      productKind: "production",
    },
    terms: {
      name: productName,
      service: "production",
      deliverables: ["Final master"],
      cashPriceCents: 240_000,
      currency: "ILS",
      taxMode: "tax_free",
      taxRatePct: 0,
      includedSongSpaces: 1,
      session: null,
      revisionRule: { kind: "fixed", count: 2 },
      royaltyTerms: null,
      rights: [],
      enabledPaymentPlans: [],
      agreementText: "Standard production agreement.",
    },
    pricing: { kind: "fixed" },
    agreementNeedsCompletion: false,
  };
}

function storeProduct(input: {
  active: boolean;
  id: string;
  name: string;
  privateOfferTemplate: PrivateOfferTemplateProduct;
}): StoreProduct {
  return {
    id: input.id,
    name: input.name,
    description: `${input.name} description`,
    priceCents: 240_000,
    currency: "ILS",
    active: input.active,
    kind: "production",
    removalAction: "archive",
    durationMin: 60,
    sessionCount: 1,
    bookingEnabled: false,
    paymentPlans: [],
    locationType: "studio",
    bufferMinutes: 0,
    minLeadHours: 24,
    agreementPdf: null,
    legacyAgreementLinkPresent: false,
    royaltyTerms: null,
    agreementText: "Standard production agreement.",
    deliverables: ["Final master"],
    pricingModel: "flat",
    volumeTiers: null,
    privateOfferTemplate: input.privateOfferTemplate,
  };
}

function renderStore() {
  const liveTemplate = offerTemplate("live-product", "Live production");
  const hiddenTemplate = offerTemplate("hidden-product", "Hidden production");
  const products = [
    storeProduct({
      active: true,
      id: "live-product",
      name: "Live production",
      privateOfferTemplate: liveTemplate,
    }),
    storeProduct({
      active: false,
      id: "hidden-product",
      name: "Hidden production",
      privateOfferTemplate: hiddenTemplate,
    }),
  ];

  render(
    <StoreScreen
      products={products}
      defaultCurrency="ILS"
      taxMode="tax_free"
      taxRatePct={0}
      producerName="Studio North"
      producerSlug="studio-north"
      producerLogoUrl={null}
      privateOfferCount={0}
      privateOfferRecipients={[]}
      privateOffers={<div>Offer manager</div>}
    />,
  );

  return { hiddenTemplate, liveTemplate };
}

function latestComposerProps(): ComposerMockProps {
  const latest = mocks.composerProps.mock.calls.at(-1)?.[0] as
    | ComposerMockProps
    | undefined;
  if (!latest) throw new Error("PrivateOfferComposer did not render");
  return latest;
}

beforeEach(() => {
  mocks.composerProps.mockClear();
  mocks.refresh.mockReset();
  mocks.removeProduct.mockReset();
  mocks.reorderProducts.mockReset();
  mocks.setPackageActive.mockReset();
  mocks.storeDraft.clear.mockReset();
  mocks.storeDraft.save.mockReset();
  mocks.toast.mockReset();
  window.history.replaceState(null, "", "/dashboard/store");
});

afterEach(cleanup);

describe("StoreScreen shell", () => {
  it("uses the existing tRPC server actions", () => {
    expect(SRC).toMatch(/setPackageActive/);
  });

  it("wires the / and N global keyboard shortcuts", () => {
    expect(SRC).toMatch(/key === "\/"|"\\\/"/);
    expect(SRC).toMatch(/key\.toLowerCase\(\) === "n"|key === "N"|key === "n"/);
  });

  it("does NOT link Create or Edit to /dashboard/settings (regression carryover)", () => {
    expect(SRC).not.toMatch(/href\s*=\s*[`"']\/dashboard\/settings\?section=services/);
  });

  it("renders the StoreHeader, StoreToolbar, ProductCard, EmptyState pieces", () => {
    expect(SRC).toMatch(/StoreHeader/);
    expect(SRC).toMatch(/StoreToolbar/);
    expect(SRC).toMatch(/ProductCard/);
    expect(SRC).toMatch(/EmptyState/);
  });

  it("opens Products by default and keeps the private-offer panel mounted", () => {
    expect(SRC).toMatch(/useState<StoreSurface>\(["']products["']\)/);
    expect(SRC).toMatch(/<StoreSurfaceTabs/);
    expect(SRC).toMatch(/hidden=\{surface !== ["']products["']\}/);
    expect(SRC).toMatch(/hidden=\{surface !== ["']offers["']\}/);
    expect(SRC).toMatch(/\{privateOffers\}/);
  });

  it("opens a producer-authenticated full-screen artist preview without navigating", () => {
    expect(SRC).toMatch(/<ArtistStorePreview/);
    expect(SRC).not.toMatch(/router\.(?:push|replace)\(["'`]\/(?:artist\/store|join)/);
  });

  it("renders the HIDDEN section divider when filter is all", () => {
    expect(SRC).toMatch(/HIDDEN/);
  });

  it("restores only bounded Store filter and search URL state", () => {
    expect(SRC).toContain("usePathname");
    expect(SRC).toContain("useSearchParams");
    expect(SRC).toContain("parseStoreUrlState");
    expect(SRC).toContain("window.history.replaceState");
    expect(SRC).toContain("next.slice(0, 120)");
    expect(SRC).toContain("onFilterChange={updateFilter}");
    expect(SRC).toContain("onSearchChange={updateSearch}");
    expect(SRC).not.toMatch(/localStorage|sessionStorage/);
  });

  it("no longer uses window.confirm anywhere", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });

  it("mounts the new ProductEditor", () => {
    expect(SRC).toMatch(/<ProductEditor/);
  });

  it("opens one central private-offer composer from live or hidden product cards", () => {
    expect(SRC).toMatch(/offerTemplateProduct/);
    expect(SRC.match(/<PrivateOfferComposer/g)).toHaveLength(1);
    expect(SRC.match(/onSendPrivately=/g)).toHaveLength(2);
    expect(SRC).toMatch(/templateProduct:\s*offerTemplateProduct\.privateOfferTemplate/);
    expect(SRC).toMatch(/returnFocusRef=\{offerReturnFocusRef\}/);
  });

  it("defines StoreProduct without old deposit compatibility fields", () => {
    expect(SRC).toMatch(/paymentPlans:\s*import\("@skitza\/db"\)\.PaymentPlan\[\]/);
    expect(SRC).not.toMatch(/depositPct|depositModel|milestones/);
  });

  it("mounts the lifecycle-aware ProductRemovalModal", () => {
    expect(SRC).toMatch(/<ProductRemovalModal/);
  });

  it("no longer mounts NewPackageForm directly", () => {
    expect(SRC).not.toMatch(/NewPackageForm/);
  });

  it("uses useProductRemoval for the archive/delete outcome flow", () => {
    expect(SRC).toMatch(/useProductRemoval/);
  });

  it("calls reorderProducts with the complete ordered id list after an accessible move", () => {
    expect(SRC).toMatch(/function moveProduct/);
    expect(SRC).toMatch(/nextProducts\.map\(\(product\) => product\.id\)/);
    expect(SRC).toMatch(/reorderProducts\(\s*\{\s*orderedIds/);
  });

  it("reverts the optimistic state to props on server error", () => {
    expect(SRC).toMatch(/setOptimisticProducts\(products\)/);
  });

  it("keeps catalog mutations live-only and reports transport failures locally", () => {
    expect(SRC).toContain("useOnlineStatus");
    expect(SRC).toContain("Reconnect to reorder products.");
    expect(SRC).toContain("Could not reorder products. Please try again.");
    expect(SRC).toContain("Could not update product visibility. Please try again.");
  });

  it("passes move-up/down state and handlers into each ProductCard", () => {
    expect(SRC).toMatch(/canMoveUp=\{index > 0\}/);
    expect(SRC).toMatch(/canMoveDown=\{index < (?:live|hidden)\.length - 1\}/);
    expect(SRC).toMatch(/onMoveUp=/);
    expect(SRC).toMatch(/onMoveDown=/);
    expect(SRC).not.toMatch(/useDragReorder|drag=\{/);
  });

  it("uses an explicit reorder mode and resets partial catalog state before arranging", () => {
    expect(SRC).toMatch(/setReordering/);
    expect(SRC).toMatch(/clearCatalogView/);
    expect(SRC).toMatch(/reordering=\{reordering\}/);
  });

  it("announces optimistic reorder outcomes to assistive technology", () => {
    expect(SRC).toMatch(/aria-live="polite"/);
    expect(SRC).toMatch(/Moved \$\{moving\.name\}/);
    expect(SRC).toMatch(/Could not move \$\{moving\.name\}/);
  });

  it("mirrors the products prop into local optimistic state", () => {
    expect(SRC).toMatch(/optimisticProducts/);
    expect(SRC).toMatch(/setOptimisticProducts/);
  });

  it("updates visibility immediately and rolls it back when saving fails", () => {
    expect(SRC).toContain("withProductVisibility");
    expect(SRC).toMatch(
      /setOptimisticProducts\(\(current\)\s*=>\s*withProductVisibility/,
    );
    expect(SRC).toMatch(
      /withProductVisibility\(current,\s*p\.id,\s*p\.active\)/,
    );
    expect(SRC).not.toMatch(/const previousProducts = optimisticProducts/);
  });

  it("ships one card catalog with no table view or unfinished toggle", () => {
    expect(SRC).not.toMatch(/StoreTable|ViewToggle|ViewMode|enableTable/);
    expect(SRC).not.toMatch(/view\s*===\s*["']table["']/);
  });

  it("falls back to Archive until the server supplies a proven removal action", () => {
    expect(SRC).toMatch(/product\.removalAction\s*\?\?\s*["']archive["']/);
  });

  it("tracks the most-recently-created product id in state", () => {
    expect(SRC).toMatch(/recentlyAdded/);
    expect(SRC).toMatch(/setRecentlyAdded/);
  });

  it("clears recentlyAdded after 4500ms via setTimeout", () => {
    expect(SRC).toMatch(/setTimeout[\s\S]{0,300}4500|4500[\s\S]{0,300}setTimeout/);
  });

  it("passes recentlyAdded to each ProductCard via p.id equality", () => {
    expect(SRC).toMatch(/recentlyAdded=\{p\.id\s*===\s*recentlyAdded\}/);
  });

  it("wires onCreated on the create-mode ProductEditor", () => {
    expect(SRC).toMatch(/onCreated=\{handleCreated\}/);
  });

  it("reveals and focuses a created product regardless of prior filters or search", () => {
    expect(SRC).toMatch(/setSurface\(["']products["']\)/);
    expect(SRC).toMatch(/clearCatalogView\(\)/);
    expect(SRC).toMatch(/scrollIntoView/);
    expect(SRC).toMatch(/\.focus\(/);
    expect(SRC).toMatch(/createdCardRef/);
  });

  it("marks the first live product as Featured", () => {
    expect(SRC).toMatch(/featured=\{p\.id === firstLiveProductId\}/);
  });

  it("passes numbered reorder positions within each visibility group", () => {
    expect(SRC).toMatch(/reorderPosition=\{index \+ 1\}/);
    expect(SRC).toMatch(/reorderTotal=\{live\.length\}/);
    expect(SRC).toMatch(/reorderTotal=\{hidden\.length\}/);
  });

  it("keeps create and edit drafts available after an ordinary close and reopen", () => {
    const createStart = SRC.indexOf("{/* Create modal */}");
    const editStart = SRC.indexOf("{/* Edit modal */}");
    const removalStart = SRC.indexOf("<ProductRemovalModal");
    const createEditor = SRC.slice(createStart, editStart);
    const editEditor = SRC.slice(editStart, removalStart);

    for (const editor of [createEditor, editEditor]) {
      expect(editor).not.toContain("storeDraft.clear()");
      expect(editor).toContain("persistedDraft={storeDraft.record}");
      expect(editor).toContain("onPersistDraft={storeDraft.save}");
      expect(editor).toContain("onSubmitted={storeDraft.clear}");
    }
  });

  it("passes the real focal or secondary Store placement into each preview", () => {
    expect(SRC).toMatch(/previewPlacement=\{counts\.live === 0 \? "focal" : "secondary"\}/);
    expect(SRC).toMatch(/editing\?\.active && editing\.id === firstLiveProductId/);
  });

  it("does not let global shortcuts fire from controls or any open dialog", () => {
    expect(SRC).toMatch(/button, a\[href\]/);
    expect(SRC).toMatch(/\[role="dialog"\]/);
    expect(SRC).toMatch(/isContentEditable/);
    expect(SRC).toMatch(/creating \|\|/);
    expect(SRC).toMatch(/editing !== null/);
    expect(SRC).toMatch(/removing !== null/);
    expect(SRC).toMatch(/offerTemplateProduct !== null/);
    expect(SRC).not.toMatch(/e\.key === "Escape"/);
  });
});

describe("StoreScreen private-offer shortcut interaction", () => {
  it("opens the one central composer with the exact live or hidden template and restores focus", () => {
    const { hiddenTemplate, liveTemplate } = renderStore();
    const liveShortcut = screen.getByRole("button", {
      name: "Send Live production privately",
    });

    liveShortcut.focus();
    fireEvent.click(liveShortcut);

    const liveComposer = screen.getByTestId("private-offer-composer");
    expect(screen.getAllByTestId("private-offer-composer")).toHaveLength(1);
    expect(within(liveComposer).getByText("Live production")).toBeTruthy();
    expect(latestComposerProps().templateProduct).toBe(liveTemplate);

    fireEvent.click(screen.getByRole("button", { name: "Close private offer" }));
    expect(screen.queryByTestId("private-offer-composer")).toBeNull();
    expect(document.activeElement).toBe(liveShortcut);

    const hiddenShortcut = screen.getByRole("button", {
      name: "Send Hidden production privately",
    });
    hiddenShortcut.focus();
    fireEvent.click(hiddenShortcut);

    const hiddenComposer = screen.getByTestId("private-offer-composer");
    expect(screen.getAllByTestId("private-offer-composer")).toHaveLength(1);
    expect(within(hiddenComposer).getByText("Hidden production")).toBeTruthy();
    expect(latestComposerProps().templateProduct).toBe(hiddenTemplate);

    fireEvent.click(screen.getByRole("button", { name: "Close private offer" }));
    expect(document.activeElement).toBe(hiddenShortcut);
  });

  it("refreshes once after success without switching tabs or entering reorder mode", () => {
    renderStore();
    fireEvent.click(
      screen.getByRole("button", { name: "Send Live production privately" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete private offer" }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: /Products/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      screen.getByRole("tab", { name: /Private offers/ }).getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Reorder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("hides both private-offer shortcuts while reorder mode is active", () => {
    renderStore();

    expect(
      screen.getAllByRole("button", { name: /^Send .* privately$/ }),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));

    expect(screen.queryAllByRole("button", { name: /^Send .* privately$/ })).toHaveLength(
      0,
    );
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Products/ }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.getAllByRole("button", { name: /^Send .* privately$/ }),
    ).toHaveLength(2);
  });
});
