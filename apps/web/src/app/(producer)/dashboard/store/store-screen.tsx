// store-screen.tsx
//
// Composes the producer Store catalog. State: filter / search /
// creating / editing / removing. Keyboard: / focuses search and N opens
// the new-product wizard when focus is outside an interactive control or
// dialog. Create + Edit mount the Phase-2 <ProductEditor>; product
// removal uses a server-owned lifecycle action.

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { reorderProducts, setPackageActive } from "~/app/(producer)/dashboard/booking/actions";
import { copyPublicLink } from "~/components/dashboard/overview/public-link-strip";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useProducerStoreProductDraft } from "~/components/runtime-state/use-runtime-state";
import { useToast } from "~/components/ui/toast";
import { buildJoinUrl } from "~/lib/share/public-url";
import type { TaxMode } from "~/lib/tax-mode";

import { ArtistStorePreview } from "./artist-store-preview";
import { EmptyState } from "./empty-state";
import {
  countByFilter,
  filterAndSearch,
  parseStoreUrlState,
  type FilterTab,
  withProductVisibility,
} from "./filter-search";
import { NewProductButton } from "./new-product-button";
import { ProductCard, type ProductCardData } from "./product-card";
import { ProductEditor } from "./product-editor";
import { ProductRemovalModal, type ProductRemovalAction } from "./product-removal-modal";
import { StoreHeader, type StoreHeaderCopyState } from "./store-header";
import { StoreSurfaceTabs, type StoreSurface } from "./store-surface-tabs";
import { StoreToolbar } from "./store-toolbar";
import { useProductRemoval } from "./use-product-removal";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

export interface StoreProduct extends ProductCardData {
  // The Phase-2 ProductEditor seeds its draft directly from these
  // form-typed columns when the editor opens in edit mode.
  durationMin: number;
  sessionCount: number;
  bookingEnabled: boolean;
  paymentPlans: import("@skitza/db").PaymentPlan[];
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  contractUrl: string | null;
  royaltyTerms: import("@skitza/db").ProductRoyaltyTerms | null;
  agreementText: string | null;
  deliverables: string[];
  // Per-song pricing — pricingModel='per_song' opens the calculator
  // panel in the wizard's Pricing step and the song-count stepper on
  // the artist's product page. volumeTiers is the ascending ladder
  // ({minQty, pricePerUnitCents}); null for flat-price products.
  pricingModel: string;
  volumeTiers: { minQty: number; pricePerUnitCents: number }[] | null;
}

export function productRemovalAction(product: StoreProduct): ProductRemovalAction {
  return product.removalAction ?? "archive";
}

interface StoreScreenProps {
  products: StoreProduct[];
  defaultCurrency: Currency;
  // Migration 0019 — producer's tax mode + rate. taxMode drives the
  // inline TaxModePicker chip (same write path as Settings); taxRatePct
  // is threaded into the ProductEditor so the Pricing step can show a
  // live "Artists pay $X" preview.
  taxMode: TaxMode;
  taxRatePct: number;
  producerName?: string;
  producerSlug: string;
  producerLogoUrl: string | null;
  privateOfferCount: number;
  privateOffers: ReactNode;
}

