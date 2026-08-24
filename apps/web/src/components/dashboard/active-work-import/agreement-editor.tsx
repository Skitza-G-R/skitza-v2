"use client";

import { ChevronDown, CirclePlus, FileUp, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ProofUploadView } from "./payment-history-editor";

import {
  applyTemplate,
  draftTaxBreakdown,
  formatImportMoney,
  type ActiveWorkImportDraft,
  type ImportReasonView,
  type StoreTemplateOption,
} from "./model";

const FIELD_CLASS =
  "sk-native-field min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-9 sm:rounded-[var(--radius-md)] sm:text-[13px]";

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
      {children}
    </label>
  );
}

function FieldIssues({
  id,
  reasons,
  fields,
}: {
  id: string;
  reasons: readonly ImportReasonView[];
  fields: readonly string[];
}) {
  const matching = reasonsForFields(reasons, fields);
  if (matching.length === 0) return null;
  return (
    <div id={id} className="space-y-1" aria-live="polite">
      {matching.map((reason) => (
        <p
          key={`${reason.code}:${reason.field}`}
          role="alert"
          className="text-[11px] leading-relaxed text-[rgb(var(--fg-danger-text))]"
        >
          {reason.message}
        </p>
      ))}
    </div>
  );
}

function reasonsForFields(
  reasons: readonly ImportReasonView[],
  fields: readonly string[],
): readonly ImportReasonView[] {
  return reasons.filter((reason) =>
    fields.some((field) => reason.field === field || reason.field.startsWith(`${field}.`)),
  );
}

function issueAttributes(
  reasons: readonly ImportReasonView[],
  fields: readonly string[],
  issueId: string,
) {
  return reasonsForFields(reasons, fields).length > 0
    ? { "aria-describedby": issueId, "aria-invalid": true as const }
    : {};
}

