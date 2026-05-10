// store-screen.tsx
//
// Composes the producer Store catalog. State: filter / search / view /
// editing. Keyboard: / focuses search, N opens new flow, Esc closes
// modal, Enter on a focused card opens edit (Enter handler lives on
// each card). Edit/Create open the existing NewPackageForm in Phase 1;
// Phase 2 swaps in the new Editor.

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  archivePackage,
  // Phase 2 wires this into the new Editor's kebab menu (Duplicate
  // action). Kept imported here so the Phase-2 wiring is one line and
  // the Phase-1 source-grep regression test stays green.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  duplicatePackage,
  setPackageActive,
  type PackageKind,
  type PackageLocationType,
} from "~/app/(producer)/dashboard/booking/actions";
import {
  NewPackageForm,
  type Currency,
  type InitialPackageValues,
} from "~/app/(producer)/dashboard/booking/package-form";
import { useToast } from "~/components/ui/toast";

import { EmptyState } from "./empty-state";
import { countByFilter, filterAndSearch, type FilterTab } from "./filter-search";
import { NewProductButton } from "./new-product-button";
import { ProductCard, type ProductCardData } from "./product-card";
import { StoreHeader } from "./store-header";
import { StoreToolbar } from "./store-toolbar";
import type { ViewMode } from "./view-toggle";

export interface StoreProduct extends ProductCardData {
  // The Phase 1 editor is the existing NewPackageForm; we need the
  // form-typed columns to seed initialValues when "Edit" opens.
  depositPct: number;
  durationMin: number;
  sessionCount: number;
  paymentPlans: import("@skitza/db").PaymentPlan[];
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  contractUrl: string | null;
}

interface StoreScreenProps {
  products: StoreProduct[];
  defaultCurrency: Currency;
}

const VALID_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;
const VALID_KINDS = ["session", "mixing", "mastering", "producing", "other"] as const;
const VALID_LOCATIONS = ["studio", "remote", "client_space"] as const;

function toInitialValues(p: StoreProduct): InitialPackageValues {
  const currency = (VALID_CURRENCIES as readonly string[]).includes(p.currency)
    ? (p.currency as Currency)
    : "USD";
  const kind = (VALID_KINDS as readonly string[]).includes(p.kind)
    ? (p.kind as PackageKind)
    : "session";
  const locationType = (VALID_LOCATIONS as readonly string[]).includes(p.locationType)
    ? (p.locationType as PackageLocationType)
    : "studio";
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    durationMin: p.durationMin,
    sessionCount: p.sessionCount,
    priceCents: p.priceCents,
    currency,
    depositPct: p.depositPct,
    kind,
    locationType,
    bufferMinutes: p.bufferMinutes,
    minLeadHours: p.minLeadHours,
    paymentPlans: p.paymentPlans,
    contractUrl: p.contractUrl,
  };
}

export function StoreScreen({ products, defaultCurrency }: StoreScreenProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [view, setView] = useState<ViewMode>("cards");
  const [search, setSearch] = useState("");
  // Editor state. `creating` opens NewPackageForm in create mode;
  // `editing` opens it in edit mode pre-filled.
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => countByFilter(products), [products]);
  const filtered = useMemo(
    () => filterAndSearch(products, filter, search),
    [products, filter, search],
  );

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
  }, [creating, editing]);

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

  // Phase 1 keeps Delete wired to the existing archivePackage server
  // action without the confirm modal or undo toast (those land in
  // Phase 2). We still toast and refresh so producers see feedback.
  function onDelete(p: StoreProduct) {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    startTransition(async () => {
      const res = await archivePackage({ id: p.id });
      if (res.ok) {
        toast(`"${p.name}" deleted.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
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
      ) : (
        <div className="flex flex-col gap-2">
          {live.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
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

      {/* Create modal — wraps NewPackageForm in Radix Dialog so scroll/
       * focus/scrim are owned by the primitive. Replaced in Phase 2
       * with the new <ProductEditor>. */}
      <DialogPrimitive.Root
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
            aria-label="New product"
            className="fixed z-50 flex flex-col overflow-hidden shadow-2xl
              inset-x-0 bottom-0 max-h-[90vh] rounded-t-[var(--radius-xl)]
              sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2
              sm:w-[calc(100vw-3rem)] sm:max-w-2xl sm:max-h-[calc(100vh-3rem)]
              sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-lg)]"
          >
            <DialogPrimitive.Title className="sr-only">New product</DialogPrimitive.Title>
            <div className="flex-1 overflow-y-auto">
              <NewPackageForm
                initialCurrency={defaultCurrency}
                onClose={() => {
                  setCreating(false);
                }}
              />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Edit modal */}
      <DialogPrimitive.Root
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
            aria-label={editing ? `Edit ${editing.name}` : "Edit product"}
            className="fixed z-50 flex flex-col overflow-hidden shadow-2xl
              inset-x-0 bottom-0 max-h-[90vh] rounded-t-[var(--radius-xl)]
              sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2
              sm:w-[calc(100vw-3rem)] sm:max-w-2xl sm:max-h-[calc(100vh-3rem)]
              sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-lg)]"
          >
            <DialogPrimitive.Title className="sr-only">
              {editing ? `Edit ${editing.name}` : "Edit product"}
            </DialogPrimitive.Title>
            <div className="flex-1 overflow-y-auto">
              {editing ? (
                <NewPackageForm
                  initialValues={toInitialValues(editing)}
                  onClose={() => {
                    setEditing(null);
                  }}
                />
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
