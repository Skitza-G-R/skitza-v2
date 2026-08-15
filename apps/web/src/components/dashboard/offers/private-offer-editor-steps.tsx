"use client";

import { Check, ChevronDown, FileText, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { kindToTile } from "~/app/(producer)/dashboard/store/kind-to-tile";
import { PaymentStep } from "~/app/(producer)/dashboard/store/editor-steps/payment-step";
import { TILE_THEME } from "~/app/(producer)/dashboard/store/tile-theme";
import { TypeTile } from "~/app/(producer)/dashboard/store/type-tile";
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
  type PrivateOfferDraftField,
} from "./private-offer-editor-model";
import type { PrivateOfferTemplateProduct } from "./private-offer-template-types";

export const PRIVATE_OFFER_INPUT_CLASS =
  "min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-10 sm:rounded-[var(--radius-md)] sm:text-[13px]";
const TEXTAREA_CLASS = `${PRIVATE_OFFER_INPUT_CLASS} resize-y py-2.5 leading-relaxed`;

type PatchDraft = (patch: Partial<PrivateOfferComposerDraft>) => void;

function invalidFieldProps(
  invalidField: PrivateOfferDraftField | null,
  field: PrivateOfferDraftField,
) {
  return {
    "data-private-offer-field": field,
    "aria-invalid": invalidField === field ? (true as const) : undefined,
  };
}

export interface PrivateOfferStepRecipient {
  id: string;
  name: string;
  email: string;
}

export interface PrivateOfferStepProject {
  id: string;
  label: string;
  title?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PrivateOfferTopProgress({
  current,
  onSelect,
  sourceName,
  sourceKind,
}: {
  current: "recipient" | "price";
  onSelect: (step: "recipient" | "price") => void;
  sourceName: string;
  sourceKind: string;
}) {
  const priceAvailable = current === "price";
  const tile = kindToTile(sourceKind);
  const accent = TILE_THEME[tile].accent;
  return (
    <div className="min-w-0">
      <ol aria-label="Private offer editing steps" className="flex min-w-0 items-center">
        <li>
          <button
            type="button"
            aria-current={current === "recipient" ? "step" : undefined}
            onClick={() => { onSelect("recipient"); }}
            className="sk-press flex min-h-10 items-center gap-2 rounded-[var(--radius-lg)] pr-2 text-[12px] font-semibold text-[rgb(var(--fg-default))]"
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] ${
                priceAvailable
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
                  : "border-[rgb(var(--fg-default))] bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
              }`}
            >
              {priceAvailable ? <Check className="h-3.5 w-3.5" aria-hidden /> : "1"}
            </span>
            Recipient
          </button>
        </li>
        <li aria-hidden className="mx-2 h-px min-w-5 flex-1 bg-[rgb(var(--border-strong))]" />
        <li>
          <button
            type="button"
            aria-current={current === "price" ? "step" : undefined}
            disabled={!priceAvailable}
            onClick={() => { onSelect("price"); }}
            className="sk-press flex min-h-10 items-center gap-2 rounded-[var(--radius-lg)] pl-2 text-[12px] font-semibold text-[rgb(var(--fg-default))] disabled:cursor-default"
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] ${
                current === "price"
                  ? "border-[rgb(var(--fg-default))] bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                  : "border-[rgb(var(--border-strong))] text-[rgb(var(--fg-muted))]"
              }`}
            >
              2
            </span>
            Price &amp; terms
          </button>
        </li>
      </ol>
      <article className="group relative mt-3 grid min-w-0 grid-cols-[60px_minmax(0,1fr)] items-center gap-3 overflow-hidden rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 shadow-[0_12px_30px_-24px_rgba(17,16,9,0.38),0_1px_3px_rgba(17,16,9,0.05)]">
        <span
          aria-hidden
          className="pointer-events-none absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full"
          style={{ background: accent }}
        />
        <TypeTile type={tile} />
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
            Store product template
          </p>
          <p className="font-display mt-1 line-clamp-2 text-[16px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
            {sourceName}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            Product terms stay unchanged unless you customize them.
          </p>
        </div>
      </article>
    </div>
  );
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
  invalidField,
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
  invalidField: PrivateOfferDraftField | null;
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
                  {...invalidFieldProps(invalidField, "clientContactId")}
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
                    {...invalidFieldProps(invalidField, "newRecipientName")}
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
                    {...invalidFieldProps(invalidField, "newRecipientEmail")}
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
              {...invalidFieldProps(invalidField, "targetProjectId")}
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

