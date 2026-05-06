"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentPlan } from "@skitza/db";

import {
  archivePackage,
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
import { formatMoney } from "~/lib/format/money";

// Producer Storefront screen.
//
// Layout (≥ lg, two-column):
//   ┌──────────────────────────┬────────────────────┐
//   │ Product list (2/3 width) │ Page snapshot card │
//   │   - "Create product" CTA │   - browser chrome │
//   │   - product cards w/     │   - hero gradient  │
//   │     visibility toggle +  │   - mini list      │
//   │     kebab menu (Edit /   │   - "Open live"    │
//   │     Duplicate / Archive) │ Page stats card    │
//   │                          │   - placeholder    │
//   └──────────────────────────┴────────────────────┘
//
// On <lg the right column collapses below the product list. The right
// column is sticky on lg+ so the preview stays visible while scrolling
// through a long product list.
//
// Stats panel intentionally renders placeholders ("—") until the
// analytics aggregation lands. We don't show fabricated numbers.

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  sessionCount: number;
  priceCents: number;
  currency: string;
  active: boolean;
  paymentPlans?: PaymentPlan[];
  bookingsThisMonth?: number;
  /** Display name of the payment plan (e.g. "50/50", "Pay once"). */
  planLabel?: string;
  featured?: boolean;
  // Edit-form fields. The kebab → Edit menuitem opens NewPackageForm
  // pre-filled with these values so the producer can update without
  // leaving Storefront. Required (not optional) because every product
  // has a row in the DB with these columns. `kind` + `locationType`
  // stay loose strings here (DB columns are `text`, not enum) — we
  // narrow at the form-binding site below to match the
  // ServicePackageRow convention.
  depositPct: number;
  kind: string;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  contractUrl: string | null;
}

export interface StorefrontAnalytics {
  views7d: number;
  views7dDelta: number | null;
  bookings7d: number;
  bookings7dDelta: number | null;
  revenue7dCents: number;
  revenue7dDelta: number | null;
  conversionPct: number;
  conversionDelta: number | null;
  /** 7 daily values, oldest at index 0. */
  daily: number[];
  sources: Array<{ label: string; pct: number; count: number }>;
  currency: string;
}

interface StorefrontScreenProps {
  products: StorefrontProduct[];
  analytics: StorefrontAnalytics | null;
  /** Public storefront URL (e.g. https://skitza.app/p/gili). */
  publicUrl: string | null;
  /** Display name for the page-snapshot hero. */
  producerName: string | null;
  /** Slug for the public-link strip in the snapshot's browser chrome. */
  producerSlug: string | null;
  /** Producer's profile-level default currency. Seeds the create-form
   *  currency dropdown so an Israeli producer doesn't have to reach
   *  for the dropdown every time they add a service. */
  defaultCurrency: Currency;
}

export function StorefrontScreen({
  products,
  analytics,
  publicUrl,
  producerName,
  producerSlug,
  defaultCurrency,
}: StorefrontScreenProps) {
  const visibleCount = products.filter((p) => p.active).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section aria-label="Products">
        <ProductsSection products={products} defaultCurrency={defaultCurrency} />
      </section>

      <aside
        aria-label="Public page preview"
        className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start"
      >
        <PageSnapshotCard
          products={products}
          publicUrl={publicUrl}
          producerName={producerName}
          producerSlug={producerSlug}
        />

        <PageStatsCard analytics={analytics} />

        <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {visibleCount === 0
            ? "Your public page is empty until you make a product visible."
            : `${String(visibleCount)} of ${String(products.length)} products live on your public page.`}
        </p>
      </aside>
    </div>
  );
}

// — Products list (left column) —

