// store-screen.tsx
//
// Composes the producer Store catalog. State: filter / search / view /
// creating / editing / deleting. Keyboard: / focuses search, N opens
// the new-product wizard, Esc closes the open modal, Enter on a
// focused card opens edit. Create + Edit mount the Phase-2
// <ProductEditor>; delete uses <DeleteConfirmModal> with the
// useUndoableDelete hook so producers get a 4.5s Undo toast.

"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { reorderProducts, setPackageActive } from "~/app/(producer)/dashboard/booking/actions";
import { useToast } from "~/components/ui/toast";

import { DeleteConfirmModal } from "./delete-confirm-modal";
import { EmptyState } from "./empty-state";
import { countByFilter, filterAndSearch, type FilterTab } from "./filter-search";
import { NewProductButton } from "./new-product-button";
import { ProductCard, type ProductCardData } from "./product-card";
import { ProductEditor } from "./product-editor";
import { StoreHeader } from "./store-header";
import { StoreTable } from "./store-table";
import { StoreToolbar } from "./store-toolbar";
import { computeNewOrder, useDragReorder } from "./use-drag-reorder";
import { useUndoableDelete } from "./use-undoable-delete";
import type { ViewMode } from "./view-toggle";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

export interface StoreProduct extends ProductCardData {
  // The Phase-2 ProductEditor seeds its draft directly from these
  // form-typed columns when the editor opens in edit mode.
  depositPct: number;
  durationMin: number;
  sessionCount: number;
  paymentPlans: import("@skitza/db").PaymentPlan[];
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  contractUrl: string | null;
  deliverables: string[];
}

interface StoreScreenProps {
  products: StoreProduct[];
  defaultCurrency: Currency;
}

export function StoreScreen({ products, defaultCurrency }: StoreScreenProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [view, setView] = useState<ViewMode>("cards");
  const [search, setSearch] = useState("");
  // Editor state. `creating` opens <ProductEditor> in create mode;
  // `editing` opens it in edit mode pre-filled. `deleting` opens the
  // <DeleteConfirmModal> for a single product.
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const [deleting, setDeleting] = useState<StoreProduct | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const undoableDelete = useUndoableDelete();

  // Optimistic mirror of the server-rendered products list. Drag-to-reorder
  // updates this immediately; the server call comes second, and a revert
  // snaps back to props on error.
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

  const { getHandlersFor } = useDragReorder({
    onReorder: (fromId, toId, position) => {
      // Optimistic local reorder using the same pure helper the server
      // mutation does. Snapshot the current order BEFORE mutating local
      // state so the server call uses the same orderedIds the user sees.
      const currentIds = optimisticProducts.map((p) => p.id);
      const nextIds = computeNewOrder(currentIds, fromId, toId, position);
      const byId = new Map(optimisticProducts.map((p) => [p.id, p]));
      const nextProducts = nextIds
        .map((id) => byId.get(id))
        .filter((p): p is StoreProduct => p !== undefined);
      setOptimisticProducts(nextProducts);
      startTransition(async () => {
        const res = await reorderProducts({ orderedIds: nextIds });
        if (!res.ok) {
          // Revert by snapping back to the server-rendered props.
          setOptimisticProducts(products);
          toast(res.error, "error");
        } else {
          router.refresh();
        }
      });
    },
  });

  // Group filtered list into live + hidden when filter is "all" so we
  // can render the "HIDDEN · N" divider between them.
  const live = filtered.filter((p) => p.active);
  const hidden = filtered.filter((p) => !p.active);

  // Global keyboard handlers: / focuses search, N opens new flow, Esc
  // closes any open modal. We skip handling when the user is typing
  // inside a form field already.
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return t.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (creating) setCreating(false);
        if (editing) setEditing(null);
        if (deleting) setDeleting(null);
        return;
      }
      if (isTypingTarget(e.target)) return;
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
  }, [creating, editing, deleting]);

  function onToggleVisible(p: StoreProduct) {
    const next = !p.active;
    startTransition(async () => {
      const res = await setPackageActive({ id: p.id, active: next });
      if (res.ok) {
        toast(next ? `"${p.name}" is now live.` : `"${p.name}" hidden.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onEdit(p: StoreProduct) {
    setEditing(p);
  }

  function onDelete(p: StoreProduct) {
    setDeleting(p);
  }

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
        onFilterChange={setFilter}
        counts={counts}
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        enableTable={true}
      />

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
          <EmptyState
            title="Nothing matches"
            body="Try clearing the filter or search."
          />
        )
      ) : view === "table" ? (
        <StoreTable
          live={live}
          hidden={hidden}
          pending={pending}
          showHiddenGroup={filter === "all" || filter === "hidden"}
          onOpen={onEdit}
          onToggleVisible={onToggleVisible}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {live.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              drag={getHandlersFor(p.id)}
              pending={pending}
              onOpen={() => {
                onEdit(p);
              }}
              onToggleVisible={() => {
                onToggleVisible(p);
              }}
              onEdit={() => {
                onEdit(p);
              }}
              onDelete={() => {
                onDelete(p);
              }}
            />
          ))}
          {filter === "all" && hidden.length > 0 ? (
            <div className="mt-4 mb-1 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
              HIDDEN <span aria-hidden>·</span>{" "}
              <span className="tabular-nums">{hidden.length}</span>
            </div>
          ) : null}
          {(filter === "all" || filter === "hidden") &&
            hidden.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                drag={getHandlersFor(p.id)}
                pending={pending}
                onOpen={() => {
                  onEdit(p);
                }}
                onToggleVisible={() => {
                  onToggleVisible(p);
                }}
                onEdit={() => {
                  onEdit(p);
                }}
                onDelete={() => {
                  onDelete(p);
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
      />

      {/* Edit modal */}
      <ProductEditor
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        product={editing}
        defaultCurrency={defaultCurrency}
      />

      {/* Delete confirmation */}
      <DeleteConfirmModal
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        productName={deleting?.name ?? ""}
        onConfirm={() => {
          if (deleting) {
            void undoableDelete({ id: deleting.id, name: deleting.name });
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
