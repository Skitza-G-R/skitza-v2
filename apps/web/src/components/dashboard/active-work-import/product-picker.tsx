"use client";

import {
  Check,
  MessageSquare,
  Music2,
  PenLine,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  type LucideIcon,
} from "lucide-react";

import { kindToTile, type TileType } from "~/app/(producer)/dashboard/store/kind-to-tile";

import { AgreementPdfField } from "./agreement-editor";
import {
  agreementMatchesTemplate,
  applyTemplate,
  draftTaxBreakdown,
  formatImportMoney,
  paymentPlanLabel,
  type ActiveWorkImportDraft,
  type ImportReasonView,
  type StoreTemplateOption,
} from "./model";
import type { ProofUploadView } from "./payment-history-editor";

// SK-308: the same four kinds the Store card uses, drawn flat on a plain tile
// so a tile reads as a choice, not a poster.
const TILE_ICON: Record<TileType, LucideIcon> = {
  mix: SlidersHorizontal,
  master: Volume2,
  production: Music2,
  consult: MessageSquare,
};

const TILE_CLASS =
  "sk-press relative flex aspect-square min-h-11 min-w-0 flex-col justify-between rounded-[var(--radius-lg)] border p-2.5 text-left transition-colors duration-150 motion-reduce:transition-none sm:p-3";
const TILE_SELECTED_CLASS =
  "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--fg-default))]";
const TILE_IDLE_CLASS =
  "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))]";

function SelectedMark() {
  return (
    <span
      aria-hidden
      className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
    >
      <Check size={12} strokeWidth={3} />
    </span>
  );
}

