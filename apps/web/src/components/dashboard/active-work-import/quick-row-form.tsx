"use client";

import { ArrowLeft, Check, CircleAlert, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SaveIndicator } from "~/components/ui/save-indicator";

import { FIELD_CLASS, FieldLabel, keyboardFocusableElements } from "./import-row-editor";
import {
  formatImportMoney,
  centsToInput,
  draftTaxBreakdown,
  localDateInputValue,
  normalizedCurrency,
  paidCents,
  quickRowAllocation,
  quickRowDraft,
  quickRowSummary,
  type ActiveWorkImportDraft,
  type ImportReasonView,
  type StoreTemplateOption,
  type WorkspaceImportRow,
} from "./model";

/**
 * The five things only the producer knows. Everything else on this row is
 * proposed from a Store product and shown back before anything is created.
 */
type TypedFields = {
  artistName: string;
  email: string;
  phone: string;
  projectTitle: string;
  total: string;
  paidSoFar: string;
  paidAt: string;
};

/**
 * Seed the form from the draft so a layout switch (or reopening the row) never
 * loses typing. The draft stores a subtotal, so the typed total is read back
 * from the computed total — lossless for every total a subtotal can produce,
 * and honest about the rounded one when it cannot.
 */
function fieldsFromDraft(draft: ActiveWorkImportDraft): TypedFields {
  const totalCents = draftTaxBreakdown(draft).totalCents;
  const payment = draft.payments[0];
  return {
    artistName: draft.client.name,
    email: draft.client.email,
    phone: draft.client.phone,
    projectTitle: draft.project.title,
    total: totalCents === null || totalCents <= 0 ? "" : centsToInput(totalCents),
    paidSoFar: payment?.amount ?? "",
    paidAt: payment?.paidAt ?? localDateInputValue(),
  };
}