export function StoreScreen({
  products,
  defaultCurrency,
  taxMode,
  taxRatePct,
  producerName = "Your studio",
  producerSlug,
  producerLogoUrl,
  privateOfferCount,
  privateOffers,
}: StoreScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlState = parseStoreUrlState(searchParams.toString());
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [surface, setSurface] = useState<StoreSurface>("products");
  const [filter, setFilter] = useState<FilterTab>(urlState.filter);
  const [search, setSearch] = useState(urlState.search);
  const [reordering, setReordering] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyState, setCopyState] = useState<StoreHeaderCopyState>("idle");
  // Editor state. `creating` opens <ProductEditor> in create mode;
  // `editing` opens it in edit mode pre-filled. `removing` opens the
  // lifecycle-aware confirmation for a single product.
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const [removing, setRemoving] = useState<StoreProduct | null>(null);
  const storeDraft = useProducerStoreProductDraft();
  const restoredStoreDraftRef = useRef(false);
  // Phase 3 P3-11 — flags the most-recently-created product id so its
  // card gets the `sk-shimmer-glow` className for ~4s once the refreshed
  // product list contains it. Holds at most one id at a time.
  const [recentlyAdded, setRecentlyAdded] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const createdCardRef = useRef<HTMLElement | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const next = parseStoreUrlState(searchParams.toString());
    setFilter(next.filter);
    setSearch(next.search);
  }, [searchParams]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  function replaceUrlState(
    key: "filter" | "search",
    value: string,
    defaultValue: string,
  ) {
    const params = new URLSearchParams(window.location.search);
    if (value === defaultValue) params.delete(key);
    else params.set(key, value.slice(0, 120));
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${pathname}${query ? `?${query}` : ""}`,
    );
  }

  function updateFilter(next: FilterTab) {
    setFilter(next);
    replaceUrlState("filter", next, "all");
  }

  function updateSearch(next: string) {
    const bounded = next.slice(0, 120);
    setSearch(bounded);
    replaceUrlState("search", bounded, "");
  }

  function clearCatalogView() {
    setFilter("all");
    setSearch("");
    const params = new URLSearchParams(window.location.search);
    params.delete("filter");
    params.delete("search");
    const query = params.toString();
    window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
  }

  function updateReordering(next: boolean) {
    if (next) {
      clearCatalogView();
      setSurface("products");
    }
    setReordering(next);
  }

  async function copyStoreLink() {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    const writeText = clipboard ? clipboard.writeText.bind(clipboard) : undefined;
    const copied = await copyPublicLink(buildJoinUrl(producerSlug), writeText);
    setCopyState(copied ? "copied" : "error");
    toast(
      copied ? "Store link copied." : "Could not copy the Store link.",
      copied ? "success" : "error",
    );
    copyResetTimerRef.current = window.setTimeout(
      () => {
        setCopyState("idle");
        copyResetTimerRef.current = null;
      },
      copied ? 1800 : 2800,
    );
  }

  useLayoutEffect(() => {
    if (!storeDraft.loaded || restoredStoreDraftRef.current) return;
    restoredStoreDraftRef.current = true;
    const saved = storeDraft.record;
    if (!saved) return;
    if (saved.mode === "new") {
      setSurface("products");
      setCreating(true);
      return;
    }
    const product = products.find((item) => item.id === saved.productId);
    if (product) {
      setEditing(product);
      return;
    }
    storeDraft.clear();
  }, [products, storeDraft]);

  function handleCreated(id: string) {
    setSurface("products");
    setReordering(false);
    clearCatalogView();
    setRecentlyAdded(id);
  }

  const removeProduct = useProductRemoval();

  // Optimistic mirror of the server-rendered products list. Accessible
  // move-up/down controls update this immediately; the server call comes
  // second, and a failure snaps back to props.
  const [optimisticProducts, setOptimisticProducts] = useState(products);

  // Keep the optimistic state in sync if the server-rendered props change
  // (e.g. after a router.refresh() following a toggle / create / delete).
  useEffect(() => {
    setOptimisticProducts(products);
  }, [products]);

  useEffect(() => {
    if (
      !recentlyAdded ||
      !optimisticProducts.some((product) => product.id === recentlyAdded)
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const card = createdCardRef.current;
      if (!card) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
      card.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => {
      setRecentlyAdded((current) => (current === recentlyAdded ? null : current));
    }, 4500);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [optimisticProducts, recentlyAdded]);

  const counts = useMemo(() => countByFilter(optimisticProducts), [optimisticProducts]);
  const filtered = useMemo(
    () => filterAndSearch(optimisticProducts, filter, search),
    [optimisticProducts, filter, search],
  );

  function moveProduct(productId: string, targetId: string | undefined) {
    if (!targetId || productId === targetId) return;
    if (!online) {
      toast("Reconnect to reorder products.", "error");
      return;
    }
    const fromIndex = optimisticProducts.findIndex((product) => product.id === productId);
    const targetIndex = optimisticProducts.findIndex((product) => product.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;

    const nextProducts = [...optimisticProducts];
    const moving = nextProducts[fromIndex];
    const target = nextProducts[targetIndex];
    if (!moving || !target) return;
    nextProducts[fromIndex] = target;
    nextProducts[targetIndex] = moving;

    const nextIds = nextProducts.map((product) => product.id);
    const direction = targetIndex < fromIndex ? "up" : "down";
    setOptimisticProducts(nextProducts);
    setReorderAnnouncement(`Moved ${moving.name} ${direction}.`);
    startTransition(async () => {
      try {
        const res = await reorderProducts({ orderedIds: nextIds });
        if (!res.ok) {
          setOptimisticProducts(products);
          setReorderAnnouncement(`Could not move ${moving.name}.`);
          toast(res.error, "error");
        } else {
          router.refresh();
        }
      } catch {
        setOptimisticProducts(products);
        setReorderAnnouncement(`Could not move ${moving.name}.`);
        toast("Could not reorder products. Please try again.", "error");
      }
    });
  }

  // Group filtered list into live + hidden when filter is "all" so we
  // can render the "HIDDEN · N" divider between them.
  const live = filtered.filter((p) => p.active);
  const hidden = filtered.filter((p) => !p.active);

  function openNewProduct() {
    setSurface("products");
    setReordering(false);
    setCreating(true);
  }

  // Global keyboard handlers: / focuses search and N opens the new flow.
  // Radix owns Escape for each dialog (including the nested artist-detail
  // preview), so the global listener never closes dialog state itself.
  useEffect(() => {
    function isShortcutTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      if (t.isContentEditable) return true;
      return Boolean(
        t.closest(
          'input, textarea, select, button, a[href], [role="button"], [role="dialog"], [contenteditable="true"]',
        ),
      );
    }
    function onKey(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        creating ||
        editing !== null ||
        removing !== null ||
        previewOpen ||
        isShortcutTarget(e.target)
      ) {
        return;
      }
      if (e.key === "/") {
        if (searchRef.current) {
          e.preventDefault();
          searchRef.current.focus();
        }
        return;
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setSurface("products");
        setReordering(false);
        setCreating(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [creating, editing, previewOpen, removing]);

  function onToggleVisible(p: StoreProduct) {
    if (!online) {
      toast("Reconnect to change product visibility.", "error");
      return;
    }
    const next = !p.active;
    setOptimisticProducts((current) =>
      withProductVisibility(current, p.id, next),
    );
    startTransition(async () => {
      try {
        const res = await setPackageActive({ id: p.id, active: next });
        if (res.ok) {
          toast(next ? `"${p.name}" is now live.` : `"${p.name}" hidden.`, "success");
          router.refresh();
        } else {
          setOptimisticProducts((current) =>
            withProductVisibility(current, p.id, p.active),
          );
          toast(res.error, "error");
        }
      } catch {
        setOptimisticProducts((current) =>
          withProductVisibility(current, p.id, p.active),
        );
        toast("Could not update product visibility. Please try again.", "error");
      }
    });
  }

  function onEdit(p: StoreProduct) {
    setEditing(p);
  }

  function onRemove(p: StoreProduct) {
    setRemoving(p);
  }

  const firstLiveProductId = optimisticProducts.find((product) => product.active)?.id;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-6 pb-24 sm:px-6 sm:pt-10">
      <StoreHeader
        liveCount={counts.live}
        hiddenCount={counts.hidden}
        onPreview={() => {
          setPreviewOpen(true);
        }}
        onCopy={() => {
          void copyStoreLink();
        }}
        copyState={copyState}
      />

      <div className="mb-5">
        <StoreSurfaceTabs
          value={surface}
          onChange={(nextSurface) => {
            setSurface(nextSurface);
            if (nextSurface === "offers") setReordering(false);
          }}
          productCount={counts.all}
          offerCount={privateOfferCount}
        />
      </div>

      <section
        id="store-products-panel"
        role="tabpanel"
        aria-labelledby="store-products-tab"
        hidden={surface !== "products"}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="hidden max-w-[58ch] text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))] sm:block">
            Reusable services artists can request from your Store.
          </p>
          <div className="w-full sm:w-auto">
            <NewProductButton onClick={openNewProduct} />
          </div>
        </div>

        <StoreToolbar
          ref={searchRef}
          filter={filter}
          onFilterChange={updateFilter}
          counts={counts}
          totalCount={counts.all}
          search={search}
          onSearchChange={updateSearch}
          reordering={reordering}
          onReorderingChange={updateReordering}
        />

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {reorderAnnouncement}
        </p>

        {filtered.length === 0 ? (
          products.length === 0 ? (
            <EmptyState
              title="No products yet"
              body="Create your first product to start taking requests from your Store."
              action={<NewProductButton onClick={openNewProduct} />}
            />
          ) : (
            <EmptyState title="Nothing matches" body="Try clearing the filter or search." />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {live.map((p, index) => (
              <ProductCard
                key={p.id}
                product={p}
                pending={pending}
                recentlyAdded={p.id === recentlyAdded}
                featured={p.id === firstLiveProductId}
                reordering={reordering}
                reorderPosition={index + 1}
                reorderTotal={live.length}
                focusRef={p.id === recentlyAdded ? createdCardRef : undefined}
                taxMode={taxMode}
                taxRatePct={taxRatePct}
                canMoveUp={index > 0}
                canMoveDown={index < live.length - 1}
                onMoveUp={() => {
                  moveProduct(p.id, live[index - 1]?.id);
                }}
                onMoveDown={() => {
                  moveProduct(p.id, live[index + 1]?.id);
                }}
                onToggleVisible={() => {
                  onToggleVisible(p);
                }}
                onEdit={() => {
                  onEdit(p);
                }}
                onRemove={() => {
                  onRemove(p);
                }}
              />
            ))}
            {filter === "all" && hidden.length > 0 ? (
              <div className="mt-4 mb-1 flex items-center gap-2 text-[10.5px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
                HIDDEN <span aria-hidden>·</span>{" "}
                <span className="tabular-nums">{hidden.length}</span>
              </div>
            ) : null}
            {(filter === "all" || filter === "hidden") &&
              hidden.map((p, index) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  pending={pending}
                  recentlyAdded={p.id === recentlyAdded}
                  featured={p.id === firstLiveProductId}
                  reordering={reordering}
                  reorderPosition={index + 1}
                  reorderTotal={hidden.length}
                  focusRef={p.id === recentlyAdded ? createdCardRef : undefined}
                  taxMode={taxMode}
                  taxRatePct={taxRatePct}
                  canMoveUp={index > 0}
                  canMoveDown={index < hidden.length - 1}
                  onMoveUp={() => {
                    moveProduct(p.id, hidden[index - 1]?.id);
                  }}
                  onMoveDown={() => {
                    moveProduct(p.id, hidden[index + 1]?.id);
                  }}
                  onToggleVisible={() => {
                    onToggleVisible(p);
                  }}
                  onEdit={() => {
                    onEdit(p);
                  }}
                  onRemove={() => {
                    onRemove(p);
                  }}
                />
              ))}
          </div>
        )}
      </section>

      <section
        id="store-offers-panel"
        role="tabpanel"
        aria-labelledby="store-offers-tab"
        hidden={surface !== "offers"}
        className="rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.42)] p-4 sm:p-6"
      >
        {privateOffers}
      </section>

      <ArtistStorePreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        products={optimisticProducts}
        producerName={producerName}
        producerLogoUrl={producerLogoUrl}
        taxMode={taxMode}
        taxRatePct={taxRatePct}
      />

      {/* Create modal */}
      <ProductEditor
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
        }}
        product={null}
        defaultCurrency={defaultCurrency}
        taxMode={taxMode}
        taxRatePct={taxRatePct}
        producerName={producerName}
        previewPlacement={counts.live === 0 ? "focal" : "secondary"}
        onCreated={handleCreated}
        onSubmitted={storeDraft.clear}
        persistedDraft={storeDraft.record}
        onPersistDraft={storeDraft.save}
      />

      {/* Edit modal */}
      <ProductEditor
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
          }
        }}
        product={editing}
        defaultCurrency={defaultCurrency}
        taxMode={taxMode}
        taxRatePct={taxRatePct}
        producerName={producerName}
        previewPlacement={
          editing?.active && editing.id === firstLiveProductId ? "focal" : "secondary"
        }
        onSubmitted={storeDraft.clear}
        persistedDraft={storeDraft.record}
        onPersistDraft={storeDraft.save}
      />

      <ProductRemovalModal
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        productName={removing?.name ?? ""}
        action={removing ? productRemovalAction(removing) : "archive"}
        onConfirm={() => {
          if (removing) {
            if (!online) {
              toast("Reconnect to remove this product.", "error");
              return;
            }
            void removeProduct({
              id: removing.id,
              name: removing.name,
              action: productRemovalAction(removing),
            });
            setRemoving(null);
          }
        }}
      />
    </div>
  );
}