function ProductsSection({
  products,
  defaultCurrency,
}: {
  products: StorefrontProduct[];
  defaultCurrency: Currency;
}) {
  // The Create flow stays on Storefront — the prior implementation
  // navigated to /dashboard/settings?section=services&action=create
  // because Services CRUD lived in Settings. PRD v3 §4.5 places the
  // products surface here, so we render NewPackageForm inline instead.
  // `creating` toggles between the CTA button and the form; the form
  // calls onClose when the producer cancels or finishes saving.
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {creating ? (
        <NewPackageForm
          initialCurrency={defaultCurrency}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setCreating(true);
          }}
          className="sk-press flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-4 py-3 text-sm font-bold text-[rgb(var(--fg-onsidebar))]"
        >
          <PlusIcon />
          Create product
        </button>
      )}

      {products.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          No products yet — Create one to start taking bookings.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: StorefrontProduct }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  // `active` mirrors the server field but flips optimistically on toggle
  // so the chip + opacity respond instantly. Reverts if the action fails.
  const [active, setActive] = useState(product.active);

  function onToggleVisible() {
    const next = !active;
    setActive(next);
    startTransition(async () => {
      const res = await setPackageActive({ id: product.id, active: next });
      if (res.ok) {
        toast(
          next ? `"${product.name}" is now live.` : `"${product.name}" hidden.`,
          "success",
        );
        router.refresh();
      } else {
        setActive(!next);
        toast(res.error, "error");
      }
    });
  }

  function onDuplicate() {
    startTransition(async () => {
      const res = await duplicatePackage({ id: product.id });
      if (res.ok) {
        toast(`"${product.name}" duplicated.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onArchive() {
    startTransition(async () => {
      const res = await archivePackage({ id: product.id });
      if (res.ok) {
        toast(`"${product.name}" archived.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <article
      className={[
        "flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 transition-opacity",
        active ? "" : "opacity-60",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-bold leading-tight text-[rgb(var(--fg-default))]">
              {product.name}
            </p>
            {product.featured ? (
              <span className="pill pill-brand inline-flex items-center gap-1">
                <StarIcon /> featured
              </span>
            ) : null}
            {active ? null : <span className="pill pill-neutral">hidden</span>}
          </div>
          {product.description ? (
            <p className="mt-1 line-clamp-2 text-[12px] text-[rgb(var(--fg-muted))]">
              {product.description}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 text-right font-mono text-[14px] font-extrabold text-[rgb(var(--fg-default))] tabular-nums">
          {formatMoney(product.priceCents, product.currency)}
        </p>
      </div>

      {/* Footer: meta chips on the left, controls on the right. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-[rgb(var(--border-subtle))] pt-2.5 text-[11px] text-[rgb(var(--fg-muted))]">
        {product.sessionCount > 0 ? (
          <span>
            <span className="font-mono tabular-nums">
              {String(product.sessionCount)}
            </span>{" "}
            {product.sessionCount === 1 ? "session" : "sessions"}
          </span>
        ) : null}
        {product.durationMin > 0 ? (
          <>
            {product.sessionCount > 0 ? <span aria-hidden>·</span> : null}
            <span>
              <span className="font-mono tabular-nums">
                {String(product.durationMin)}
              </span>
              {" min"}
            </span>
          </>
        ) : null}
        {product.bookingsThisMonth != null ? (
          <>
            <span aria-hidden>·</span>
            <span>
              <span className="font-mono tabular-nums">
                {String(product.bookingsThisMonth)}
              </span>{" "}
              this month
            </span>
          </>
        ) : null}
        {product.planLabel ? (
          <>
            <span aria-hidden>·</span>
            <span>{product.planLabel}</span>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleVisible}
            disabled={pending}
            aria-pressed={active}
            className={[
              "sk-press inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50",
              active
                ? "border-[rgb(var(--fg-success)/0.32)] bg-[rgb(var(--fg-success)/0.08)] text-[rgb(var(--fg-success))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-muted))]",
            ].join(" ")}
          >
            <span
              aria-hidden
              className={[
                "inline-block h-1.5 w-1.5 rounded-full",
                active
                  ? "bg-[rgb(var(--fg-success))]"
                  : "bg-[rgb(var(--fg-faint))]",
              ].join(" ")}
            />
            {active ? "Live" : "Hidden"}
          </button>
          <ProductMenu
            product={product}
            onDuplicate={onDuplicate}
            onArchive={onArchive}
            disabled={pending}
          />
        </div>
      </div>
    </article>
  );
}

// Minimal kebab menu — no external dropdown primitive needed. Click
// outside to close, Escape to close. Built fresh because the wider
// codebase doesn't ship a Menu primitive yet.
//
// Edit opens an inline modal with NewPackageForm pre-filled — the
// previous implementation linked to /dashboard/settings?section=services
// which yanked the producer out of Storefront mid-flow. PRD v3 §4.5
// places product CRUD on this surface.
function ProductMenu({
  product,
  onDuplicate,
  onArchive,
  disabled,
}: {
  product: StorefrontProduct;
  onDuplicate: () => void;
  onArchive: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Project the product row into the form's InitialPackageValues
  // shape. Memoised so the form's mount-time effect doesn't see a new
  // identity on every parent render. DB columns for currency / kind /
  // locationType are loose `text` — we narrow each with a safe default
  // so the form's enum-typed inputs never receive an out-of-range
  // value. Same pattern as ServicesSection.toInitialValues.
  const editValues: InitialPackageValues = useMemo(() => {
    const VALID_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;
    const VALID_KINDS = [
      "session",
      "mixing",
      "mastering",
      "producing",
      "other",
    ] as const;
    const VALID_LOCATIONS = ["studio", "remote", "client_space"] as const;
    const currency = (VALID_CURRENCIES as readonly string[]).includes(
      product.currency,
    )
      ? (product.currency as Currency)
      : "USD";
    const kind = (VALID_KINDS as readonly string[]).includes(product.kind)
      ? (product.kind as PackageKind)
      : "session";
    const locationType = (VALID_LOCATIONS as readonly string[]).includes(
      product.locationType,
    )
      ? (product.locationType as PackageLocationType)
      : "studio";
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      durationMin: product.durationMin,
      sessionCount: product.sessionCount,
      priceCents: product.priceCents,
      currency,
      depositPct: product.depositPct,
      kind,
      locationType,
      bufferMinutes: product.bufferMinutes,
      minLeadHours: product.minLeadHours,
      paymentPlans: product.paymentPlans ?? [],
      contractUrl: product.contractUrl,
    };
  }, [product]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmArchive(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmArchive(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Edit modal escape / click-outside / scroll-lock / focus-trap are
  // all owned by Radix Dialog below — no hand-rolled effects needed.

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setConfirmArchive(false);
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Product actions"
        className="sk-press inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
      >
        <DotsIcon />
      </button>
      {open ? (
        <div
          role="menu"
          className="sk-pop absolute right-0 top-[calc(100%+4px)] z-20 flex min-w-[160px] flex-col rounded-[var(--radius-md)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setEditing(true);
            }}
            className="sk-press rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12px] font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-base))]"
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDuplicate();
            }}
            className="sk-press rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12px] font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-base))]"
          >
            Duplicate
          </button>
          {confirmArchive ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setConfirmArchive(false);
                onArchive();
              }}
              className="sk-press rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12px] font-semibold text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]"
            >
              Confirm archive
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setConfirmArchive(true);
              }}
              className="sk-press rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12px] font-semibold text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]"
            >
              Archive
            </button>
          )}
        </div>
      ) : null}
      {/* Edit modal — Radix Dialog primitive.
       *
       * Why Radix and not the hand-rolled modal that lived here
       * before: hand-rolled gave focus management / scroll-lock /
       * escape / click-outside up to the implementer, and on a tall
       * form the combination of (a) `<input autoFocus>` on Service
       * Name + (b) the browser's `scrollIntoView` walking up the
       * tree + (c) the modal's flex centering produced a stuck-mid-
       * form initial scroll position. Producers opened the modal and
       * never saw the Service-Name field. Radix:
       *   - Owns body scroll-lock so the page beneath can't bleed
       *     scroll events into the modal.
       *   - Owns focus management; we override its open-auto-focus so
       *     the browser-native autoFocus on the input doesn't trigger
       *     scrollIntoView at the wrong moment.
       *   - Owns the portal, so the dialog renders at the top of
       *     <body> and `position: fixed` actually means viewport-
       *     fixed (not fighting an ancestor that's transformed).
       *
       * The Skitza Dialog wrapper at ~/components/ui/dialog adds
       * card chrome (border + bg + p-6) that would nest awkwardly
       * with NewPackageForm's own card chrome. Using the Radix
       * primitive directly lets the form provide ALL the chrome
       * while we just position + size + scroll-bound the panel.
       *
       * Layout:
       *   - Mobile (<sm): bottom-sheet — full-width, rounded-top,
       *     anchored to viewport bottom, max-h 90vh.
       *   - Desktop (sm+): centered modal — max-w-2xl, max-h
       *     calc(100vh - 3rem), rounded-lg.
       *   - In both: panel = `flex flex-col overflow-hidden` so the
       *     internal `flex-1 overflow-y-auto` div fills the bounded
       *     space and scrolls the form. (Without `flex-1`, the inner
       *     div sizes to content and the panel's overflow-hidden
       *     just CLIPS — that was the silent bug in the prior fix.)
       */}
      <DialogPrimitive.Root
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <DialogPrimitive.Content
            // Native autoFocus on the Service Name input does the job
            // already; Radix's auto-focus on top of that doubles up
            // and combined with reveal-up's translate animation is
            // what was scroll-jacking the panel mid-mount.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
            aria-label={`Edit ${product.name}`}
            className="fixed z-50 flex flex-col overflow-hidden shadow-2xl
              inset-x-0 bottom-0 max-h-[90vh] rounded-t-[var(--radius-xl)]
              sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2
              sm:w-[calc(100vw-3rem)] sm:max-w-2xl sm:max-h-[calc(100vh-3rem)]
              sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-lg)]"
          >
            <DialogPrimitive.Title className="sr-only">
              Edit {product.name}
            </DialogPrimitive.Title>
            {/* `flex-1` is the missing piece: it makes this scroll
                container fill the bounded panel's height, so
                `overflow-y-auto` actually has something to clip
                against. Without flex-1 the div sizes to its
                content (the form) and overflow-y-auto becomes a
                no-op — the panel's overflow-hidden just clips the
                form silently. */}
            <div className="flex-1 overflow-y-auto">
              <NewPackageForm
                initialValues={editValues}
                onClose={() => {
                  setEditing(false);
                }}
              />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

// — Right column: page snapshot + stats —

function PageSnapshotCard({
  products,
  publicUrl,
  producerName,
  producerSlug,
}: {
  products: StorefrontProduct[];
  publicUrl: string | null;
  producerName: string | null;
  producerSlug: string | null;
}) {
  const visible = products.filter((p) => p.active);
  const hostPath = producerSlug ? `skitza.app/p/${producerSlug}` : "skitza.app";

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      <div className="border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Public page
          </p>
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-[rgb(var(--fg-faint))]">
            Read-only
          </span>
        </div>
        <h3 className="mt-1 font-display text-[14px] font-bold tracking-tight text-[rgb(var(--fg-default))]">
          How artists see you
        </h3>
      </div>

      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[rgb(var(--fg-danger)/0.4)]" />
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[rgb(var(--fg-warning)/0.4)]" />
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[rgb(var(--fg-success)/0.4)]" />
        <span className="ml-1 truncate rounded-sm bg-[rgb(var(--bg-elevated))] px-2 py-0.5 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
          {hostPath}
        </span>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--bg-sidebar))] px-4 py-4 text-[rgb(var(--fg-onsidebar))]">
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden
            className="h-9 w-9 rounded-full border border-[rgb(255_255_255/0.4)] bg-[rgb(255_255_255/0.2)]"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-[14px] font-extrabold tracking-tight">
              {producerName ?? "Your studio"}
            </p>
            <p className="text-[10px] opacity-80">Producer · Mix Engineer</p>
          </div>
        </div>
      </div>

      {/* Mini product list */}
      <div className="flex flex-col gap-1.5 px-4 py-3">
        {visible.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-[rgb(var(--fg-faint))]">
            No live products yet.
          </p>
        ) : (
          visible.slice(0, 4).map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2.5 py-2"
            >
              <span
                aria-hidden
                className="h-5 w-5 shrink-0 rounded-sm bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--bg-sidebar))]"
              />
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[rgb(var(--fg-default))]">
                {p.name}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
                {formatMoney(p.priceCents, p.currency)}
              </span>
            </div>
          ))
        )}
        {visible.length > 4 ? (
          <p className="pt-1 text-center text-[10px] text-[rgb(var(--fg-faint))]">
            + {String(visible.length - 4)} more
          </p>
        ) : null}
      </div>

      {/* Footer with open-live link */}
      <div className="flex items-center justify-between gap-2 border-t border-[rgb(var(--border-subtle))] px-4 py-2.5">
        <span className="text-[10.5px] text-[rgb(var(--fg-muted))]">
          {String(visible.length)} live · {String(products.length - visible.length)} hidden
        </span>
        {publicUrl ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sk-press inline-flex items-center gap-1 text-[11.5px] font-bold text-[rgb(var(--brand-primary))]"
          >
            Open live page
            <ArrowUpRightIcon />
          </a>
        ) : (
          <span className="text-[11.5px] text-[rgb(var(--fg-faint))]">
            Set a public link in Settings
          </span>
        )}
      </div>
    </div>
  );
}

