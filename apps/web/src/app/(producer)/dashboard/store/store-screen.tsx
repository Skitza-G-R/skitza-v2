// store-screen.tsx
//
// Composes the producer Store catalog. State: filter / search /
// creating / editing / removing. Keyboard: / focuses search and N opens
// the new-product wizard when focus is outside an interactive control or
// dialog. Create + Edit mount the Phase-2 <ProductEditor>; product
// removal uses a server-owned lifecycle action.

"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { reorderProducts, setPackageActive } from "~/app/(producer)/dashboard/booking/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useProducerStoreProductDraft } from "~/components/runtime-state/use-runtime-state";
import { useToast } from "~/components/ui/toast";
import type { TaxMode } from "~/lib/tax-mode";

import { EmptyState } from "./empty-state";
import {
  countByFilter,
  filterAndSearch,
  parseStoreUrlState,
  type FilterTab,
} from "./filter-search";
import { NewProductButton } from "./new-product-button";
import { ProductCard, type ProductCardData } from "./product-card";
import { ProductEditor } from "./product-editor";
import { ProductRemovalModal, type ProductRemovalAction } from "./product-removal-modal";
import { StoreHeader } from "./store-header";
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
}

export function StoreScreen({
  products,
  defaultCurrency,
  taxMode,
  taxRatePct,
  producerName = "Your studio",
}: StoreScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlState = parseStoreUrlState(searchParams.toString());
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterTab>(urlState.filter);
  const [search, setSearch] = useState(urlState.search);
  // Editor state. `creating` opens <ProductEditor> in create mode;
  // `editing` opens it in edit mode pre-filled. `removing` opens the
  // lifecycle-aware confirmation for a single product.
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const [removing, setRemoving] = useState<StoreProduct | null>(null);
  const storeDraft = useProducerStoreProductDraft();
  const restoredStoreDraftRef = useRef(false);
  // Phase 3 P3-11 — flags the most-recently-created product id so its
  // card gets the `sk-shimmer-glow` className for ~4s. Cleared by the
  // setTimeout in handleCreated below. Holds at most one id at a time.
  const [recentlyAdded, setRecentlyAdded] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = parseStoreUrlState(searchParams.toString());
    setFilter(next.filter);
    setSearch(next.search);
  }, [searchParams]);

  function replaceUrlState(
    key: "filter" | "search",
    value: string,
    defaultValue: string,
  ) {
    const params = new URLSearchParams(searchParams.toString());
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

  useLayoutEffect(() => {
    if (!storeDraft.loaded || restoredStoreDraftRef.current) return;
    restoredStoreDraftRef.current = true;
    const saved = storeDraft.record;
    if (!saved) return;
    if (saved.mode === "new") {
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
    setRecentlyAdded(id);
    // Animation runs 2 × 2s = 4s. Clear slightly after that so React
    // removes the className and the box-shadow halo disappears cleanly.
    // If a SECOND new product lands before this timer fires, the new
    // setRecentlyAdded(id) overrides — but we keep the existing
    // setTimeout running, which will then no-op via the equality check.
    setTimeout(() => {
      setRecentlyAdded((cur) => (cur === id ? null : cur));
    }, 4500);
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
        isShortcutTarget(e.target)
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setCreating(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [creating, editing, removing]);

  function onToggleVisible(p: StoreProduct) {
    if (!online) {
      toast("Reconnect to change product visibility.", "error");
      return;
    }
    const next = !p.active;
    startTransition(async () => {
      try {
        const res = await setPackageActive({ id: p.id, active: next });
        if (res.ok) {
          toast(next ? `"${p.name}" is now live.` : `"${p.name}" hidden.`, "success");
          router.refresh();
        } else {
          toast(res.error, "error");
        }
      } catch {
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
      <StoreHeader liveCount={counts.live} hiddenCount={counts.hidden} />

      <div className="mb-4 flex justify-end">
        <NewProductButton
          onClick={() => {
            setCreating(true);
          }}
        />
      </div>

      <StoreToolbar
        ref={searchRef}
        filter={filter}
        onFilterChange={updateFilter}
        counts={counts}
        search={search}
        onSearchChange={updateSearch}
      />

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement}
      </p>

      {filtered.length === 0 ? (
        products.length === 0 ? (
          <EmptyState
            title="No products yet"
            body="Create your first product to start taking bookings from your link."
            action={
              <NewProductButton
                onClick={() => {
                  setCreating(true);
                }}
              />
            }
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
