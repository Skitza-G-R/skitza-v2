"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Info, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type SyntheticEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { useToast } from "~/components/ui/toast";
import {
  ValidationHint,
  validateDisplayName,
  validateEmail,
  type ValidationState,
} from "~/components/ui/validation";
import { createProjectAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

// New Project modal (Clients & Projects v3 redesign, Phase 1 G7).
// Replaces the legacy /dashboard/clients-projects/new route. The modal
// collects six fields:
//   1. Project title (required, autofocused, max 120)
//   2. Client picker — three sub-modes:
//      a) `lockedClient` prop set (opened from Client Space hero) → name
//         + email read-only, no picker
//      b) existing client picked from the dropdown
//      c) "+ New client" inline name + email (no clientContacts row is
//         created here — the artistName/artistEmail snapshot on the
//         project is enough for v1; the producer can create the CRM row
//         from the Clients tab if they want one)
//   3. Store product picker (required) — dropdown of the producer's
//      active products. When picked, a muted hint card below renders
//      description + deliverables + deposit %.
//   4. Deadline (optional, type="date")
//   5. Total fee (auto-fills from product.priceCents / 100, editable)
//   6. Deposit (auto-fills via priceCents * depositPct / 10_000, editable)
//
// Submit flow: createProjectAction → revalidatePath → toast + router.refresh.
// On success the parent's onCreated() fires.
//
// Layout precedent: ../clients/new-client-modal.tsx — same Radix Dialog
// fixed-center, scrim + backdrop-blur, compact gap-3 form spacing, 5px
// padding, max-w-[460px] for the wider product-picker hint card.
// DESIGN.md §6.2 / BUILD-NOTES §7.2.

export interface NewProjectModalProductOption {
  id: string;
  name: string;
  description: string | null;
  deliverables: string[] | null;
  priceCents: number;
  currency: string;
  depositPct: number;
}

export interface NewProjectModalClientOption {
  id: string;
  name: string;
  email: string;
}

export interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing client list for the picker dropdown. */
  clients: NewProjectModalClientOption[];
  /** Producer's products (from booking.products.list — active only). */
  products: NewProjectModalProductOption[];
  /**
   * When set, the client picker is locked — the modal renders the name
   * + email read-only. Used by the Client Space hero "+ New project"
   * pill so the producer can't accidentally repoint the project.
   */
  lockedClient?: NewProjectModalClientOption;
  /** Fired after a successful create — parent can refresh / close. */
  onCreated?: () => void;
}

type ClientMode = "existing" | "new";

