"use client";

import { PaymentStep } from "~/app/(producer)/dashboard/store/editor-steps/payment-step";
import { TaxModeSegmented } from "~/components/dashboard/tax-mode-segmented";

import {
  CURRENCIES,
  MAX_AGREEMENT_LENGTH,
  MAX_DELIVERABLES,
  MAX_DELIVERABLE_LENGTH,
  MAX_RIGHTS,
  MAX_RIGHT_LENGTH,
  MAX_SERVICE_LENGTH,
  MAX_TAGLINE_LENGTH,
  privateOfferPriceCents,
  privateOfferTaxBreakdown,
  totalForTemplateQuantity,
  type PrivateOfferComposerDraft,
} from "./private-offer-editor-model";
import type { PrivateOfferTemplateProduct } from "./private-offer-template-types";

export const PRIVATE_OFFER_INPUT_CLASS =
  "min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-10 sm:rounded-[var(--radius-md)] sm:text-[13px]";
const TEXTAREA_CLASS = `${PRIVATE_OFFER_INPUT_CLASS} resize-y py-2.5 leading-relaxed`;

type PatchDraft = (patch: Partial<PrivateOfferComposerDraft>) => void;

export interface PrivateOfferStepRecipient {
  id: string;
  name: string;
  email: string;
}