export function ProductTiles({
  templates,
  selectedId,
  onSelect,
}: {
  templates: readonly StoreTemplateOption[];
  selectedId: string | null;
  /** null = the Custom deal tile. */
  onSelect: (template: StoreTemplateOption | null) => void;
}) {
  const customSelected = selectedId === null;
  return (
    <div
      role="group"
      aria-label="Product"
      className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4"
    >
      {templates.map((template) => {
        const tile = kindToTile(template.kind);
        const Icon = TILE_ICON[tile];
        const selected = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            aria-pressed={selected}
            data-product-tile={tile}
            onClick={() => {
              onSelect(template);
            }}
            className={`${TILE_CLASS} ${selected ? TILE_SELECTED_CLASS : TILE_IDLE_CLASS}`}
          >
            {selected ? <SelectedMark /> : null}
            <Icon
              size={20}
              strokeWidth={2.1}
              aria-hidden
              className={
                selected ? "text-[rgb(var(--brand-primary-text))]" : "text-[rgb(var(--fg-muted))]"
              }
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="line-clamp-2 text-[11.5px] leading-tight font-bold break-words">
                {template.name}
              </span>{" "}
              <span className="font-mono text-[10.5px] font-semibold text-[rgb(var(--fg-muted))]">
                {formatImportMoney(template.subtotalCents, template.currency || "USD")}
              </span>
            </span>
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={customSelected}
        data-product-tile="custom"
        onClick={() => {
          onSelect(null);
        }}
        className={`${TILE_CLASS} border-dashed ${customSelected ? TILE_SELECTED_CLASS : TILE_IDLE_CLASS}`}
      >
        {customSelected ? <SelectedMark /> : null}
        <PenLine
          size={20}
          strokeWidth={2.1}
          aria-hidden
          className={
            customSelected
              ? "text-[rgb(var(--brand-primary-text))]"
              : "text-[rgb(var(--fg-muted))]"
          }
        />
        <span className="text-[11.5px] leading-tight font-bold">Custom deal</span>
      </button>
    </div>
  );
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function taxLabel(agreement: ActiveWorkImportDraft["agreement"]): string {
  if (agreement.taxMode === "tax_free") return "No tax";
  const rate = agreement.taxRatePct.trim() || "0";
  return agreement.taxMode === "tax_included" ? `Tax included · ${rate}%` : `Tax added · ${rate}%`;
}

function sessionsSummary(agreement: ActiveWorkImportDraft["agreement"]): string {
  if (agreement.sessionsMode === "none") return "None";
  const minutes = `${agreement.sessionDurationMin.trim() || "?"} min`;
  if (agreement.sessionsMode === "unlimited") return `Unlimited sessions · ${minutes}`;
  const count = Number.parseInt(agreement.sessionCount, 10);
  const head = Number.isFinite(count)
    ? countLabel(count, "session", "sessions")
    : `${agreement.sessionCount.trim() || "?"} sessions`;
  return `${head} · ${minutes}`;
}

function revisionsSummary(agreement: ActiveWorkImportDraft["agreement"]): string {
  if (agreement.revisionMode === "unlimited") return "Unlimited";
  if (agreement.revisionMode === "fixed") {
    const count = Number.parseInt(agreement.revisionCount, 10);
    return Number.isFinite(count)
      ? countLabel(count, "revision", "revisions")
      : `${agreement.revisionCount.trim() || "?"} revisions`;
  }
  return "Not stated";
}

function royaltiesSummary(agreement: ActiveWorkImportDraft["agreement"]): string {
  const parts: string[] = [];
  if (agreement.masterMode === "percentage") {
    parts.push(`Master ${agreement.masterPercentage.trim() || "?"}%`);
  } else if (agreement.masterMode === "agreement") {
    parts.push("Master · see agreement");
  }
  if (agreement.compositionMode === "percentage") {
    parts.push(`Composition ${agreement.compositionPercentage.trim() || "?"}%`);
  } else if (agreement.compositionMode === "agreement") {
    parts.push("Composition · see agreement");
  }
  return parts.length > 0 ? parts.join(" · ") : "None";
}

function termsSummary(
  agreement: ActiveWorkImportDraft["agreement"],
  template: StoreTemplateOption,
): string {
  const text = agreement.agreementText.trim();
  if (text) return `Written terms · ${text.length.toLocaleString("en")} characters`;
  if (agreement.agreementPdf) return `${agreement.agreementPdf.fileName} attached`;
  if (template.agreementPdf) {
    return `${template.agreementPdf.fileName} on the product · Attach the same PDF below`;
  }
  return "No written terms";
}

export function ProductSummary({
  template,
  draft,
  operationKey,
  reasons,
  detailsOpen,
  onToggleDetails,
  onChange,
  agreementPdfUpload,
  onUploadAgreementPdf,
}: {
  template: StoreTemplateOption;
  draft: ActiveWorkImportDraft;
  operationKey: string;
  reasons: readonly ImportReasonView[];
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onChange: (draft: ActiveWorkImportDraft) => void;
  agreementPdfUpload?: ProofUploadView | undefined;
  onUploadAgreementPdf?: ((file: File) => void) | undefined;
}) {
  const agreement = draft.agreement;
  const tax = draftTaxBreakdown(draft);
  const currency = agreement.currency || "USD";
  const matches = agreementMatchesTemplate(draft, template);
  const deliverableCount = agreement.deliverables.filter((item) => item.trim()).length;
  const rights = agreement.rights.filter((item) => item.trim());
  const titleId = `import-product-summary-${operationKey}`;
  const lines: readonly Readonly<{ label: string; value: string; note?: string }>[] = [
    {
      label: "Total",
      value: tax.totalCents === null ? "Add a valid price" : formatImportMoney(tax.totalCents, currency),
      note: taxLabel(agreement),
    },
    { label: "Currency", value: agreement.currency.trim() || "—" },
    { label: "Song spaces", value: agreement.includedSongSpaces.trim() || "—" },
    { label: "Sessions", value: sessionsSummary(agreement) },
    {
      label: "Deliverables",
      value: deliverableCount === 0 ? "None" : countLabel(deliverableCount, "item", "items"),
    },
    { label: "Rights", value: rights.length > 0 ? rights.join(" · ") : "None stated" },
    { label: "Revisions", value: revisionsSummary(agreement) },
    { label: "Royalties", value: royaltiesSummary(agreement) },
    { label: "Payment plan", value: paymentPlanLabel(draft) },
    { label: "Terms", value: termsSummary(agreement, template) },
  ];

  return (
    <section
      aria-labelledby={titleId}
      data-product-summary
      className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))]"
    >
      <div className="flex min-w-0 items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-3.5 py-3">
        <div className="min-w-0">
          <h3 id={titleId} className="truncate text-[13px] font-bold text-[rgb(var(--fg-default))]">
            From {template.name}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {matches
              ? "Everything below comes from the product."
              : "Edited · this deal differs from the product."}
          </p>
        </div>
        {!matches ? (
          <button
            type="button"
            onClick={() => {
              onChange(applyTemplate(draft, template));
            }}
            className="sk-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] px-2 text-[11.5px] font-bold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] sm:min-h-9 sm:rounded-[var(--radius-md)]"
          >
            <RotateCcw size={13} strokeWidth={2.2} aria-hidden />
            Reset to product
          </button>
        ) : null}
      </div>
      <dl className="grid min-w-0 gap-x-4 gap-y-2 px-3.5 py-3 sm:grid-cols-2">
        {lines.map((line) => (
          <div key={line.label} className="min-w-0">
            <dt className="font-mono text-[9px] font-semibold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
              {line.label}
            </dt>
            <dd className="mt-0.5 min-w-0 text-[12.5px] leading-snug font-semibold break-words text-[rgb(var(--fg-default))]">
              {line.value}
              {line.note ? (
                <span className="ml-1.5 text-[11px] font-normal text-[rgb(var(--fg-muted))]">
                  {line.note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {template.agreementPdf && !agreement.agreementText.trim() ? (
        <div className="border-t border-[rgb(var(--border-subtle))] px-3.5 py-3">
          <AgreementPdfField
            draft={draft}
            operationKey={operationKey}
            reasons={reasons}
            onChange={onChange}
            agreementPdfUpload={agreementPdfUpload}
            onUploadAgreementPdf={onUploadAgreementPdf}
          />
        </div>
      ) : null}
      <div className="border-t border-[rgb(var(--border-subtle))] px-3.5 py-2.5">
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={onToggleDetails}
          className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-bold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] sm:min-h-9 sm:rounded-[var(--radius-md)]"
        >
          <PenLine size={13} strokeWidth={2.2} aria-hidden />
          {detailsOpen ? "Hide details" : "Edit details"}
        </button>
      </div>
    </section>
  );
}