// USD/EUR money formatter for the hint card's deposit string. The
// product currency comes from products.currency; we don't try to
// guess locale here.
function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function NewProjectModal({
  open,
  onClose,
  clients,
  products,
  lockedClient,
  onCreated,
}: NewProjectModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);

  // Client picker state (only relevant when lockedClient is absent).
  // Default: pick existing when there are any, otherwise the inline
  // "+ New client" form so a first-time producer doesn't see an empty
  // dropdown.
  const [clientMode, setClientMode] = useState<ClientMode>(
    clients.length > 0 ? "existing" : "new",
  );
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientNameTouched, setNewClientNameTouched] = useState(false);
  const [newClientEmailTouched, setNewClientEmailTouched] = useState(false);

  // Product picker state. Default: first product so the producer can
  // submit with one click for the common single-product case.
  const [productId, setProductId] = useState<string>("");
  const [deadline, setDeadline] = useState<string>(""); // YYYY-MM-DD
  // Total + deposit live as STRINGS in the input so the producer can
  // clear them and re-type without us thrashing the value. We parse to
  // cents at submit time.
  const [totalUnits, setTotalUnits] = useState<string>("");
  const [depositUnits, setDepositUnits] = useState<string>("");

  // Reset form state every time the modal opens. Carrying values
  // across open/close is confusing — same convention as NewClientModal.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTitleTouched(false);
    setClientMode(clients.length > 0 ? "existing" : "new");
    setSelectedClientId("");
    setNewClientName("");
    setNewClientEmail("");
    setNewClientNameTouched(false);
    setNewClientEmailTouched(false);
    const firstProduct = products[0];
    setProductId(firstProduct ? firstProduct.id : "");
    setDeadline("");
    if (firstProduct) {
      setTotalUnits((firstProduct.priceCents / 100).toFixed(2));
      setDepositUnits(
        ((firstProduct.priceCents * firstProduct.depositPct) / 10000).toFixed(
          2,
        ),
      );
    } else {
      setTotalUnits("");
      setDepositUnits("");
    }
    // Only `open` is a real trigger — depending on `products` array
    // identity (not content) caused the form to silently reset
    // mid-edit on any parent re-render that built a new array.
    // (react-hooks/exhaustive-deps isn't configured in this repo, so
    // no inline override needed.)
  }, [open]);

  // Whenever the producer picks a different product, repopulate the
  // total + deposit defaults. The producer can edit afterwards.
  const selectedProduct = useMemo<NewProjectModalProductOption | null>(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );
  useEffect(() => {
    if (!selectedProduct) return;
    setTotalUnits((selectedProduct.priceCents / 100).toFixed(2));
    setDepositUnits(
      (
        (selectedProduct.priceCents * selectedProduct.depositPct) /
        10000
      ).toFixed(2),
    );
  }, [selectedProduct]);

  const titleState: ValidationState = titleTouched
    ? validateDisplayName(title)
    : { kind: "idle" };
  const newClientNameState: ValidationState =
    clientMode === "new" && newClientNameTouched
      ? validateDisplayName(newClientName)
      : { kind: "idle" };
  const newClientEmailState: ValidationState =
    clientMode === "new" && newClientEmailTouched
      ? validateEmail(newClientEmail)
      : { kind: "idle" };

  const productsEmpty = products.length === 0;

  // Submit guards. We disable if:
  // - title is blank
  // - no product is picked (and there are products to pick)
  // - client mode is "new" but name/email aren't filled
  // - client mode is "existing" but nothing selected (and no lockedClient)
  // - pending (request in flight)
  const submitDisabled = (() => {
    if (pending) return true;
    if (productsEmpty) return true;
    if (title.trim().length === 0) return true;
    if (!productId) return true;
    if (!lockedClient) {
      if (clientMode === "existing" && !selectedClientId) return true;
      if (clientMode === "new") {
        if (newClientName.trim().length === 0) return true;
        if (newClientEmail.trim().length === 0) return true;
      }
    }
    return false;
  })();

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTitleTouched(true);
    if (clientMode === "new" && !lockedClient) {
      setNewClientNameTouched(true);
      setNewClientEmailTouched(true);
    }
    const finalTitleState = validateDisplayName(title);
    if (finalTitleState.kind !== "valid") {
      return;
    }

    // Resolve the artist identity. lockedClient wins (Client Space
    // hero), then a selected existing client, then the inline new
    // form. If none of those resolved, we bail (this is also covered
    // by submitDisabled but defending the call here is cheap).
    let artistName = "";
    let artistEmail = "";
    if (lockedClient) {
      artistName = lockedClient.name;
      artistEmail = lockedClient.email;
    } else if (clientMode === "existing") {
      const picked = clients.find((c) => c.id === selectedClientId);
      if (!picked) return;
      artistName = picked.name;
      artistEmail = picked.email;
    } else {
      const finalName = validateDisplayName(newClientName);
      const finalEmail = validateEmail(newClientEmail);
      if (finalName.kind !== "valid" || finalEmail.kind !== "valid") return;
      artistName = newClientName.trim();
      artistEmail = newClientEmail.trim();
    }

    // Parse total + deposit. Both are display-units (dollars). We
    // round-half-up to cents to avoid float drift on common values.
    const parseToCents = (raw: string): number | undefined => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return undefined;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) return undefined;
      return Math.round(n * 100);
    };

    const totalCents = parseToCents(totalUnits);
    const depositCents = parseToCents(depositUnits);

    startTransition(async () => {
      // exactOptionalPropertyTypes — never pass `undefined` keys.
      const payload: Parameters<typeof createProjectAction>[0] = {
        title: title.trim(),
        artistName,
        artistEmail,
      };
      if (productId) payload.productId = productId;
      if (deadline) {
        // <input type="date"> → "YYYY-MM-DD". Anchor at midnight UTC
        // so the column rounds cleanly across timezones.
        payload.deadlineAt = new Date(`${deadline}T00:00:00.000Z`).toISOString();
      }
      if (totalCents !== undefined) payload.engagementTotalCents = totalCents;
      if (depositCents !== undefined) payload.depositCents = depositCents;

      const res = await createProjectAction(payload);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Project created", "success");
      onCreated?.();
      router.refresh();
      onClose();
    });
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          aria-describedby="new-project-modal-body"
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[460px] rounded-[18px] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)] max-h-[calc(100vh-2rem)] overflow-y-auto"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                New project
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="new-project-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                {lockedClient
                  ? `For ${lockedClient.name}`
                  : "Title, client, and the product they're buying."}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="sk-press -mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>

          {productsEmpty ? (
            <div
              className="mt-4 flex items-start gap-2 rounded-[10px] border px-3 py-3 text-[13px]"
              style={{
                borderColor: "rgb(var(--brand-primary)/0.40)",
                background: "rgb(var(--brand-primary)/0.10)",
                color: "rgb(var(--fg-default))",
              }}
            >
              <Info
                size={14}
                strokeWidth={2.2}
                className="mt-0.5 shrink-0 text-[rgb(var(--brand-primary))]"
                aria-hidden
              />
              <p className="leading-snug">
                You don&rsquo;t have any products yet. Set one up in{" "}
                <Link
                  href="/dashboard/store"
                  className="font-semibold text-[rgb(var(--brand-primary))] underline-offset-2 hover:underline"
                >
                  Store
                </Link>{" "}
                first, then come back to create the project.
              </p>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            {/* Project title */}
            <FieldLabel htmlFor="new-project-title" required>
              Project title
            </FieldLabel>
            <div>
              <input
                id="new-project-title"
                type="text"
                required
                autoFocus
                value={title}
                maxLength={120}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                onBlur={() => {
                  setTitleTouched(true);
                }}
                aria-invalid={
                  titleState.kind === "invalid" || titleState.kind === "required"
                }
                placeholder="Marcus T. — Full Production"
                className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              />
              <ValidationHint state={titleState} />
            </div>

            {/* Client picker — three modes (locked / existing / new) */}
            <FieldLabel htmlFor="new-project-client" required>
              Client
            </FieldLabel>
            {lockedClient ? (
              <div
                id="new-project-client"
                className="flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2"
                style={{
                  borderColor: "rgb(var(--border-subtle))",
                  background: "rgb(var(--bg-elevated))",
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-[rgb(var(--fg-default))]">
                    {lockedClient.name}
                  </p>
                  <p className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
                    {lockedClient.email}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {clientMode === "existing" ? (
                  <>
                    <select
                      id="new-project-client"
                      value={selectedClientId}
                      onChange={(e) => {
                        setSelectedClientId(e.target.value);
                      }}
                      className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                      style={{ borderColor: "rgb(var(--border-subtle))" }}
                    >
                      <option value="">Pick a client…</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.email})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setClientMode("new");
                      }}
                      className="self-start text-[12px] font-semibold text-[rgb(var(--brand-primary))] hover:underline"
                    >
                      + New client
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <input
                        id="new-project-client-name"
                        type="text"
                        value={newClientName}
                        maxLength={80}
                        onChange={(e) => {
                          setNewClientName(e.target.value);
                        }}
                        onBlur={() => {
                          setNewClientNameTouched(true);
                        }}
                        aria-invalid={
                          newClientNameState.kind === "invalid" ||
                          newClientNameState.kind === "required"
                        }
                        placeholder="Artist or band name"
                        className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                        style={{ borderColor: "rgb(var(--border-subtle))" }}
                      />
                      <ValidationHint state={newClientNameState} />
                    </div>
                    <div>
                      <input
                        id="new-project-client-email"
                        type="email"
                        value={newClientEmail}
                        onChange={(e) => {
                          setNewClientEmail(e.target.value);
                        }}
                        onBlur={() => {
                          setNewClientEmailTouched(true);
                        }}
                        aria-invalid={
                          newClientEmailState.kind === "invalid" ||
                          newClientEmailState.kind === "required"
                        }
                        placeholder="they@example.com"
                        className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                        style={{ borderColor: "rgb(var(--border-subtle))" }}
                      />
                      <ValidationHint state={newClientEmailState} />
                    </div>
                    {clients.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setClientMode("existing");
                        }}
                        className="self-start text-[12px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                      >
                        ← Pick an existing client
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )}

            {/* Store product picker (required) */}
            <FieldLabel htmlFor="new-project-product" required>
              Store product
            </FieldLabel>
            <select
              id="new-project-product"
              required
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
              }}
              disabled={productsEmpty}
              className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] disabled:opacity-50"
              style={{ borderColor: "rgb(var(--border-subtle))" }}
            >
              {productsEmpty ? (
                <option value="">No products yet</option>
              ) : (
                <>
                  <option value="">Pick a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatMoney(p.priceCents, p.currency)}
                    </option>
                  ))}
                </>
              )}
            </select>

            {/* Hint card describing the picked product */}
            {selectedProduct ? (
              <div
                className="flex items-start gap-2 rounded-[10px] border px-3 py-2 text-[12px]"
                style={{
                  borderColor: "rgb(var(--brand-primary)/0.30)",
                  background: "rgb(var(--brand-primary)/0.08)",
                }}
              >
                <Info
                  size={13}
                  strokeWidth={2.2}
                  className="mt-0.5 shrink-0 text-[rgb(var(--brand-primary))]"
                  aria-hidden
                />
                <div className="leading-snug text-[rgb(var(--fg-muted))]">
                  {selectedProduct.description ? (
                    <p className="text-[rgb(var(--fg-default))]">
                      {selectedProduct.description}
                    </p>
                  ) : null}
                  {selectedProduct.deliverables &&
                  selectedProduct.deliverables.length > 0 ? (
                    <p className="mt-1">
                      Deliverables:{" "}
                      <span className="font-medium text-[rgb(var(--fg-default))]">
                        {selectedProduct.deliverables.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  <p className="mt-1">
                    Deposit:{" "}
                    <span className="font-medium text-[rgb(var(--fg-default))]">
                      {selectedProduct.depositPct}% (
                      {formatMoney(
                        Math.round(
                          (selectedProduct.priceCents *
                            selectedProduct.depositPct) /
                            100,
                        ),
                        selectedProduct.currency,
                      )}
                      )
                    </span>
                  </p>
                </div>
              </div>
            ) : null}

            {/* Deadline (optional) */}
            <FieldLabel htmlFor="new-project-deadline">
              Deadline{" "}
              <span className="text-[rgb(var(--fg-muted))]">(optional)</span>
            </FieldLabel>
            <input
              id="new-project-deadline"
              type="date"
              value={deadline}
              onChange={(e) => {
                setDeadline(e.target.value);
              }}
              className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
              style={{ borderColor: "rgb(var(--border-subtle))" }}
            />

            {/* Total fee + Deposit — side-by-side on most screens */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="new-project-total">Total fee</FieldLabel>
                <input
                  id="new-project-total"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={totalUnits}
                  onChange={(e) => {
                    setTotalUnits(e.target.value);
                  }}
                  placeholder="0.00"
                  className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="new-project-deposit">Deposit</FieldLabel>
                <input
                  id="new-project-deposit"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={depositUnits}
                  onChange={(e) => {
                    setDepositUnits(e.target.value);
                  }}
                  placeholder="0.00"
                  className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="sk-press inline-flex items-center justify-center rounded-[10px] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                className="sk-press inline-flex items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none"
                style={{ background: "rgb(var(--brand-primary))" }}
              >
                {pending ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="-mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
    >
      {children}
      {required ? (
        <span aria-hidden className="ml-0.5 text-[rgb(var(--fg-danger))]">
          *
        </span>
      ) : null}
    </label>
  );
}