export interface PrivateOfferStepProject {
  id: string;
  label: string;
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase"
    >
      {children}
    </label>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-4 sm:p-5">
      <h3 className="font-display text-[16px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
        {title}
      </h3>
      {hint ? (
        <p className="mt-1 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">{hint}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly Readonly<{ value: T; label: string; disabled?: boolean }>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => {
            onChange(option.value);
          }}
          className={`sk-press min-h-11 rounded-[var(--radius-lg)] border px-3 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 sm:rounded-[var(--radius-md)] ${
            value === option.value
              ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
              : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RecipientProjectFields({
  idPrefix,
  draft,
  recipients,
  lockedClientId,
  projects,
  projectsStatus,
  projectsError,
  onRetryProjects,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  recipients: readonly PrivateOfferStepRecipient[];
  lockedClientId?: string;
  projects: readonly PrivateOfferStepProject[];
  projectsStatus: "idle" | "loading" | "ready" | "error";
  projectsError?: string;
  onRetryProjects?: () => void;
  patch: PatchDraft;
}) {
  const selectedRecipient = recipients.find(
    (recipient) => recipient.id === (lockedClientId ?? draft.clientContactId),
  );
  const hasExistingRecipient = Boolean(
    lockedClientId ?? (draft.recipientKind === "existing" ? draft.clientContactId : ""),
  );
  const canUseExistingProject =
    draft.targetKind === "existing" ||
    (hasExistingRecipient && projectsStatus === "ready" && projects.length > 0);

  return (
    <div className="space-y-4">
      <Section
        title="Who is this for?"
        hint="Only this artist can open and accept the exact terms you send."
      >
        {lockedClientId ? (
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-3 sm:rounded-[var(--radius-md)]">
            <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
              {selectedRecipient?.name ?? "Selected client"}
            </p>
            {selectedRecipient?.email ? (
              <p className="mt-0.5 min-w-0 text-[12px] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-muted))]">
                {selectedRecipient.email}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <SegmentedChoice
              label="Recipient type"
              value={draft.recipientKind}
              options={[
                { value: "existing", label: "Existing client" },
                { value: "new", label: "Invite by email" },
              ]}
              onChange={(recipientKind) => {
                patch({
                  recipientKind,
                  targetKind: recipientKind === "new" ? "new" : draft.targetKind,
                  targetProjectId: recipientKind === "new" ? "" : draft.targetProjectId,
                });
              }}
            />
            {draft.recipientKind === "existing" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${idPrefix}-recipient`}>Recipient</Label>
                <select
                  id={`${idPrefix}-recipient`}
                  value={draft.clientContactId}
                  required
                  onChange={(event) => {
                    patch({
                      clientContactId: event.target.value,
                      targetKind: "new",
                      targetProjectId: "",
                    });
                  }}
                  className={PRIVATE_OFFER_INPUT_CLASS}
                >
                  <option value="">Choose a client…</option>
                  {recipients.map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>
                      {recipient.name} — {recipient.email}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${idPrefix}-new-name`}>Name</Label>
                  <input
                    id={`${idPrefix}-new-name`}
                    value={draft.newRecipientName}
                    required
                    maxLength={160}
                    autoComplete="name"
                    onChange={(event) => {
                      patch({ newRecipientName: event.target.value });
                    }}
                    className={PRIVATE_OFFER_INPUT_CLASS}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${idPrefix}-new-email`}>Email</Label>
                  <input
                    id={`${idPrefix}-new-email`}
                    type="email"
                    value={draft.newRecipientEmail}
                    required
                    maxLength={320}
                    autoComplete="email"
                    onChange={(event) => {
                      patch({ newRecipientEmail: event.target.value });
                    }}
                    className={PRIVATE_OFFER_INPUT_CLASS}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Where should accepted work go?">
        <SegmentedChoice
          label="Project after acceptance"
          value={draft.targetKind}
          options={[
            { value: "new", label: "Create a new project" },
            {
              value: "existing",
              label: "Add to an existing project",
              disabled: !canUseExistingProject,
            },
          ]}
          onChange={(targetKind) => {
            if (targetKind === "existing" && !canUseExistingProject) return;
            patch({
              targetKind,
              targetProjectId: targetKind === "new" ? "" : draft.targetProjectId,
            });
          }}
        />
        {draft.targetKind === "new" && !canUseExistingProject ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p
              role={
                projectsStatus === "error"
                  ? "alert"
                  : projectsStatus === "loading"
                    ? "status"
                    : undefined
              }
              className={`min-w-0 text-[11.5px] leading-relaxed ${
                projectsStatus === "error"
                  ? "text-[rgb(var(--fg-danger))]"
                  : "text-[rgb(var(--fg-muted))]"
              }`}
            >
              {draft.recipientKind === "new" && !lockedClientId
                ? "New recipients start with a new project."
                : !hasExistingRecipient
                  ? "Choose an existing client to use one of their projects."
                  : projectsStatus === "loading" || projectsStatus === "idle"
                    ? "Loading this client’s projects…"
                    : projectsStatus === "error"
                      ? (projectsError ??
                        "Existing projects could not be loaded. A new project remains selected.")
                      : "This client has no existing projects yet."}
            </p>
            {projectsStatus === "error" && onRetryProjects ? (
              <button
                type="button"
                onClick={onRetryProjects}
                className="sk-press inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-lg)] px-3 text-[12px] font-semibold text-[rgb(var(--brand-primary-text))] hover:bg-[rgb(var(--brand-primary)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {draft.targetKind === "existing" ? (
          <div className="mt-3 flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-project`}>Existing project</Label>
            <select
              id={`${idPrefix}-project`}
              value={draft.targetProjectId}
              required
              disabled={projectsStatus === "loading"}
              onChange={(event) => {
                patch({ targetProjectId: event.target.value });
              }}
              className={PRIVATE_OFFER_INPUT_CLASS}
            >
              <option value="">
                {projectsStatus === "loading"
                  ? "Loading projects…"
                  : projects.length === 0
                    ? "No projects available"
                    : "Choose a project…"}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
            {projectsStatus === "error" ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="alert" className="min-w-0 text-[12px] text-[rgb(var(--fg-danger))]">
                  {projectsError ??
                    "Projects could not be loaded. Choose a new project or try again."}
                </p>
                {onRetryProjects ? (
                  <button
                    type="button"
                    onClick={onRetryProjects}
                    className="sk-press inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-lg)] px-3 text-[12px] font-semibold text-[rgb(var(--brand-primary-text))] hover:bg-[rgb(var(--brand-primary)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)]"
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function privateOfferPaymentSummary(
  draft: PrivateOfferComposerDraft,
  cashPriceCents: number | null,
): string {
  if (cashPriceCents === null) return "Complete the private subtotal";
  if (cashPriceCents === 0) return "No payment needed";
  const plans = [
    ...(draft.fullPlan ? ["Pay in full"] : []),
    ...(draft.splitPlan ? ["50 / 50"] : []),
    ...(draft.monthlyPlan
      ? [`Monthly · ${draft.monthlyInstallments || "—"} payments`]
      : []),
  ];
  return plans.length > 0 ? plans.join(" · ") : "No payment option copied";
}

export function PrivateOfferQuickStep({
  idPrefix,
  draft,
  templateProduct,
  recipients,
  lockedClientId,
  projects,
  projectsStatus,
  projectsError,
  onRetryProjects,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  templateProduct: PrivateOfferTemplateProduct;
  recipients: readonly PrivateOfferStepRecipient[];
  lockedClientId?: string;
  projects: readonly PrivateOfferStepProject[];
  projectsStatus: "idle" | "loading" | "ready" | "error";
  projectsError?: string;
  onRetryProjects?: () => void;
  patch: PatchDraft;
}) {
  const parsedPriceCents = privateOfferPriceCents(draft.cashPrice);
  const priceIsValid = parsedPriceCents !== null;
  const priceCents = parsedPriceCents ?? 0;
  const currencyIsValid = /^[A-Z]{3}$/.test(draft.currency);
  const perSongPricing =
    templateProduct.pricing.kind === "per_song" ? templateProduct.pricing : null;
  const templateQuantity = /^\d+$/.test(draft.templateQuantity.trim())
    ? Number.parseInt(draft.templateQuantity, 10)
    : Number.NaN;
  const quantityIsValid =
    perSongPricing === null ||
    (Number.isSafeInteger(templateQuantity) && templateQuantity >= 1 && templateQuantity <= 1_000);
  const pricePreviewIsValid = priceIsValid && currencyIsValid && quantityIsValid;
  const taxRate = Number.parseInt(draft.taxRatePct, 10);
  const tax =
    pricePreviewIsValid
      ? privateOfferTaxBreakdown(
          priceCents,
          draft.taxMode,
          Number.isSafeInteger(taxRate) ? taxRate : 0,
        )
      : null;
  const hourlyPricing = templateProduct.pricing.kind === "hourly" ? templateProduct.pricing : null;
  const currencyOptions = CURRENCIES.includes(draft.currency)
    ? CURRENCIES
    : ([draft.currency, ...CURRENCIES].filter(Boolean) as readonly string[]);
  const paymentSummary = privateOfferPaymentSummary(draft, parsedPriceCents);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.15em] text-[rgb(var(--brand-primary-dark))] uppercase">
            Based on Store product
          </p>
          <p className="font-display mt-1 text-[15px] font-bold break-words text-[rgb(var(--fg-default))]">
            {templateProduct.source.productName}
          </p>
        </div>
        <span className="shrink-0 text-right text-[11px] leading-snug font-semibold text-[rgb(var(--fg-muted))]">
          Original
          <br />
          unchanged
        </span>
      </div>

      <RecipientProjectFields
        idPrefix={idPrefix}
        draft={draft}
        recipients={recipients}
        {...(lockedClientId ? { lockedClientId } : {})}
        projects={projects}
        projectsStatus={projectsStatus}
        {...(projectsError ? { projectsError } : {})}
        {...(onRetryProjects ? { onRetryProjects } : {})}
        patch={patch}
      />

      <Section
        title="Set the private price"
        hint={
          hourlyPricing
            ? "Set one fixed subtotal for this private offer. The Store hourly rate is context only."
            : "Everything else stays copied from the Store product until you choose Customize terms."
        }
      >
        {hourlyPricing ? (
          <p className="mb-4 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] px-3 py-2.5 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Store rate: {formatMoney(hourlyPricing.hourlyRateCents, draft.currency)} per hour. No
            number of hours is assumed here.
          </p>
        ) : null}
        <div
          className={`grid grid-cols-1 gap-4 ${
            perSongPricing
              ? "sm:grid-cols-[minmax(0,1fr)_7rem_7rem]"
              : "sm:grid-cols-[minmax(0,1fr)_9rem]"
          }`}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-price`}>
              {hourlyPricing ? "Fixed private subtotal" : "Cash price"}
            </Label>
            <div className="relative">
              <input
                id={`${idPrefix}-price`}
                value={draft.cashPrice}
                required
                inputMode="decimal"
                aria-invalid={!priceIsValid}
                aria-describedby={`${idPrefix}-price-help`}
                onChange={(event) => {
                  const cashPrice = event.target.value;
                  const nextPriceCents = privateOfferPriceCents(cashPrice);
                  patch({
                    cashPrice,
                    ...(nextPriceCents === 0
                      ? { fullPlan: false, splitPlan: false, monthlyPlan: false }
                      : nextPriceCents !== null &&
                          !draft.fullPlan &&
                          !draft.splitPlan &&
                          !draft.monthlyPlan
                        ? { fullPlan: true }
                        : {}),
                  });
                }}
                className={`${PRIVATE_OFFER_INPUT_CLASS} font-amount pr-16 text-[20px] font-bold tabular-nums`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-bold text-[rgb(var(--fg-muted))]">
                {draft.currency}
              </span>
            </div>
            <p id={`${idPrefix}-price-help`} className="text-[11.5px] text-[rgb(var(--fg-muted))]">
              {!priceIsValid
                ? hourlyPricing
                  ? "Enter the fixed subtotal for this offer."
                  : "Enter a valid price with up to two decimal places."
                : priceCents === 0
                  ? "Free offers have no payment schedule."
                  : "Subtotal before added tax."}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-quick-currency`}>Currency</Label>
            <select
              id={`${idPrefix}-quick-currency`}
              value={draft.currency}
              required
              onChange={(event) => {
                patch({ currency: event.target.value });
              }}
              className={PRIVATE_OFFER_INPUT_CLASS}
            >
              {!draft.currency ? <option value="">Choose…</option> : null}
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          {perSongPricing ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-quantity`}>Songs</Label>
              <input
                id={`${idPrefix}-quantity`}
                type="number"
                min={1}
                max={1_000}
                step={1}
                required
                aria-invalid={!quantityIsValid}
                aria-describedby={`${idPrefix}-quantity-help`}
                value={draft.templateQuantity}
                onChange={(event) => {
                  const templateQuantity = event.target.value;
                  const quantity = /^\d+$/.test(templateQuantity.trim())
                    ? Number.parseInt(templateQuantity, 10)
                    : Number.NaN;
                  patch({
                    templateQuantity,
                    ...(Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1_000
                      ? {
                          includedSongSpaces: String(quantity),
                          cashPrice: (
                            totalForTemplateQuantity(perSongPricing.volumeTiers, quantity) / 100
                          ).toFixed(2),
                        }
                      : {}),
                  });
                }}
                className={PRIVATE_OFFER_INPUT_CLASS}
              />
              <p
                id={`${idPrefix}-quantity-help`}
                className={`text-[11.5px] ${
                  quantityIsValid
                    ? "text-[rgb(var(--fg-muted))]"
                    : "font-medium text-[rgb(var(--fg-danger))]"
                }`}
              >
                {quantityIsValid
                  ? "Volume rate applied automatically."
                  : "Choose a whole number of songs from 1 to 1,000."}
              </p>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-[rgb(var(--border-subtle))] pt-3">
          <p className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Subtotal{" "}
            {pricePreviewIsValid ? formatMoney(priceCents, draft.currency) : "—"}
            {" · "}
            {Number.isSafeInteger(taxRate) ? String(taxRate) : "—"}% tax{" "}
            {draft.taxMode === "tax_added"
              ? "added"
              : draft.taxMode === "tax_included"
                ? "included"
                : "free"}
          </p>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              Artist pays
            </p>
            <p className="font-amount mt-1 text-[20px] font-bold text-[rgb(var(--fg-default))]">
              {tax ? formatMoney(tax.totalCents, draft.currency) : "—"}
            </p>
          </div>
        </div>
        <div
          aria-label="Payment summary"
          className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5"
        >
          <p className="text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
            Payment options
          </p>
          <p className="mt-1 text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
            {paymentSummary}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Customize terms to change the payment schedule.
          </p>
        </div>
      </Section>
    </div>
  );
}

export function PrivateOfferDetailsStep({
  idPrefix,
  draft,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  patch: PatchDraft;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-name`}>Offer title</Label>
          <input
            id={`${idPrefix}-name`}
            value={draft.name}
            required
            maxLength={200}
            onChange={(event) => {
              patch({ name: event.target.value });
            }}
            className={PRIVATE_OFFER_INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-service`}>Service</Label>
          <input
            id={`${idPrefix}-service`}
            value={draft.service}
            required
            maxLength={MAX_SERVICE_LENGTH}
            onChange={(event) => {
              patch({ service: event.target.value });
            }}
            className={PRIVATE_OFFER_INPUT_CLASS}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-tagline`}>Short description</Label>
        <input
          id={`${idPrefix}-tagline`}
          value={draft.tagline}
          maxLength={MAX_TAGLINE_LENGTH}
          onChange={(event) => {
            patch({ tagline: event.target.value });
          }}
          className={PRIVATE_OFFER_INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-deliverables`}>Deliverables · one per line</Label>
        <textarea
          id={`${idPrefix}-deliverables`}
          value={draft.deliverables}
          required
          rows={7}
          maxLength={MAX_DELIVERABLES * MAX_DELIVERABLE_LENGTH + MAX_DELIVERABLES - 1}
          onChange={(event) => {
            patch({ deliverables: event.target.value });
          }}
          className={TEXTAREA_CLASS}
        />
      </div>
    </div>
  );
}

export function PrivateOfferPriceStep({
  idPrefix,
  draft,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  patch: PatchDraft;
}) {
  const subtotal = privateOfferPriceCents(draft.cashPrice) ?? 0;
  const rate = Number.parseInt(draft.taxRatePct, 10);
  const tax = privateOfferTaxBreakdown(
    subtotal,
    draft.taxMode,
    Number.isSafeInteger(rate) ? rate : 0,
  );
  const currencyOptions = CURRENCIES.includes(draft.currency)
    ? CURRENCIES
    : ([draft.currency, ...CURRENCIES].filter(Boolean) as readonly string[]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-cash-price`}>Cash price</Label>
          <input
            id={`${idPrefix}-cash-price`}
            value={draft.cashPrice}
            required
            inputMode="decimal"
            onChange={(event) => {
              const cashPrice = event.target.value;
              patch({
                cashPrice,
                ...(privateOfferPriceCents(cashPrice) === 0
                  ? { fullPlan: false, splitPlan: false, monthlyPlan: false }
                  : {}),
              });
            }}
            className={`${PRIVATE_OFFER_INPUT_CLASS} font-amount text-[20px] font-bold tabular-nums`}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-currency`}>Currency</Label>
          <select
            id={`${idPrefix}-currency`}
            value={draft.currency}
            required
            onChange={(event) => {
              patch({ currency: event.target.value });
            }}
            className={PRIVATE_OFFER_INPUT_CLASS}
          >
            {!draft.currency ? <option value="">Choose currency…</option> : null}
            {currencyOptions.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
          Tax treatment
        </p>
        <TaxModeSegmented
          value={draft.taxMode}
          onChange={(taxMode) => {
            patch({ taxMode });
          }}
          ariaLabel="Private offer tax treatment"
        />
      </div>
      {draft.taxMode !== "tax_free" ? (
        <div className="flex max-w-48 flex-col gap-2">
          <Label htmlFor={`${idPrefix}-tax-rate`}>Tax rate (%)</Label>
          <input
            id={`${idPrefix}-tax-rate`}
            type="number"
            min={0}
            max={100}
            step={1}
            value={draft.taxRatePct}
            onChange={(event) => {
              patch({ taxRatePct: event.target.value });
            }}
            className={PRIVATE_OFFER_INPUT_CLASS}
          />
        </div>
      ) : null}
      <dl className="divide-y divide-[rgb(var(--border-subtle))] rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[13px]">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-[rgb(var(--fg-muted))]">Subtotal</dt>
          <dd className="font-semibold tabular-nums">{formatMoney(subtotal, draft.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-[rgb(var(--fg-muted))]">Tax</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(tax?.taxCents ?? 0, draft.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-3 font-bold">
          <dt>Total artist pays</dt>
          <dd className="font-amount text-[18px] tabular-nums">
            {formatMoney(tax?.totalCents ?? subtotal, draft.currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function PrivateOfferPaymentStep({
  draft,
  patch,
}: {
  draft: PrivateOfferComposerDraft;
  patch: PatchDraft;
}) {
  const subtotal = privateOfferPriceCents(draft.cashPrice) ?? 0;
  const rate = Number.parseInt(draft.taxRatePct, 10);
  const total = privateOfferTaxBreakdown(
    subtotal,
    draft.taxMode,
    Number.isSafeInteger(rate) ? rate : 0,
  )?.totalCents;
  if (subtotal === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <h3 className="font-display text-[16px] font-bold">No payment schedule</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          This is a free offer. The artist accepts the terms without making a payment.
        </p>
      </div>
    );
  }
  return (
    <PaymentStep
      selection={{
        full: draft.fullPlan,
        split50: draft.splitPlan,
        monthly: draft.monthlyPlan,
        monthlyInstallments: Number.parseInt(draft.monthlyInstallments, 10) || 4,
      }}
      previewTotalCents={total ?? subtotal}
      currency={draft.currency}
      pricingModel="flat"
      onChange={(selection) => {
        patch({
          fullPlan: selection.full,
          splitPlan: selection.split50,
          monthlyPlan: selection.monthly,
          monthlyInstallments: String(selection.monthlyInstallments),
        });
      }}
    />
  );
}

function NumericField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={PRIVATE_OFFER_INPUT_CLASS}
      />
    </div>
  );
}

export function PrivateOfferDeliveryStep({
  idPrefix,
  draft,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  patch: PatchDraft;
}) {
  return (
    <div className="space-y-5">
      <NumericField
        id={`${idPrefix}-song-spaces`}
        label="Song spaces included"
        value={draft.includedSongSpaces}
        min={0}
        max={1_000}
        onChange={(includedSongSpaces) => {
          patch({ includedSongSpaces });
        }}
      />
      <fieldset className="space-y-3 border-t border-[rgb(var(--border-subtle))] pt-5">
        <legend className="font-display text-[16px] font-bold">Bookable sessions</legend>
        <SegmentedChoice
          label="Bookable sessions included"
          value={draft.hasSessionAllowance ? "yes" : "no"}
          options={[
            { value: "yes", label: "Sessions included" },
            { value: "no", label: "Delivery only" },
          ]}
          onChange={(value) => {
            patch({ hasSessionAllowance: value === "yes" });
          }}
        />
        {draft.hasSessionAllowance ? (
          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                Allowance
              </p>
              <SegmentedChoice
                label="Session allowance"
                value={draft.sessionLimitMode}
                options={[
                  { value: "fixed", label: "Fixed" },
                  { value: "unlimited", label: "Unlimited" },
                ]}
                onChange={(sessionLimitMode) => {
                  patch({ sessionLimitMode });
                }}
              />
            </div>
            {draft.sessionLimitMode === "fixed" ? (
              <NumericField
                id={`${idPrefix}-session-count`}
                label="Session count"
                value={draft.sessionCount}
                min={1}
                max={1_000}
                onChange={(sessionCount) => {
                  patch({ sessionCount });
                }}
              />
            ) : null}
            <NumericField
              id={`${idPrefix}-session-duration`}
              label="Minutes per session"
              value={draft.sessionDurationMin}
              min={1}
              max={1_440}
              onChange={(sessionDurationMin) => {
                patch({ sessionDurationMin });
              }}
            />
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`${idPrefix}-location`}>Location</Label>
              <input
                id={`${idPrefix}-location`}
                value={draft.sessionLocationType}
                maxLength={100}
                onChange={(event) => {
                  patch({ sessionLocationType: event.target.value });
                }}
                className={PRIVATE_OFFER_INPUT_CLASS}
              />
            </div>
            <NumericField
              id={`${idPrefix}-buffer`}
              label="Buffer between sessions (min)"
              value={draft.sessionBufferMinutes}
              min={0}
              max={1_440}
              onChange={(sessionBufferMinutes) => {
                patch({ sessionBufferMinutes });
              }}
            />
            <NumericField
              id={`${idPrefix}-lead`}
              label="Minimum booking notice (hours)"
              value={draft.sessionMinLeadHours}
              min={0}
              max={8_760}
              onChange={(sessionMinLeadHours) => {
                patch({ sessionMinLeadHours });
              }}
            />
          </div>
        ) : null}
      </fieldset>
      <fieldset className="space-y-3 border-t border-[rgb(var(--border-subtle))] pt-5">
        <legend className="font-display text-[16px] font-bold">Revisions</legend>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Revision allowance">
          {(["none", "fixed", "unlimited"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={draft.revisionMode === mode}
              onClick={() => {
                patch({ revisionMode: mode });
              }}
              className={`sk-press min-h-11 rounded-[var(--radius-lg)] border px-2 text-[12.5px] font-semibold capitalize sm:rounded-[var(--radius-md)] ${
                draft.revisionMode === mode
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        {draft.revisionMode === "fixed" ? (
          <div className="max-w-48">
            <NumericField
              id={`${idPrefix}-revision-count`}
              label="Revision rounds"
              value={draft.revisionCount}
              min={0}
              max={1_000}
              onChange={(revisionCount) => {
                patch({ revisionCount });
              }}
            />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

function RoyaltyPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: PrivateOfferComposerDraft["masterMode"];
  onChange: (value: "none" | "percentage" | "agreement") => void;
}) {
  return (
    <div className="grid grid-cols-1 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {(["none", "percentage", "agreement"] as const).map((mode) => (
        <label key={mode} className="flex min-h-11 cursor-pointer items-center gap-2 px-2 py-2.5">
          <input
            type="radio"
            name={name}
            checked={value === mode}
            onChange={() => {
              onChange(mode);
            }}
            className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
          />
          <span className="text-[12.5px] font-medium">
            {mode === "none" ? "No royalty" : mode === "percentage" ? "Percentage" : "In agreement"}
          </span>
        </label>
      ))}
    </div>
  );
}

export function PrivateOfferRightsStep({
  idPrefix,
  draft,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  patch: PatchDraft;
}) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="font-display text-[16px] font-bold">Master royalty</legend>
        <RoyaltyPicker
          name={`${idPrefix}-master-mode`}
          value={draft.masterMode}
          onChange={(masterMode) => {
            patch({ masterMode });
          }}
        />
        {draft.masterMode === "percentage" ? (
          <div className="max-w-48">
            <NumericField
              id={`${idPrefix}-master-percentage`}
              label="Master percentage"
              value={draft.masterPercentage}
              min={0.01}
              max={100}
              step={0.01}
              onChange={(masterPercentage) => {
                patch({ masterPercentage });
              }}
            />
          </div>
        ) : null}
      </fieldset>
      <fieldset className="space-y-3 border-t border-[rgb(var(--border-subtle))] pt-5">
        <legend className="font-display text-[16px] font-bold">Composition royalty</legend>
        <RoyaltyPicker
          name={`${idPrefix}-composition-mode`}
          value={draft.compositionMode}
          onChange={(compositionMode) => {
            patch({ compositionMode });
          }}
        />
        {draft.compositionMode === "percentage" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumericField
              id={`${idPrefix}-composition-percentage`}
              label="Composition percentage"
              value={draft.compositionPercentage}
              min={0.01}
              max={100}
              step={0.01}
              onChange={(compositionPercentage) => {
                patch({ compositionPercentage });
              }}
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-composition-role`}>Contribution role</Label>
              <select
                id={`${idPrefix}-composition-role`}
                value={draft.compositionRole}
                onChange={(event) => {
                  patch({
                    compositionRole: event.target
                      .value as PrivateOfferComposerDraft["compositionRole"],
                  });
                }}
                className={PRIVATE_OFFER_INPUT_CLASS}
              >
                <option value="">Not specified</option>
                <option value="composer">Composer</option>
                <option value="lyricist">Lyricist</option>
                <option value="arranger">Arranger</option>
                <option value="publisher">Publisher</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor={`${idPrefix}-society`}>Collecting society · optional</Label>
              <input
                id={`${idPrefix}-society`}
                value={draft.collectingSociety}
                maxLength={200}
                placeholder="e.g. ACUM"
                onChange={(event) => {
                  patch({ collectingSociety: event.target.value });
                }}
                className={PRIVATE_OFFER_INPUT_CLASS}
              />
            </div>
          </div>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-royalty-notes`}>Royalty notes · optional</Label>
        <textarea
          id={`${idPrefix}-royalty-notes`}
          value={draft.royaltyNotes}
          maxLength={4_000}
          rows={3}
          onChange={(event) => {
            patch({ royaltyNotes: event.target.value });
          }}
          className={TEXTAREA_CLASS}
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] pt-5">
        <Label htmlFor={`${idPrefix}-rights`}>Rights included · one per line</Label>
        <textarea
          id={`${idPrefix}-rights`}
          value={draft.rights}
          required
          maxLength={MAX_RIGHTS * MAX_RIGHT_LENGTH + MAX_RIGHTS - 1}
          rows={5}
          onChange={(event) => {
            patch({ rights: event.target.value });
          }}
          className={TEXTAREA_CLASS}
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] pt-5">
        <Label htmlFor={`${idPrefix}-agreement`}>Exact agreement</Label>
        {draft.agreementNeedsCompletion ? (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.1)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--fg-default))]"
          >
            This Store product used terms that cannot be copied. Write the exact agreement before
            sending.
          </p>
        ) : null}
        <textarea
          id={`${idPrefix}-agreement`}
          value={draft.agreementText}
          required
          maxLength={MAX_AGREEMENT_LENGTH}
          rows={10}
          onChange={(event) => {
            patch({ agreementText: event.target.value, agreementNeedsCompletion: false });
          }}
          className={TEXTAREA_CLASS}
        />
        <p className="text-right text-[11px] text-[rgb(var(--fg-faint))]">
          {draft.agreementText.length.toLocaleString()} / {MAX_AGREEMENT_LENGTH.toLocaleString()}
        </p>
      </div>
    </div>
  );
}