function ProjectDestination({
  idPrefix,
  draft,
  projects,
  projectsStatus,
  projectsError,
  onRetryProjects,
  invalidField,
  patch,
  onInteraction,
  initiallyExpanded = false,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  projects: readonly PrivateOfferStepProject[];
  projectsStatus: "idle" | "loading" | "ready" | "error";
  projectsError?: string;
  onRetryProjects?: () => void;
  invalidField: PrivateOfferDraftField | null;
  patch: PatchDraft;
  onInteraction?: () => void;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded || draft.targetKind === "existing");

  useEffect(() => {
    if (draft.targetKind === "existing") setExpanded(true);
  }, [draft.targetKind]);

  return (
    <section className="border-t border-[rgb(var(--border-subtle))] pt-5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] text-[rgb(var(--fg-secondary))]">
          <span className="font-semibold text-[rgb(var(--fg-default))]">After acceptance:</span>{" "}
          {draft.targetKind === "new"
            ? "A new project will be created"
            : (projects.find((project) => project.id === draft.targetProjectId)?.title ??
              "Add to an existing project")}
        </p>
        <button
          type="button"
          onClick={() => {
            setExpanded((current) => !current);
            onInteraction?.();
          }}
          className="sk-press min-h-11 shrink-0 rounded-[var(--radius-lg)] px-2.5 text-[12px] font-semibold text-[rgb(var(--brand-primary-dark))] hover:bg-[rgb(var(--brand-primary)/0.08)] sm:min-h-9 sm:rounded-[var(--radius-md)]"
        >
          {expanded ? "Done" : "Change"}
        </button>
      </div>
      {expanded ? (
        <fieldset
          {...invalidFieldProps(invalidField, "targetProjectId")}
          className="mt-4 space-y-2"
        >
          <legend className="mb-2 text-[11px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
            Where should the work go?
          </legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-[rgb(var(--border-subtle))] py-2.5 text-[13px] font-medium">
            <input
              type="radio"
              name={`${idPrefix}-project-target`}
              checked={draft.targetKind === "new"}
              onChange={() => { patch({ targetKind: "new", targetProjectId: "" }); }}
              className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
            />
            Create a new project
          </label>
          {projectsStatus === "loading" || projectsStatus === "idle" ? (
            <p role="status" className="py-2 text-[12px] text-[rgb(var(--fg-muted))]">
              Loading this client&apos;s projects…
            </p>
          ) : null}
          {projectsStatus === "ready" && projects.length === 0 ? (
            <p className="py-2 text-[12px] text-[rgb(var(--fg-muted))]">
              This client has no available projects.
            </p>
          ) : null}
          {projects.map((project) => (
            <label
              key={project.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-[rgb(var(--border-subtle))] py-2.5 text-[13px] font-medium last:border-b-0"
            >
              <input
                type="radio"
                name={`${idPrefix}-project-target`}
                checked={draft.targetKind === "existing" && draft.targetProjectId === project.id}
                onChange={() => { patch({ targetKind: "existing", targetProjectId: project.id }); }}
                className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
              />
              <span className="min-w-0 break-words">{project.title ?? project.label}</span>
            </label>
          ))}
          {projectsStatus === "error" ? (
            <div className="flex items-center justify-between gap-3 py-2">
              <p role="alert" className="text-[12px] text-[rgb(var(--fg-danger))]">
                {projectsError ?? "Could not load this client's projects."}
              </p>
              {onRetryProjects ? (
                <button
                  type="button"
                  onClick={onRetryProjects}
                  className="sk-press min-h-10 shrink-0 rounded-[var(--radius-lg)] px-3 text-[12px] font-semibold text-[rgb(var(--brand-primary-dark))]"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}
    </section>
  );
}

export function PrivateOfferRecipientStep({
  idPrefix,
  draft,
  recipients,
  projects,
  projectsStatus,
  projectsError,
  onRetryProjects,
  invalidField,
  patch,
  onInteraction,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  recipients: readonly PrivateOfferStepRecipient[];
  projects: readonly PrivateOfferStepProject[];
  projectsStatus: "idle" | "loading" | "ready" | "error";
  projectsError?: string;
  onRetryProjects?: () => void;
  invalidField: PrivateOfferDraftField | null;
  patch: PatchDraft;
  onInteraction?: () => void;
}) {
  const listId = `${useId()}-private-offer-recipients`;
  const selected =
    draft.recipientKind === "existing"
      ? recipients.find((recipient) => recipient.id === draft.clientContactId)
      : null;
  const [query, setQuery] = useState(
    selected
      ? `${selected.name} · ${selected.email}`
      : draft.recipientKind === "new"
        ? draft.newRecipientEmail
        : "",
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const normalized = query.trim().toLowerCase();
  const exactEmail = recipients.find(
    (recipient) => recipient.email.trim().toLowerCase() === normalized,
  );
  const filtered = recipients.filter((recipient) => {
    if (!normalized) return true;
    return `${recipient.name} ${recipient.email}`.toLowerCase().includes(normalized);
  });
  const unknownValidEmail = EMAIL_PATTERN.test(normalized) && !exactEmail;

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("pointerdown", close); };
  }, []);

  function chooseExisting(recipient: PrivateOfferStepRecipient) {
    setQuery(`${recipient.name} · ${recipient.email}`);
    setOpen(false);
    patch({
      recipientKind: "existing",
      clientContactId: recipient.id,
      newRecipientName: "",
      newRecipientEmail: "",
      targetKind: "new",
      targetProjectId: "",
    });
  }

  return (
    <div className="space-y-5">
      <div ref={rootRef} className="relative">
        <Label htmlFor={`${idPrefix}-recipient-combobox`}>Recipient</Label>
        <div className="relative mt-2">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[rgb(var(--fg-faint))]"
          />
          <input
            id={`${idPrefix}-recipient-combobox`}
            {...invalidFieldProps(invalidField, "clientContactId")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            value={query}
            placeholder="Search clients or enter an email…"
            autoComplete="off"
            onFocus={() => { setOpen(true); }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              patch({
                recipientKind: "existing",
                clientContactId: "",
                newRecipientName: "",
                newRecipientEmail: "",
                targetKind: "new",
                targetProjectId: "",
              });
            }}
            className={`${PRIVATE_OFFER_INPUT_CLASS} pr-10 pl-10`}
          />
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[rgb(var(--fg-muted))]"
          />
        </div>
        {open ? (
          <div
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 shadow-xl"
          >
            {(exactEmail ? [exactEmail] : filtered).map((recipient) => (
              <button
                key={recipient.id}
                type="button"
                role="option"
                aria-selected={draft.clientContactId === recipient.id}
                onClick={() => { chooseExisting(recipient); }}
                className="sk-press block min-h-11 w-full rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-[rgb(var(--bg-sunken))]"
              >
                <span className="block text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                  {recipient.name}
                </span>
                <span className="block text-[11.5px] text-[rgb(var(--fg-muted))]">
                  {recipient.email}
                </span>
              </button>
            ))}
            {unknownValidEmail ? (
              <button
                type="button"
                role="option"
                aria-selected={
                  draft.recipientKind === "new" && draft.newRecipientEmail === normalized
                }
                onClick={() => {
                  setQuery(normalized);
                  setOpen(false);
                  patch({
                    recipientKind: "new",
                    clientContactId: "",
                    newRecipientName: "",
                    newRecipientEmail: normalized,
                    targetKind: "new",
                    targetProjectId: "",
                  });
                }}
                className="sk-press block min-h-11 w-full rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-[rgb(var(--bg-sunken))]"
              >
                <span className="block text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary-dark))] uppercase">
                  New recipient
                </span>
                <span className="mt-0.5 block text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                  {normalized}
                </span>
              </button>
            ) : null}
            {filtered.length === 0 && !unknownValidEmail && !exactEmail ? (
              <p className="px-3 py-3 text-[12px] text-[rgb(var(--fg-muted))]">
                Enter a complete email address to invite a new recipient.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {draft.recipientKind === "new" && draft.newRecipientEmail ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-new-name`}>Client name</Label>
          <input
            id={`${idPrefix}-new-name`}
            {...invalidFieldProps(invalidField, "newRecipientName")}
            value={draft.newRecipientName}
            required
            maxLength={160}
            autoComplete="name"
            onChange={(event) => { patch({ newRecipientName: event.target.value }); }}
            className={PRIVATE_OFFER_INPUT_CLASS}
          />
        </div>
      ) : null}

      {draft.clientContactId || draft.newRecipientEmail ? (
        <ProjectDestination
          idPrefix={idPrefix}
          draft={draft}
          projects={draft.recipientKind === "new" ? [] : projects}
          projectsStatus={draft.recipientKind === "new" ? "ready" : projectsStatus}
          {...(projectsError ? { projectsError } : {})}
          {...(onRetryProjects ? { onRetryProjects } : {})}
          invalidField={invalidField}
          patch={patch}
          {...(onInteraction ? { onInteraction } : {})}
        />
      ) : null}
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

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

function privateOfferPaymentSummary(
  draft: PrivateOfferComposerDraft,
  cashPriceCents: number | null,
): string {
  if (cashPriceCents === null) return "Complete the private subtotal";
  if (cashPriceCents === 0) return "No payment needed";
  const plans = [
    ...(draft.fullPlan ? ["Pay in full"] : []),
    ...(draft.splitPlan ? ["50 / 50"] : []),
    ...(draft.monthlyPlan ? [`Monthly · ${draft.monthlyInstallments || "—"} payments`] : []),
  ];
  return plans.length > 0 ? plans.join(" · ") : "No payment option copied";
}

export function PrivateOfferCompactPriceStep({
  idPrefix,
  draft,
  sourceName,
  sourceKind,
  invalidField,
  patch,
  customized,
  onCustomize,
  editProject,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  sourceName: string;
  sourceKind: string;
  invalidField: PrivateOfferDraftField | null;
  patch: PatchDraft;
  customized: boolean;
  onCustomize: () => void;
  editProject?: {
    projects: readonly PrivateOfferStepProject[];
    projectsStatus: "idle" | "loading" | "ready" | "error";
    projectsError?: string;
    onRetryProjects?: () => void;
    onInteraction?: () => void;
  };
}) {
  const priceCents = privateOfferPriceCents(draft.cashPrice);
  const rate = Number.parseInt(draft.taxRatePct, 10);
  const tax =
    priceCents === null
      ? null
      : privateOfferTaxBreakdown(priceCents, draft.taxMode, Number.isSafeInteger(rate) ? rate : 0);
  const currencyOptions = CURRENCIES.includes(draft.currency)
    ? CURRENCIES
    : ([draft.currency, ...CURRENCIES].filter(Boolean) as readonly string[]);
  const tile = kindToTile(sourceKind);
  const accent = TILE_THEME[tile].accent;
  const currencySymbol = CURRENCY_SYMBOL[draft.currency] ?? draft.currency;
  const inputLabel =
    draft.taxMode === "tax_added"
      ? "Your price before VAT"
      : draft.taxMode === "tax_included"
        ? "Your price including VAT"
        : "Your price";
  const agreementSummary =
    draft.agreementMode === "pdf"
      ? "PDF attached"
      : draft.agreementMode === "text"
        ? "Written agreement"
        : "No separate agreement";
  const expiry = new Date(draft.expiresAtLocal);
  const expirySummary = Number.isNaN(expiry.getTime())
    ? "Choose expiry"
    : `Expires ${new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(expiry)}`;
  const paymentSummary = privateOfferPaymentSummary(draft, priceCents);

  return (
    <div className="space-y-4">
      {editProject ? (
        <ProjectDestination
          idPrefix={`${idPrefix}-edit`}
          draft={draft}
          projects={editProject.projects}
          projectsStatus={editProject.projectsStatus}
          {...(editProject.projectsError ? { projectsError: editProject.projectsError } : {})}
          {...(editProject.onRetryProjects ? { onRetryProjects: editProject.onRetryProjects } : {})}
          invalidField={invalidField}
          patch={patch}
          {...(editProject.onInteraction ? { onInteraction: editProject.onInteraction } : {})}
        />
      ) : null}

      <section className="relative overflow-hidden rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[0_12px_30px_-24px_rgba(17,16,9,0.36),0_1px_3px_rgba(17,16,9,0.05)] sm:p-5">
        <span
          aria-hidden
          className="pointer-events-none absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full"
          style={{ background: accent }}
        />
        <div className="max-w-[440px]">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-compact-price`}>{inputLabel}</Label>
            <div className="flex h-[54px] items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] shadow-[0_1px_2px_rgba(17,16,9,0.03)] transition-[border-color,box-shadow] focus-within:border-[rgb(var(--brand-primary))] focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.12)] sm:h-12">
              <span
                aria-hidden
                className="font-display pl-3.5 text-[20px] font-bold text-[rgb(var(--fg-muted))]"
              >
                {currencySymbol}
              </span>
              <input
                id={`${idPrefix}-compact-price`}
                {...invalidFieldProps(invalidField, "cashPrice")}
                value={draft.cashPrice}
                required
                inputMode="decimal"
                onChange={(event) => {
                  const cashPrice = event.target.value;
                  const next = privateOfferPriceCents(cashPrice);
                  patch({
                    cashPrice,
                    ...(next === 0
                      ? { fullPlan: false, splitPlan: false, monthlyPlan: false }
                      : next !== null && !draft.fullPlan && !draft.splitPlan && !draft.monthlyPlan
                        ? { fullPlan: true }
                        : {}),
                  });
                }}
                className="font-display h-full min-w-0 flex-1 border-none bg-transparent px-2 py-1 text-[21px] font-extrabold text-[rgb(var(--fg-default))] tabular-nums [--sk-mobile-control-font-size:21px] outline-none"
              />
              <label htmlFor={`${idPrefix}-compact-currency`} className="sr-only">
                Currency
              </label>
              <div className="flex h-8 shrink-0 items-center border-l border-[rgb(var(--border-subtle))] px-2.5">
                <select
                  id={`${idPrefix}-compact-currency`}
                  {...invalidFieldProps(invalidField, "currency")}
                  value={draft.currency}
                  onChange={(event) => {
                    patch({ currency: event.target.value });
                  }}
                  className="h-full w-[64px] border-none bg-transparent text-[12px] font-bold tracking-[0.02em] text-[rgb(var(--fg-muted))] outline-none"
                >
                  {currencyOptions.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-3.5 py-3">
          <div>
            <dt className="font-mono text-[9.5px] font-bold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
              Client pays
            </dt>
            <dd className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
              {draft.taxMode === "tax_free"
                ? "No VAT added"
                : draft.taxMode === "tax_added"
                  ? `Includes ${String(rate)}% VAT added`
                  : `Includes ${String(rate)}% VAT`}
            </dd>
          </div>
          <div className="text-right">
            <dd className="font-display text-[25px] leading-none font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] tabular-nums sm:text-[28px]">
              {tax ? formatMoney(tax.totalCents, draft.currency) : "—"}
            </dd>
            {draft.taxMode !== "tax_free" && tax ? (
              <dd className="mt-1 text-[10.5px] text-[rgb(var(--fg-muted))] tabular-nums">
                {formatMoney(tax.taxCents, draft.currency)} · {String(rate)}%
              </dd>
            ) : null}
          </div>
        </dl>
      </section>

      <section className="relative overflow-hidden rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[0_12px_30px_-24px_rgba(17,16,9,0.32)]">
        <span
          aria-hidden
          className="pointer-events-none absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full"
          style={{ background: accent }}
        />
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]">
            <Check className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
              {customized ? `Terms based on ${sourceName}` : `Terms copied from ${sourceName}`}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              {paymentSummary} · {agreementSummary} · {expirySummary}
            </p>
          </div>
        </div>

        <dl className="mt-4 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="py-3 sm:py-2 sm:pr-3">
            <dt className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
              Payment
            </dt>
            <dd className="mt-1 text-[12px] leading-snug font-semibold text-[rgb(var(--fg-default))]">
              {paymentSummary}
            </dd>
          </div>
          <div className="py-3 sm:px-3 sm:py-2">
            <dt className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
              Agreement
            </dt>
            <dd className="mt-1 text-[12px] leading-snug font-semibold text-[rgb(var(--fg-default))]">
              {agreementSummary}
            </dd>
          </div>
          <div className="py-3 sm:py-2 sm:pl-3">
            <dt className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--fg-faint))] uppercase">
              Availability
            </dt>
            <dd className="mt-1 text-[12px] leading-snug font-semibold text-[rgb(var(--fg-default))]">
              {expirySummary}
            </dd>
          </div>
        </dl>

        {draft.agreementMode === "pdf" && draft.agreementPdf ? (
          <p className="mt-3 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-secondary))]">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{draft.agreementPdf.originalFileName}</span>
          </p>
        ) : null}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCustomize}
            className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.34)] bg-[rgb(var(--brand-primary)/0.08)] px-4 text-[12.5px] font-semibold text-[rgb(var(--brand-primary-dark))] transition-[border-color,background-color] hover:border-[rgb(var(--brand-primary)/0.58)] hover:bg-[rgb(var(--brand-primary)/0.13)] sm:min-h-9 sm:rounded-[var(--radius-md)]"
          >
            Customize
          </button>
        </div>
      </section>
    </div>
  );
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
  invalidField,
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
  invalidField: PrivateOfferDraftField | null;
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
  const tax = pricePreviewIsValid
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
        invalidField={invalidField}
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
                {...invalidFieldProps(invalidField, "cashPrice")}
                value={draft.cashPrice}
                required
                inputMode="decimal"
                aria-invalid={!priceIsValid || invalidField === "cashPrice"}
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
              {...invalidFieldProps(invalidField, "currency")}
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
                {...invalidFieldProps(invalidField, "templateQuantity")}
                type="number"
                min={1}
                max={1_000}
                step={1}
                required
                aria-invalid={!quantityIsValid || invalidField === "templateQuantity"}
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
                      ? (() => {
                          const suggestedTotal = totalForTemplateQuantity(
                            perSongPricing.volumeTiers,
                            quantity,
                          );
                          return {
                            includedSongSpaces: String(quantity),
                            ...(suggestedTotal === null
                              ? {}
                              : { cashPrice: (suggestedTotal / 100).toFixed(2) }),
                          };
                        })()
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
            Subtotal {pricePreviewIsValid ? formatMoney(priceCents, draft.currency) : "—"}
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
  invalidField,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  invalidField: PrivateOfferDraftField | null;
  patch: PatchDraft;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-name`}>Offer title</Label>
          <input
            id={`${idPrefix}-name`}
            {...invalidFieldProps(invalidField, "name")}
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
            {...invalidFieldProps(invalidField, "service")}
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
          {...invalidFieldProps(invalidField, "tagline")}
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
          {...invalidFieldProps(invalidField, "deliverables")}
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
  invalidField,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  invalidField: PrivateOfferDraftField | null;
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
            {...invalidFieldProps(invalidField, "cashPrice")}
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
            {...invalidFieldProps(invalidField, "currency")}
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
            {...invalidFieldProps(invalidField, "taxRatePct")}
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
  invalidField,
  patch,
}: {
  draft: PrivateOfferComposerDraft;
  invalidField: PrivateOfferDraftField | null;
  patch: PatchDraft;
}) {
  const subtotal = privateOfferPriceCents(draft.cashPrice) ?? 0;
  const rate = Number.parseInt(draft.taxRatePct, 10);
  const total = privateOfferTaxBreakdown(
    subtotal,
    draft.taxMode,
    Number.isSafeInteger(rate) ? rate : 0,
  )?.totalCents;
  const validationField =
    invalidField === "monthlyInstallments" ? "monthlyInstallments" : "paymentPlans";
  if (subtotal === 0) {
    return (
      <div
        {...invalidFieldProps(invalidField, validationField)}
        tabIndex={-1}
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
      >
        <h3 className="font-display text-[16px] font-bold">No payment schedule</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          This is a free offer. The artist accepts the terms without making a payment.
        </p>
      </div>
    );
  }
  return (
    <div {...invalidFieldProps(invalidField, validationField)} tabIndex={-1}>
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
    </div>
  );
}

function NumericField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  field,
  invalidField,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  field: PrivateOfferDraftField;
  invalidField: PrivateOfferDraftField | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        {...invalidFieldProps(invalidField, field)}
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
  invalidField,
  patch,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  invalidField: PrivateOfferDraftField | null;
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
        field="includedSongSpaces"
        invalidField={invalidField}
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
                field="sessionCount"
                invalidField={invalidField}
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
              field="sessionDurationMin"
              invalidField={invalidField}
              onChange={(sessionDurationMin) => {
                patch({ sessionDurationMin });
              }}
            />
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={`${idPrefix}-location`}>Location</Label>
              <input
                id={`${idPrefix}-location`}
                {...invalidFieldProps(invalidField, "sessionLocationType")}
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
              field="sessionBufferMinutes"
              invalidField={invalidField}
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
              field="sessionMinLeadHours"
              invalidField={invalidField}
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
              field="revisionCount"
              invalidField={invalidField}
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
  field,
  invalidField,
  onChange,
}: {
  name: string;
  value: PrivateOfferComposerDraft["masterMode"];
  field: "masterMode" | "compositionMode";
  invalidField: PrivateOfferDraftField | null;
  onChange: (value: "none" | "percentage" | "agreement") => void;
}) {
  return (
    <div
      {...invalidFieldProps(invalidField, field)}
      tabIndex={-1}
      className="grid grid-cols-1 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
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
  invalidField,
  patch,
  enablePdfAgreement = false,
  pdfUploadPending = false,
  onAgreementPdfSelect,
  onAgreementPdfRemove,
}: {
  idPrefix: string;
  draft: PrivateOfferComposerDraft;
  invalidField: PrivateOfferDraftField | null;
  patch: PatchDraft;
  enablePdfAgreement?: boolean;
  pdfUploadPending?: boolean;
  onAgreementPdfSelect?: (file: File) => void;
  onAgreementPdfRemove?: () => void;
}) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="font-display text-[16px] font-bold">Master royalty</legend>
        <RoyaltyPicker
          name={`${idPrefix}-master-mode`}
          value={draft.masterMode}
          field="masterMode"
          invalidField={invalidField}
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
              field="masterPercentage"
              invalidField={invalidField}
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
          field="compositionMode"
          invalidField={invalidField}
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
              field="compositionPercentage"
              invalidField={invalidField}
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
                {...invalidFieldProps(invalidField, "collectingSociety")}
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
          {...invalidFieldProps(invalidField, "royaltyNotes")}
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
        {draft.rightsNeedCompletion ? (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.1)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--fg-default))]"
          >
            This Store product had no canonical rights to copy. Confirm the exact rights before
            sending.
          </p>
        ) : null}
        <textarea
          id={`${idPrefix}-rights`}
          {...invalidFieldProps(invalidField, "rights")}
          value={draft.rights}
          required
          maxLength={MAX_RIGHTS * MAX_RIGHT_LENGTH + MAX_RIGHTS - 1}
          rows={5}
          onChange={(event) => {
            patch({ rights: event.target.value, rightsNeedCompletion: false });
          }}
          className={TEXTAREA_CLASS}
        />
      </div>
      <div className="flex flex-col gap-3 border-t border-[rgb(var(--border-subtle))] pt-5">
        <p className="text-[10.5px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
          Agreement
        </p>
        {draft.agreementNeedsCompletion ? (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.1)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--fg-default))]"
          >
            This Store product used terms that cannot be copied. Write the exact agreement before
            sending.
          </p>
        ) : null}
        {enablePdfAgreement ? (
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Agreement type">
            {(
              [
                ["none", "No agreement"],
                ["pdf", "Upload PDF"],
                ["text", "Write terms"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.agreementMode === mode}
                onClick={() => {
                  if (mode !== "pdf") onAgreementPdfRemove?.();
                  patch({
                    agreementMode: mode,
                    ...(mode === "text" ? {} : { agreementText: "" }),
                    ...(mode === "pdf" ? {} : { agreementPdf: null }),
                    agreementNeedsCompletion: false,
                  });
                }}
                className={`sk-press min-h-11 rounded-[var(--radius-lg)] border px-2 text-[12px] font-semibold sm:rounded-[var(--radius-md)] ${
                  draft.agreementMode === mode
                    ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {!enablePdfAgreement || draft.agreementMode === "text" ? (
          <>
            <Label htmlFor={`${idPrefix}-agreement`}>Exact agreement</Label>
            <textarea
              id={`${idPrefix}-agreement`}
              {...invalidFieldProps(invalidField, "agreementText")}
              value={draft.agreementText}
              required
              maxLength={MAX_AGREEMENT_LENGTH}
              rows={10}
              onChange={(event) => {
                patch({
                  agreementMode: "text",
                  agreementText: event.target.value,
                  agreementNeedsCompletion: false,
                });
              }}
              className={TEXTAREA_CLASS}
            />
            <p className="text-right text-[11px] text-[rgb(var(--fg-faint))]">
              {draft.agreementText.length.toLocaleString()} /{" "}
              {MAX_AGREEMENT_LENGTH.toLocaleString()}
            </p>
          </>
        ) : null}
        {enablePdfAgreement && draft.agreementMode === "pdf" ? (
          <label
            onDragOver={(event) => { event.preventDefault(); }}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) onAgreementPdfSelect?.(file);
            }}
            className="sk-press flex min-h-36 cursor-pointer flex-col justify-center rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-5 py-4 text-center hover:border-[rgb(var(--brand-primary))]"
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={pdfUploadPending}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAgreementPdfSelect?.(file);
                event.target.value = "";
              }}
            />
            <FileText
              className="mx-auto h-5 w-5 text-[rgb(var(--brand-primary-dark))]"
              aria-hidden
            />
            {draft.agreementPdf ? (
              <>
                <span className="mt-2 text-[13px] font-semibold break-words text-[rgb(var(--fg-default))]">
                  {draft.agreementPdf.originalFileName}
                </span>
                <span className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
                  PDF · {(draft.agreementPdf.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </span>
                <span className="mt-2 text-[11.5px] text-[rgb(var(--fg-muted))]">
                  {pdfUploadPending
                    ? "Uploading replacement…"
                    : "Drop a new PDF here to replace it"}
                </span>
              </>
            ) : (
              <>
                <span className="mt-2 text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                  {pdfUploadPending ? "Uploading…" : "Drop your agreement PDF here"}
                </span>
                <span className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
                  or tap to choose a file
                </span>
                <span className="mt-2 text-[11px] text-[rgb(var(--fg-faint))]">
                  PDF only · up to 15 MB
                </span>
              </>
            )}
          </label>
        ) : null}
        {enablePdfAgreement && draft.agreementMode === "pdf" && draft.agreementPdf ? (
          <button
            type="button"
            onClick={onAgreementPdfRemove}
            className="sk-press min-h-10 self-start rounded-[var(--radius-lg)] px-2.5 text-[12px] font-semibold text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]"
          >
            Remove agreement
          </button>
        ) : null}
      </div>
    </div>
  );
}