function PageStatsCard({
  analytics,
}: {
  analytics: StorefrontAnalytics | null;
}) {
  // We deliberately render placeholders ("—") when analytics aren't
  // wired yet so the panel slot looks finished but doesn't lie about
  // numbers. When the aggregation lands the same component renders
  // real values.
  const hasData = analytics !== null && analytics.views7d > 0;
  const cells: { label: string; value: string }[] = hasData
    ? [
        { label: "Views · 7d", value: String(analytics.views7d) },
        { label: "Bookings · 7d", value: String(analytics.bookings7d) },
        {
          label: "Conversion",
          value: `${analytics.conversionPct.toFixed(1)}%`,
        },
      ]
    : [
        { label: "Views · 7d", value: "—" },
        { label: "Bookings · 7d", value: "—" },
        { label: "Conversion", value: "—" },
      ];

  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          Page stats
        </p>
        {hasData ? null : (
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-[rgb(var(--fg-faint))]">
            Coming soon
          </span>
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label}>
            <p className="font-mono text-[15px] font-extrabold leading-tight text-[rgb(var(--fg-default))] tabular-nums">
              {c.value}
            </p>
            <p className="mt-0.5 text-[10px] text-[rgb(var(--fg-muted))]">
              {c.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// — Inline icons (no lucide-react) —

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      aria-hidden
      width="9"
      height="9"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <path d="M6 1l1.6 3.2 3.4.5-2.5 2.4.6 3.4L6 8.9l-3.1 1.6.6-3.4L1 4.7l3.4-.5z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9L9 3" />
      <path d="M4 3h5v5" />
    </svg>
  );
}