export function QuickRowForm({
  row,
  template,
  templates,
  mobile,
  reasons,
  saving,
  onBack,
  onChange,
  onSave,
  onChangeDetails,
  onRemove,
  removeDisabled,
}: {
  row: WorkspaceImportRow;
  /** The product this row is copying from right now. */
  template: StoreTemplateOption;
  /** Every product the producer could copy from. One means no picker. */
  templates: readonly StoreTemplateOption[];
  mobile: boolean;
  reasons: readonly ImportReasonView[];
  saving: boolean;
  onBack: () => void;
  onChange: (draft: ActiveWorkImportDraft) => void;
  /** Saves, waits for the check, then creates this one row. */
  onSave: () => Promise<void>;
  onChangeDetails: () => void;
  onRemove: () => void;
  removeDisabled: boolean;
}) {
  const [fields, setFields] = useState<TypedFields>(() => fieldsFromDraft(row.draft));
  const [stage, setStage] = useState<"form" | "summary">("form");
  const [showProblems, setShowProblems] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(() => row.draft.client.phone.trim().length > 0);
  // Minted once per row: a retry must never create a second payment.
  const [paymentOperationKey] = useState(
    () => row.draft.payments[0]?.operationKey ?? `active-work-import-payment:${crypto.randomUUID()}`,
  );

  const formRef = useRef<HTMLElement>(null);

  // Focus the phone dialog itself on open, or focus stays on the queue behind
  // it and neither Escape nor the tab trap can fire.
  useEffect(() => {
    if (mobile) formRef.current?.focus();
  }, [mobile, row.operationKey]);

  const fieldId = (name: string) => `quick-${name}-${row.operationKey}`;

  // On a phone this is a real modal over the queue, exactly as the three-step
  // editor is: Escape closes it and Tab cannot wander into the page behind.
  function handleMobileKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (!mobile) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = keyboardFocusableElements(event.currentTarget);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      formRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function chooseTemplate(next: StoreTemplateOption) {
    onChange(quickRowDraft({ ...fields, paymentOperationKey }, next, defaultsFor(next)));
  }

  function patch(next: Partial<TypedFields>) {
    const merged = { ...fields, ...next };
    setFields(merged);
    onChange(quickRowDraft({ ...merged, paymentOperationKey }, template, defaultsFor(template)));
  }

  const summary = quickRowSummary(row.draft, fields.total);
  const allocation = quickRowAllocation(row.draft);
  const created = row.materializedAtIso !== null;
  const currency = normalizedCurrency(row.draft.agreement.currency) || "USD";

  const missing = missingFields(fields);
  const blockingReasons = reasons.filter((reason) => reason.code !== "checking");

  function continueToSummary() {
    setShowProblems(true);
    if (missing.length > 0 || summary === null) return;
    setShowProblems(false);
    setStage("summary");
  }

  return (
    <section
      ref={formRef}
      className={`min-w-0 bg-[rgb(var(--bg-elevated))] ${
        mobile
          ? "sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[70] flex flex-col overflow-hidden"
          : "flex min-h-0 flex-1 flex-col"
      }`}
      role={mobile ? "dialog" : undefined}
      aria-modal={mobile ? true : undefined}
      aria-label={`Add ${fields.artistName.trim() || "active work"}`}
      tabIndex={mobile ? -1 : undefined}
      onKeyDownCapture={handleMobileKeys}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[rgb(var(--border-subtle))] px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {mobile ? (
            <button
              type="button"
              onClick={onBack}
              className="sk-press -ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-default))]"
              aria-label="Back to items"
            >
              <ArrowLeft size={19} strokeWidth={2.2} aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              {stage === "form" ? "Quick add" : "Check this"}
            </p>
            <h1 className="mt-0.5 truncate text-[17px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:text-[19px]">
              {fields.projectTitle.trim() || fields.artistName.trim() || "Work you already have"}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {row.saveState === "unchecked" ? (
            <span
              role="status"
              aria-live="polite"
              title={row.saveError ?? undefined}
              className="inline-flex items-center gap-1.5 font-mono text-[0.66rem] tracking-[0.12em] text-[rgb(var(--fg-warning-text))] uppercase"
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--fg-warning))]"
              />
              <span>Saved, but not checked yet</span>
            </span>
          ) : (
            <SaveIndicator
              status={row.saveState}
              {...(row.saveError ? { errorMessage: row.saveError } : {})}
            />
          )}
          {!created ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={removeDisabled}
              className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--fg-danger)/0.07)] hover:text-[rgb(var(--fg-danger-text))] disabled:opacity-40"
              aria-label="Remove this draft"
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {stage === "form" ? (
          <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
            <p className="text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              Tell Skitza the five things only you know. The rest — tax, currency, payment plan,
              song spaces and the agreement wording — comes from{" "}
              <span className="font-bold text-[rgb(var(--fg-default))]">{template.name}</span>, and
              you check it before anything is saved.
            </p>

            {templates.length > 1 ? (
              <div className="space-y-2">
                <FieldLabel htmlFor={fieldId("template")}>Copy from</FieldLabel>
                <select
                  id={fieldId("template")}
                  value={template.id}
                  onChange={(event) => {
                    const next = templates.find((item) => item.id === event.target.value);
                    if (next) chooseTemplate(next);
                  }}
                  className={FIELD_CLASS}
                >
                  {templates.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-2">
              <FieldLabel htmlFor={fieldId("name")}>Artist name</FieldLabel>
              <input
                id={fieldId("name")}
                value={fields.artistName}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => {
                  patch({ artistName: event.target.value });
                }}
                placeholder="Noya Levi"
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor={fieldId("email")}>Email</FieldLabel>
              <input
                id={fieldId("email")}
                type="email"
                value={fields.email}
                maxLength={320}
                autoComplete="email"
                onChange={(event) => {
                  patch({ email: event.target.value });
                }}
                placeholder="noya@example.com"
                className={FIELD_CLASS}
              />
            </div>

            {phoneOpen ? (
              <div className="space-y-2">
                <FieldLabel htmlFor={fieldId("phone")}>
                  WhatsApp number{" "}
                  <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
                </FieldLabel>
                <input
                  id={fieldId("phone")}
                  type="tel"
                  value={fields.phone}
                  maxLength={40}
                  autoComplete="tel"
                  onChange={(event) => {
                    patch({ phone: event.target.value });
                  }}
                  placeholder="+972 50…"
                  className={FIELD_CLASS}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPhoneOpen(true);
                }}
                className="sk-press inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-lg)] px-2 text-[12px] font-bold text-[rgb(var(--fg-default))]"
              >
                <Plus size={15} strokeWidth={2.2} aria-hidden />
                Add WhatsApp number
              </button>
            )}

            <div className="space-y-2">
              <FieldLabel htmlFor={fieldId("project")}>Project name</FieldLabel>
              <input
                id={fieldId("project")}
                value={fields.projectTitle}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => {
                  patch({ projectTitle: event.target.value });
                }}
                placeholder="Noya EP"
                className={FIELD_CLASS}
              />
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor={fieldId("total")}>Agreed price</FieldLabel>
              <input
                id={fieldId("total")}
                inputMode="decimal"
                value={fields.total}
                maxLength={12}
                onChange={(event) => {
                  patch({ total: event.target.value });
                }}
                placeholder="5000"
                className={FIELD_CLASS}
              />
              <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
                The whole price in {currency}, the way you told the artist it would be.
              </p>
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor={fieldId("paid")}>
                Paid so far{" "}
                <span className="font-normal text-[rgb(var(--fg-muted))]">
                  (leave empty if nothing)
                </span>
              </FieldLabel>
              <input
                id={fieldId("paid")}
                inputMode="decimal"
                value={fields.paidSoFar}
                maxLength={12}
                onChange={(event) => {
                  patch({ paidSoFar: event.target.value });
                }}
                placeholder="0"
                className={FIELD_CLASS}
              />
            </div>

            {fields.paidSoFar.trim() && fields.paidSoFar.trim() !== "0" ? (
              <div className="space-y-2">
                <FieldLabel htmlFor={fieldId("paid-at")}>When did they pay?</FieldLabel>
                <input
                  id={fieldId("paid-at")}
                  type="date"
                  value={fields.paidAt}
                  onChange={(event) => {
                    patch({ paidAt: event.target.value });
                  }}
                  className={FIELD_CLASS}
                />
              </div>
            ) : null}

            {showProblems && missing.length > 0 ? (
              <div className="space-y-1" aria-live="polite">
                {missing.map((message) => (
                  <p
                    key={message}
                    role="alert"
                    className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-danger-text))]"
                  >
                    {message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4">
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
              <p className="text-[14px] leading-relaxed font-bold text-[rgb(var(--fg-default))]">
                {summary?.parts.join(" · ")}
              </p>
              <p className="mt-2 text-[13px] text-[rgb(var(--fg-muted))]">{summary?.question}</p>
            </div>

            {summary?.roundedFromTypedTotal ? (
              <p className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-warning-text))]">
                No pre-tax price lands on exactly what you typed, so Skitza used the closest one it
                can add tax to. Open Change details to set the numbers yourself.
              </p>
            ) : null}

            <details className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 py-2.5">
              <summary className="cursor-pointer text-[12px] font-bold text-[rgb(var(--fg-default))]">
                What Skitza filled in from {template.name}
              </summary>
              <dl className="mt-3 space-y-2 text-[12px]">
                <DefaultedValue label="Service" value={row.draft.agreement.service} />
                <DefaultedValue
                  label="Deliverables"
                  value={row.draft.agreement.deliverables.filter(Boolean).join(", ")}
                />
                <DefaultedValue
                  label="Rights"
                  value={row.draft.agreement.rights.filter(Boolean).join(", ")}
                />
                <DefaultedValue label="Currency" value={currency} />
                <DefaultedValue label="Agreement wording" value={row.draft.agreement.agreementText} />
              </dl>
            </details>

            {allocation.kind === "needs_split" ? (
              <div className="flex gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning))] px-3 py-2.5">
                <CircleAlert
                  size={15}
                  strokeWidth={2.2}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-[rgb(var(--fg-warning))]"
                />
                <p className="text-[12px] leading-relaxed text-[rgb(var(--fg-default))]">
                  {formatImportMoney(paidCents(row.draft), currency)} is more than the first
                  payment of this plan. One payment belongs to one installment, so open Change
                  details and split it yourself — Skitza will not guess how the money arrived.
                </p>
              </div>
            ) : null}

            {showProblems && blockingReasons.length > 0 ? (
              <div className="space-y-1" aria-live="polite">
                {blockingReasons.map((reason) => (
                  <p
                    key={`${reason.code}:${reason.field}`}
                    role="alert"
                    className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-danger-text))]"
                  >
                    {reason.message}
                  </p>
                ))}
              </div>
            ) : null}

            {created ? (
              <p className="inline-flex items-center gap-2 text-[12.5px] font-bold text-[rgb(var(--fg-success-text))]">
                <Check size={15} strokeWidth={2.4} aria-hidden />
                Saved. {fields.artistName.trim() || "This artist"} is in Skitza.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-[rgb(var(--border-subtle))] px-3 py-3 sm:px-4">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2 sm:flex-row-reverse">
          {stage === "form" ? (
            <button
              type="button"
              onClick={continueToSummary}
              className="sk-press inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-bold text-[rgb(var(--fg-on-brand))]"
            >
              Check this deal
            </button>
          ) : created ? null : (
            <button
              type="button"
              disabled={saving || allocation.kind === "needs_split"}
              onClick={() => {
                setShowProblems(true);
                void onSave();
              }}
              className="sk-press inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-bold text-[rgb(var(--fg-on-brand))] disabled:opacity-45"
            >
              {saving ? "Saving…" : "Yes, save"}
            </button>
          )}
          <button
            type="button"
            onClick={onChangeDetails}
            className="sk-press inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[13px] font-bold text-[rgb(var(--fg-default))]"
          >
            Change details
          </button>
          {stage === "summary" && !created ? (
            <button
              type="button"
              onClick={() => {
                setStage("form");
              }}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-bold text-[rgb(var(--fg-muted))] sm:flex-1"
            >
              Back
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

function DefaultedValue({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-semibold text-[rgb(var(--fg-muted))]">{label}</dt>
      <dd className="leading-relaxed text-[rgb(var(--fg-default))]">{value}</dd>
    </div>
  );
}

function missingFields(fields: TypedFields): readonly string[] {
  const missing: string[] = [];
  if (!fields.artistName.trim()) missing.push("Add the artist's name.");
  if (!fields.email.trim()) missing.push("Add an email — Skitza needs one to hold the client.");
  if (!fields.projectTitle.trim()) missing.push("Add a project name.");
  if (!fields.total.trim()) missing.push("Add the agreed price.");
  if (fields.paidSoFar.trim() && fields.paidSoFar.trim() !== "0" && !fields.paidAt.trim()) {
    missing.push("Say which day they paid.");
  }
  return missing;
}

function defaultsFor(template: StoreTemplateOption) {
  return {
    defaultCurrency: template.currency,
    defaultTaxMode: template.taxMode,
    defaultTaxRatePct: template.taxRatePct,
  };
}