function resizeAgreementTerms(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${String(Math.max(96, textarea.scrollHeight))}px`;
}

function ListEditor({
  id,
  label,
  values,
  placeholder,
  invalid,
  issueId,
  onChange,
}: {
  id: string;
  label: string;
  values: readonly string[];
  placeholder: string;
  invalid: boolean;
  issueId: string;
  onChange: (values: string[]) => void;
}) {
  const pendingFocusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const pendingIndex = pendingFocusIndexRef.current;
    if (pendingIndex === null) return;
    pendingFocusIndexRef.current = null;
    document.getElementById(`${id}-${String(pendingIndex)}`)?.focus();
  }, [id, values.length]);

  return (
    <div className="min-w-0 space-y-1.5">
      <p id={`${id}-label`} className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
        {label}
      </p>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="min-w-0 divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] sm:rounded-[var(--radius-md)]"
      >
        {values.map((value, index) => (
          <div key={`${id}:${String(index)}`} className="flex min-w-0 items-center">
            <span
              aria-hidden
              className="w-8 shrink-0 text-center font-mono text-[9px] font-semibold text-[rgb(var(--fg-faint))]"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <input
              id={`${id}-${String(index)}`}
              aria-label={`${label} ${String(index + 1)}`}
              aria-describedby={invalid ? issueId : undefined}
              aria-invalid={invalid || undefined}
              value={value}
              maxLength={300}
              onChange={(event) => {
                onChange(
                  values.map((item, itemIndex) =>
                    itemIndex === index ? event.target.value : item,
                  ),
                );
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                const next = [...values];
                next.splice(index + 1, 0, "");
                pendingFocusIndexRef.current = index + 1;
                onChange(next);
              }}
              placeholder={placeholder}
              className="min-h-11 min-w-0 flex-1 border-0 bg-transparent px-1.5 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset sm:min-h-9 sm:text-[12px]"
            />
            <button
              type="button"
              onClick={() => {
                const next = values.filter((_, itemIndex) => itemIndex !== index);
                onChange(next.length > 0 ? next : [""]);
              }}
              disabled={values.length === 1 && value.length === 0}
              aria-label={`Remove ${label.toLowerCase()} ${String(index + 1)}`}
              className="sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--fg-danger)/0.07)] hover:text-[rgb(var(--fg-danger-text))] disabled:opacity-30 sm:h-9 sm:w-9"
            >
              <Minus size={14} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          pendingFocusIndexRef.current = values.length;
          onChange([...values, ""]);
        }}
        className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-2 text-[11px] font-bold text-[rgb(var(--fg-default))] sm:min-h-9 sm:rounded-[var(--radius-md)]"
      >
        <CirclePlus size={14} strokeWidth={2.1} aria-hidden />
        Add {label.toLowerCase()}
      </button>
      <p className="text-[9.5px] text-[rgb(var(--fg-muted))]">Press Enter to add another.</p>
    </div>
  );
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgreementEditor({
  draft,
  templates,
  operationKey,
  reasons,
  onChange,
  agreementPdfUpload,
  onUploadAgreementPdf,
}: {
  draft: ActiveWorkImportDraft;
  templates: readonly StoreTemplateOption[];
  operationKey: string;
  reasons: readonly ImportReasonView[];
  onChange: (draft: ActiveWorkImportDraft) => void;
  agreementPdfUpload?: ProofUploadView | undefined;
  onUploadAgreementPdf?: ((file: File) => void) | undefined;
}) {
  const agreement = draft.agreement;
  const tax = draftTaxBreakdown(draft);
  const selectedTemplate = templates.find(
    (template) => template.id === agreement.templateProductId,
  );
  const [templatePickerOpen, setTemplatePickerOpen] = useState(!selectedTemplate);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const agreementTermsRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTemplatePickerOpen(!selectedTemplate);
    setDetailsOpen(false);
  }, [operationKey, selectedTemplate]);

  useEffect(() => {
    if (
      reasons.some(
        (reason) =>
          reason.field.startsWith("agreement.revisionRule") ||
          reason.field.startsWith("agreement.royaltyTerms"),
      )
    ) {
      setDetailsOpen(true);
    }
  }, [reasons]);

  useEffect(() => {
    if (agreementTermsRef.current) resizeAgreementTerms(agreementTermsRef.current);
  }, [agreement.agreementText]);

  function patch(patchValue: Partial<ActiveWorkImportDraft["agreement"]>) {
    onChange({ ...draft, agreement: { ...agreement, ...patchValue } });
  }

  const totalLabel =
    tax.totalCents === null
      ? "Add a valid price"
      : formatImportMoney(tax.totalCents, agreement.currency || "USD");
  const detailsConfigured =
    agreement.revisionMode !== "none" ||
    agreement.masterMode !== "none" ||
    agreement.compositionMode !== "none";
  const issueId = (field: string) => `import-${field}-issues-${operationKey}`;

  return (
    <section data-active-import-step="Agreement" className="min-w-0 py-1">
      <header className="mb-3 border-b border-[rgb(var(--border-subtle))] pb-3">
        <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
          Step 2 of 3
        </p>
        <h2 className="mt-1 text-[19px] font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          Agreement
        </h2>
        <p className="mt-0.5 max-w-[58ch] text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Record the exact outside agreement. The Artist sees it as history, not a new request.
        </p>
      </header>

      <div className="min-w-0 space-y-4">
        {selectedTemplate && !templatePickerOpen ? (
          <div className="flex min-w-0 items-center justify-between gap-3 border-y border-[rgb(var(--border-subtle))] py-2">
            <p className="min-w-0 truncate text-[12px] text-[rgb(var(--fg-muted))]">
              Filled from{" "}
              <strong className="text-[rgb(var(--fg-default))]">{selectedTemplate.name}</strong>
            </p>
            <button
              type="button"
              onClick={() => {
                setTemplatePickerOpen(true);
              }}
              className="sk-press min-h-11 shrink-0 rounded-[var(--radius-lg)] px-2 text-[12px] font-bold text-[rgb(var(--fg-default))] sm:min-h-9 sm:rounded-[var(--radius-md)]"
            >
              Change template
            </button>
          </div>
        ) : (
          <div className="min-w-0 border-b border-[rgb(var(--border-subtle))] pb-3">
            <Label htmlFor={`import-template-${operationKey}`}>
              Store template <span className="normal-case">(optional)</span>
            </Label>
            <select
              id={`import-template-${operationKey}`}
              value={agreement.templateProductId ?? ""}
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) onChange(applyTemplate(draft, template));
                else patch({ templateProductId: null });
              }}
              {...issueAttributes(
                reasons,
                ["agreement.templateProductId"],
                issueId("agreement-template"),
              )}
              className={`${FIELD_CLASS} mt-2`}
            >
              <option value="">Start without a template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[rgb(var(--fg-muted))]">
              This only fills the draft. Your Store stays unchanged.
            </p>
            <FieldIssues
              id={issueId("agreement-template")}
              reasons={reasons}
              fields={["agreement.templateProductId"]}
            />
          </div>
        )}

        <section aria-labelledby={`agreement-essentials-${operationKey}`}>
          <h3
            id={`agreement-essentials-${operationKey}`}
            className="text-[13px] font-bold text-[rgb(var(--fg-default))]"
          >
            Agreement essentials
          </h3>
          <div className="mt-2.5 grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`import-agreement-name-${operationKey}`}>Agreement name</Label>
              <input
                id={`import-agreement-name-${operationKey}`}
                value={agreement.name}
                maxLength={200}
                onChange={(event) => {
                  patch({ name: event.target.value });
                }}
                placeholder="Album production agreement"
                {...issueAttributes(reasons, ["agreement.name"], issueId("agreement-name"))}
                className={FIELD_CLASS}
              />
              <FieldIssues
                id={issueId("agreement-name")}
                reasons={reasons}
                fields={["agreement.name"]}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`import-service-${operationKey}`}>Service</Label>
              <input
                id={`import-service-${operationKey}`}
                value={agreement.service}
                maxLength={160}
                onChange={(event) => {
                  patch({ service: event.target.value });
                }}
                placeholder="Production and mixing"
                {...issueAttributes(reasons, ["agreement.service"], issueId("agreement-service"))}
                className={FIELD_CLASS}
              />
              <FieldIssues
                id={issueId("agreement-service")}
                reasons={reasons}
                fields={["agreement.service"]}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`import-price-${operationKey}`}>Agreed price</Label>
              <input
                id={`import-price-${operationKey}`}
                inputMode="decimal"
                value={agreement.subtotal}
                onChange={(event) => {
                  patch({ subtotal: event.target.value });
                }}
                placeholder="2500.00"
                {...issueAttributes(
                  reasons,
                  ["agreement.subtotalCents", "agreement.totalCents"],
                  issueId("agreement-price"),
                )}
                className={FIELD_CLASS}
              />
              <FieldIssues
                id={issueId("agreement-price")}
                reasons={reasons}
                fields={["agreement.subtotalCents", "agreement.totalCents"]}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`import-currency-${operationKey}`}>Currency</Label>
              <input
                id={`import-currency-${operationKey}`}
                value={agreement.currency}
                maxLength={3}
                onChange={(event) => {
                  patch({ currency: event.target.value.toUpperCase() });
                }}
                placeholder="USD"
                {...issueAttributes(reasons, ["agreement.currency"], issueId("agreement-currency"))}
                className={FIELD_CLASS}
              />
              <FieldIssues
                id={issueId("agreement-currency")}
                reasons={reasons}
                fields={["agreement.currency"]}
              />
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`import-tax-mode-${operationKey}`}>Tax</Label>
                <select
                  id={`import-tax-mode-${operationKey}`}
                  value={agreement.taxMode}
                  onChange={(event) => {
                    const taxMode = event.target
                      .value as ActiveWorkImportDraft["agreement"]["taxMode"];
                    patch({ taxMode, ...(taxMode === "tax_free" ? { taxRatePct: "0" } : {}) });
                  }}
                  {...issueAttributes(
                    reasons,
                    ["agreement.taxMode", "agreement.taxRatePct", "agreement.taxAmountCents"],
                    issueId("agreement-tax"),
                  )}
                  className={FIELD_CLASS}
                >
                  <option value="tax_free">No tax</option>
                  <option value="tax_included">Tax included</option>
                  <option value="tax_added">Tax added</option>
                </select>
              </div>
              {agreement.taxMode !== "tax_free" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`import-tax-rate-${operationKey}`}>Rate %</Label>
                  <input
                    id={`import-tax-rate-${operationKey}`}
                    inputMode="numeric"
                    value={agreement.taxRatePct}
                    onChange={(event) => {
                      patch({ taxRatePct: event.target.value });
                    }}
                    {...issueAttributes(
                      reasons,
                      ["agreement.taxMode", "agreement.taxRatePct", "agreement.taxAmountCents"],
                      issueId("agreement-tax"),
                    )}
                    className={FIELD_CLASS}
                  />
                </div>
              ) : (
                <div aria-hidden />
              )}
              <div className="col-span-2">
                <FieldIssues
                  id={issueId("agreement-tax")}
                  reasons={reasons}
                  fields={["agreement.taxMode", "agreement.taxRatePct", "agreement.taxAmountCents"]}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`import-song-spaces-${operationKey}`}>Song spaces</Label>
              <input
                id={`import-song-spaces-${operationKey}`}
                inputMode="numeric"
                value={agreement.includedSongSpaces}
                onChange={(event) => {
                  patch({ includedSongSpaces: event.target.value });
                }}
                {...issueAttributes(
                  reasons,
                  ["agreement.includedSongSpaces"],
                  issueId("agreement-song-spaces"),
                )}
                className={FIELD_CLASS}
              />
              <FieldIssues
                id={issueId("agreement-song-spaces")}
                reasons={reasons}
                fields={["agreement.includedSongSpaces"]}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`import-sessions-mode-${operationKey}`}>Included sessions</Label>
              <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
                <select
                  id={`import-sessions-mode-${operationKey}`}
                  value={agreement.sessionsMode}
                  onChange={(event) => {
                    const sessionsMode = event.target
                      .value as ActiveWorkImportDraft["agreement"]["sessionsMode"];
                    patch({ sessionsMode });
                  }}
                  {...issueAttributes(reasons, ["agreement.session"], issueId("agreement-sessions"))}
                  className={FIELD_CLASS}
                >
                  <option value="none">None</option>
                  <option value="fixed">A set number</option>
                  <option value="unlimited">Unlimited</option>
                </select>
                {agreement.sessionsMode === "fixed" ? (
                  <input
                    id={`import-sessions-count-${operationKey}`}
                    aria-label="How many sessions"
                    inputMode="numeric"
                    value={agreement.sessionCount}
                    placeholder="How many"
                    onChange={(event) => {
                      patch({ sessionCount: event.target.value });
                    }}
                    {...issueAttributes(
                      reasons,
                      ["agreement.session"],
                      issueId("agreement-sessions"),
                    )}
                    className={FIELD_CLASS}
                  />
                ) : null}
                {agreement.sessionsMode !== "none" ? (
                  <input
                    id={`import-sessions-duration-${operationKey}`}
                    aria-label="Session length in minutes"
                    inputMode="numeric"
                    value={agreement.sessionDurationMin}
                    placeholder="Minutes each"
                    onChange={(event) => {
                      patch({ sessionDurationMin: event.target.value });
                    }}
                    {...issueAttributes(
                      reasons,
                      ["agreement.session"],
                      issueId("agreement-sessions"),
                    )}
                    className={FIELD_CLASS}
                  />
                ) : null}
              </div>
              <p className="text-[11px] leading-relaxed text-[rgb(var(--fg-muted))]">
                {agreement.sessionsMode === "none"
                  ? "Sessions the agreement already covers. With None, the client cannot book studio time under this work."
                  : "The client can book these sessions in Skitza without paying again."}
              </p>
              <FieldIssues
                id={issueId("agreement-sessions")}
                reasons={reasons}
                fields={["agreement.session"]}
              />
            </div>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3 border-t border-[rgb(var(--border-subtle))] pt-3">
            <div>
              <p className="font-mono text-[9.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                Exact total
              </p>
              {tax.taxAmountCents !== null && tax.taxAmountCents > 0 ? (
                <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
                  {formatImportMoney(tax.taxAmountCents, agreement.currency || "USD")} tax
                </p>
              ) : null}
            </div>
            <p className="font-amount text-right text-[21px] font-bold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
              {totalLabel}
            </p>
          </div>
        </section>

        <div className="grid min-w-0 gap-3 border-t border-[rgb(var(--border-subtle))] pt-3 sm:grid-cols-2">
          <div>
            <ListEditor
              id={`${operationKey}:deliverables`}
              label="Deliverables"
              values={agreement.deliverables}
              placeholder="Final mixes and masters"
              invalid={reasonsForFields(reasons, ["agreement.deliverables"]).length > 0}
              issueId={issueId("agreement-deliverables")}
              onChange={(deliverables) => {
                patch({ deliverables });
              }}
            />
            <FieldIssues
              id={issueId("agreement-deliverables")}
              reasons={reasons}
              fields={["agreement.deliverables"]}
            />
          </div>
          <div>
            <ListEditor
              id={`${operationKey}:rights`}
              label="Rights"
              values={agreement.rights}
              placeholder="Artist owns the final masters"
              invalid={reasonsForFields(reasons, ["agreement.rights"]).length > 0}
              issueId={issueId("agreement-rights")}
              onChange={(rights) => {
                patch({ rights });
              }}
            />
            <FieldIssues
              id={issueId("agreement-rights")}
              reasons={reasons}
              fields={["agreement.rights"]}
            />
          </div>
        </div>

        <div className="space-y-1.5 border-t border-[rgb(var(--border-subtle))] pt-3">
          <Label htmlFor={`import-agreement-text-${operationKey}`}>
            Existing agreement terms{" "}
            <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
          </Label>
          <textarea
            ref={agreementTermsRef}
            id={`import-agreement-text-${operationKey}`}
            value={agreement.agreementText}
            maxLength={50_000}
            rows={4}
            onChange={(event) => {
              patch({ agreementText: event.target.value });
            }}
            onInput={(event) => {
              resizeAgreementTerms(event.currentTarget);
            }}
            placeholder="Paste the terms you already agreed with the Artist, if you have them in writing."
            {...issueAttributes(reasons, ["agreement.agreementText"], issueId("agreement-text"))}
            className={`${FIELD_CLASS} min-h-24 resize-none overflow-hidden py-2.5 leading-relaxed`}
          />
          <FieldIssues
            id={issueId("agreement-text")}
            reasons={reasons}
            fields={["agreement.agreementText"]}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
            Agreement PDF{" "}
            <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
          </p>
          <label
            data-agreement-pdf-drop-zone
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (agreementPdfUpload?.status === "uploading") return;
              const file = event.dataTransfer.files[0];
              if (file) onUploadAgreementPdf?.(file);
            }}
            className={`flex min-h-[4.5rem] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[var(--radius-lg)] border border-dashed px-4 py-3 text-center transition-colors duration-150 motion-reduce:transition-none ${
              agreement.agreementPdf
                ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
                : "border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] hover:bg-[rgb(var(--bg-overlay))]"
            }`}
          >
            {agreementPdfUpload?.status === "uploading" ? (
              <span className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                Uploading PDF…
              </span>
            ) : agreement.agreementPdf ? (
              <>
                <span
                  title={agreement.agreementPdf.fileName}
                  className="inline-flex max-w-full items-center gap-1.5 text-[12px] font-semibold text-[rgb(var(--fg-default))]"
                >
                  <FileUp
                    size={14}
                    strokeWidth={2.1}
                    aria-hidden
                    className="shrink-0 text-[rgb(var(--fg-success-text))]"
                  />
                  <span className="min-w-0 truncate">{agreement.agreementPdf.fileName}</span>
                  <span className="font-normal text-[rgb(var(--fg-muted))]">
                    · {formatFileSize(agreement.agreementPdf.sizeBytes)} · Private
                  </span>
                </span>
                <span className="text-[11px] text-[rgb(var(--fg-muted))]">
                  Drop a new PDF or click to replace it
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                  <FileUp size={14} strokeWidth={2.1} aria-hidden />
                  Drop the agreement PDF here
                </span>
                <span className="text-[11px] text-[rgb(var(--fg-muted))]">
                  or click to choose a file
                </span>
                <span className="text-[10.5px] text-[rgb(var(--fg-faint))]">
                  PDF only · up to 15 MB · the Artist sees the exact frozen copy
                </span>
              </>
            )}
            <input
              type="file"
              className="sr-only"
              accept="application/pdf,.pdf"
              disabled={agreementPdfUpload?.status === "uploading"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onUploadAgreementPdf?.(file);
              }}
            />
          </label>
          {agreement.agreementPdf && agreementPdfUpload?.status !== "uploading" ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  patch({ agreementPdf: null });
                }}
                className="sk-press min-h-11 rounded-[var(--radius-lg)] px-2 text-[11px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
              >
                Remove PDF
              </button>
            </div>
          ) : null}
          {agreementPdfUpload?.status === "error" && agreementPdfUpload.error ? (
            <p
              role="alert"
              className="text-[11px] leading-relaxed text-[rgb(var(--fg-danger-text))]"
            >
              {agreementPdfUpload.error}
            </p>
          ) : null}
          <FieldIssues
            id={issueId("agreement-pdf")}
            reasons={reasons}
            fields={["agreement.agreementPdf"]}
          />
        </div>

        <details
          open={detailsOpen}
          onToggle={(event) => {
            setDetailsOpen(event.currentTarget.open);
          }}
          className="group rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] sm:rounded-[var(--radius-md)]"
        >
          <summary className="sk-press flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-lg)] px-3.5 py-2.5 text-[12px] font-bold text-[rgb(var(--fg-default))] marker:hidden sm:rounded-[var(--radius-md)]">
            <span className="min-w-0">
              More agreement details
              <span className="ml-2 font-normal text-[rgb(var(--fg-muted))]">
                · {detailsConfigured ? "Revisions and royalties configured" : "Optional"}
              </span>
            </span>
            <ChevronDown
              size={15}
              strokeWidth={2.1}
              aria-hidden
              className="shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="space-y-4 border-t border-[rgb(var(--border-subtle))] p-3.5">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`import-revisions-${operationKey}`}>Revisions</Label>
                <select
                  id={`import-revisions-${operationKey}`}
                  value={agreement.revisionMode}
                  onChange={(event) => {
                    patch({
                      revisionMode: event.target
                        .value as ActiveWorkImportDraft["agreement"]["revisionMode"],
                    });
                  }}
                  {...issueAttributes(
                    reasons,
                    ["agreement.revisionRule"],
                    issueId("agreement-revisions"),
                  )}
                  className={FIELD_CLASS}
                >
                  <option value="none">Not stated</option>
                  <option value="fixed">Fixed number</option>
                  <option value="unlimited">Unlimited</option>
                </select>
              </div>
              {agreement.revisionMode === "fixed" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`import-revision-count-${operationKey}`}>Number</Label>
                  <input
                    id={`import-revision-count-${operationKey}`}
                    inputMode="numeric"
                    value={agreement.revisionCount}
                    onChange={(event) => {
                      patch({ revisionCount: event.target.value });
                    }}
                    {...issueAttributes(
                      reasons,
                      ["agreement.revisionRule"],
                      issueId("agreement-revisions"),
                    )}
                    className={FIELD_CLASS}
                  />
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <FieldIssues
                  id={issueId("agreement-revisions")}
                  reasons={reasons}
                  fields={["agreement.revisionRule"]}
                />
              </div>
            </div>

            <div className="grid min-w-0 gap-3 border-t border-[rgb(var(--border-subtle))] pt-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`import-master-royalty-${operationKey}`}>Master royalty</Label>
                <select
                  id={`import-master-royalty-${operationKey}`}
                  value={agreement.masterMode}
                  onChange={(event) => {
                    patch({
                      masterMode: event.target
                        .value as ActiveWorkImportDraft["agreement"]["masterMode"],
                    });
                  }}
                  {...issueAttributes(
                    reasons,
                    ["agreement.royaltyTerms"],
                    issueId("agreement-royalties"),
                  )}
                  className={FIELD_CLASS}
                >
                  <option value="none">None</option>
                  <option value="percentage">Percentage</option>
                  <option value="agreement">See agreement text</option>
                </select>
              </div>
              {agreement.masterMode === "percentage" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`import-master-percent-${operationKey}`}>Master %</Label>
                  <input
                    id={`import-master-percent-${operationKey}`}
                    inputMode="decimal"
                    value={agreement.masterPercentage}
                    onChange={(event) => {
                      patch({ masterPercentage: event.target.value });
                    }}
                    {...issueAttributes(
                      reasons,
                      ["agreement.royaltyTerms"],
                      issueId("agreement-royalties"),
                    )}
                    className={FIELD_CLASS}
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor={`import-composition-royalty-${operationKey}`}>
                  Composition royalty
                </Label>
                <select
                  id={`import-composition-royalty-${operationKey}`}
                  value={agreement.compositionMode}
                  onChange={(event) => {
                    patch({
                      compositionMode: event.target
                        .value as ActiveWorkImportDraft["agreement"]["compositionMode"],
                    });
                  }}
                  {...issueAttributes(
                    reasons,
                    ["agreement.royaltyTerms"],
                    issueId("agreement-royalties"),
                  )}
                  className={FIELD_CLASS}
                >
                  <option value="none">None</option>
                  <option value="percentage">Percentage</option>
                  <option value="agreement">See agreement text</option>
                </select>
              </div>
              {agreement.compositionMode === "percentage" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={`import-composition-percent-${operationKey}`}>
                      Composition %
                    </Label>
                    <input
                      id={`import-composition-percent-${operationKey}`}
                      inputMode="decimal"
                      value={agreement.compositionPercentage}
                      onChange={(event) => {
                        patch({ compositionPercentage: event.target.value });
                      }}
                      {...issueAttributes(
                        reasons,
                        ["agreement.royaltyTerms"],
                        issueId("agreement-royalties"),
                      )}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`import-composition-role-${operationKey}`}>Role</Label>
                    <select
                      id={`import-composition-role-${operationKey}`}
                      value={agreement.compositionRole}
                      onChange={(event) => {
                        patch({
                          compositionRole: event.target
                            .value as ActiveWorkImportDraft["agreement"]["compositionRole"],
                        });
                      }}
                      {...issueAttributes(
                        reasons,
                        ["agreement.royaltyTerms"],
                        issueId("agreement-royalties"),
                      )}
                      className={FIELD_CLASS}
                    >
                      <option value="">Not stated</option>
                      <option value="composer">Composer</option>
                      <option value="lyricist">Lyricist</option>
                      <option value="arranger">Arranger</option>
                      <option value="publisher">Publisher</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`import-society-${operationKey}`}>Collecting society</Label>
                    <input
                      id={`import-society-${operationKey}`}
                      value={agreement.collectingSociety}
                      maxLength={160}
                      onChange={(event) => {
                        patch({ collectingSociety: event.target.value });
                      }}
                      {...issueAttributes(
                        reasons,
                        ["agreement.royaltyTerms"],
                        issueId("agreement-royalties"),
                      )}
                      className={FIELD_CLASS}
                    />
                  </div>
                </>
              ) : null}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`import-royalty-notes-${operationKey}`}>
                  Royalty notes <span className="normal-case">(optional)</span>
                </Label>
                <textarea
                  id={`import-royalty-notes-${operationKey}`}
                  value={agreement.royaltyNotes}
                  maxLength={2_000}
                  rows={2}
                  onChange={(event) => {
                    patch({ royaltyNotes: event.target.value });
                  }}
                  {...issueAttributes(
                    reasons,
                    ["agreement.royaltyTerms"],
                    issueId("agreement-royalties"),
                  )}
                  className={`${FIELD_CLASS} resize-y py-2.5`}
                />
              </div>
              <div className="sm:col-span-2">
                <FieldIssues
                  id={issueId("agreement-royalties")}
                  reasons={reasons}
                  fields={["agreement.royaltyTerms"]}
                />
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
