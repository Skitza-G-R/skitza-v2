"use client";

import {
  ArchiveRestore,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SaveIndicator } from "~/components/ui/save-indicator";

import { AgreementEditor } from "./agreement-editor";
import {
  isRowReady,
  matchingArchivedClient,
  matchingExistingClient,
  rowDisplayReasons,
  type ActiveWorkImportDraft,
  type ArchivedClientOption,
  type ExistingClientOption,
  type ImportReasonView,
  type StoreTemplateOption,
  type WorkspaceImportRow,
} from "./model";
import { PaymentHistoryEditor, type ProofUploadView } from "./payment-history-editor";

const FIELD_CLASS =
  "sk-native-field min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-10 sm:rounded-[var(--radius-md)] sm:text-[13px]";

export type ImportEditorMemory = {
  activeStepIndex: number;
  completedThrough: number;
  revealedSteps: readonly number[];
};

export const IMPORT_EDITOR_STEPS = ["Client & Project", "Agreement", "Payments"] as const;
export type ImportEditorStep = (typeof IMPORT_EDITOR_STEPS)[number];

function stepIndexForReason(reason: ImportReasonView): number {
  if (reason.field.startsWith("client.") || reason.field.startsWith("project.")) return 0;
  if (reason.field.startsWith("payments") || reason.field === "agreement.plan") return 2;
  if (reason.field.startsWith("agreement")) return 1;
  return 2;
}

function reasonsForStep(reasons: readonly ImportReasonView[], index: number) {
  return reasons.filter(
    (reason) => reason.code !== "checking" && stepIndexForReason(reason) === index,
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
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

function keyboardFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
  );
  return [...candidates].filter((element) => {
    if (element.closest('[hidden], [aria-hidden="true"], fieldset[disabled]')) return false;
    let ancestor: HTMLElement | null = element;
    while (ancestor && ancestor !== container) {
      if (ancestor.classList.contains("hidden")) return false;
      ancestor = ancestor.parentElement;
    }
    const closedDetails = element.closest("details:not([open])");
    if (!closedDetails) return true;
    const containingSummary = element.closest("summary");
    return containingSummary?.parentElement === closedDetails;
  });
}

function StepSection({
  number,
  title,
  hint,
  children,
}: {
  number: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section data-active-import-step={title} className="min-w-0 py-1">
      <header className="mb-4 border-b border-[rgb(var(--border-subtle))] pb-3">
        <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
          Step {number} of 3
        </p>
        <h2 className="mt-1 text-[19px] font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          {title}
        </h2>
        <p className="mt-0.5 max-w-[58ch] text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {hint}
        </p>
      </header>
      {children}
    </section>
  );
}

function StepIssues({ reasons }: { reasons: readonly ImportReasonView[] }) {
  if (reasons.length === 0) return null;
  return (
    <div
      role="alert"
      className="mt-6 border-t border-[rgb(var(--fg-warning)/0.35)] pt-4 text-[rgb(var(--fg-warning-text))]"
    >
      <div className="flex items-center gap-2 text-[12px] font-bold">
        <CircleAlert size={15} strokeWidth={2.2} aria-hidden />
        Finish these details
      </div>
      <ul className="mt-2 space-y-1.5 pl-6 text-[12px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        {reasons.map((reason) => (
          <li key={`${reason.code}:${reason.field}`} className="list-disc">
            {reason.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportRowEditor({
  row,
  index,
  clients,
  archivedClients,
  templates,
  mobile,
  onBack,
  onChange,
  onContinueStep,
  onFinishItem,
  onSaveForLater,
  onRemove,
  removeDisabled,
  restoringClientId,
  onRestoreClient,
  proofUploads,
  onUploadProof,
  editorMemory,
}: {
  row: WorkspaceImportRow;
  index: number;
  clients: readonly ExistingClientOption[];
  archivedClients: readonly ArchivedClientOption[];
  templates: readonly StoreTemplateOption[];
  mobile: boolean;
  onBack: () => void;
  onChange: (draft: ActiveWorkImportDraft) => void;
  onContinueStep: (step: ImportEditorStep) => Promise<readonly ImportReasonView[]>;
  onFinishItem: () => Promise<readonly ImportReasonView[]>;
  onSaveForLater: () => Promise<boolean>;
  onRemove: () => void;
  removeDisabled: boolean;
  restoringClientId: string | null;
  onRestoreClient: (client: ArchivedClientOption) => void;
  proofUploads: Readonly<Record<string, ProofUploadView>>;
  onUploadProof: (paymentOperationKey: string, file: File) => void;
  /**
   * Where this item's editor progress lives across remounts. The desktop pane and
   * the phone dialog are different component instances, so a layout switch
   * (window resize, browser zoom, orientation) would otherwise reset the
   * producer to step 1. Keyed by row operation key.
   */
  editorMemory?: Map<string, ImportEditorMemory>;
}) {
  const { draft } = row;
  const remembered = editorMemory?.get(row.operationKey);
  const [activeStepIndex, setActiveStepIndex] = useState(remembered?.activeStepIndex ?? 0);
  const [completedThrough, setCompletedThrough] = useState(remembered?.completedThrough ?? -1);
  const [revealedSteps, setRevealedSteps] = useState<Set<number>>(
    () => new Set(remembered?.revealedSteps ?? []),
  );
  const [stepBusy, setStepBusy] = useState(false);
  const [paymentEditing, setPaymentEditing] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(() => draft.client.phone.trim().length > 0);
  const [existingClientSearch, setExistingClientSearch] = useState("");
  const editorRef = useRef<HTMLElement>(null);
  const selectedClient = clients.find((client) => client.id === draft.client.existingClientId);
  const archivedSelected = archivedClients.find(
    (client) => client.id === draft.client.existingClientId,
  );
  const emailMatch = draft.client.existingClientId ? null : matchingExistingClient(draft, clients);
  const archivedMatch = matchingArchivedClient(draft, archivedClients);
  const created = row.materializedAtIso !== null;
  const ready = isRowReady(row.assessment, draft, clients, archivedClients);
  const proofUploading = Object.values(proofUploads).some(
    (upload) => upload.status === "uploading",
  );
  const allReasons: readonly ImportReasonView[] = row.materializeError
    ? [{ code: "materialize_failed", field: "row", message: row.materializeError }]
    : rowDisplayReasons(row.assessment, draft, clients, archivedClients).filter(
        (reason) => reason.code !== "checking",
      );
  const visibleReasons = revealedSteps.has(activeStepIndex)
    ? reasonsForStep(allReasons, activeStepIndex)
    : [];
  const fallbackReasons = visibleReasons.filter(
    (reason) => activeStepIndex === 2 || reason.field === "row" || reason.field.endsWith(".save"),
  );
  const issueId = (field: string) => `import-${field}-issues-${row.operationKey}`;

  useEffect(() => {
    const memory = editorMemory?.get(row.operationKey);
    setActiveStepIndex(memory?.activeStepIndex ?? 0);
    setCompletedThrough(memory?.completedThrough ?? -1);
    setRevealedSteps(new Set(memory?.revealedSteps ?? []));
    setPaymentEditing(false);
    // editorMemory is a stable ref-backed map; only the row identity matters here.
  }, [editorMemory, row.operationKey]);

  useEffect(() => {
    editorMemory?.set(row.operationKey, {
      activeStepIndex,
      completedThrough,
      revealedSteps: Array.from(revealedSteps),
    });
  }, [editorMemory, row.operationKey, activeStepIndex, completedThrough, revealedSteps]);

  useEffect(() => {
    if (mobile) editorRef.current?.focus();
  }, [mobile, row.operationKey]);

  function patchDraft(patch: Partial<ActiveWorkImportDraft>) {
    onChange({ ...draft, ...patch });
  }

  function patchClient(patch: Partial<ActiveWorkImportDraft["client"]>) {
    patchDraft({ client: { ...draft.client, ...patch } });
  }

  function patchProject(patch: Partial<ActiveWorkImportDraft["project"]>) {
    patchDraft({ project: { ...draft.project, ...patch } });
  }

  function revealStep(stepIndex = activeStepIndex) {
    setRevealedSteps((current) => new Set(current).add(stepIndex));
  }

  async function continueStep() {
    if (stepBusy) return;
    revealStep();
    setStepBusy(true);
    const reasons = await onContinueStep(
      IMPORT_EDITOR_STEPS[activeStepIndex] ?? "Client & Project",
    );
    setStepBusy(false);
    if (reasonsForStep(reasons, activeStepIndex).length > 0) return;
    setCompletedThrough((current) => Math.max(current, activeStepIndex));
    setActiveStepIndex((current) => Math.min(2, current + 1));
  }

  async function finishItem() {
    if (stepBusy) return;
    revealStep(2);
    setStepBusy(true);
    const reasons = await onFinishItem();
    setStepBusy(false);
    if (reasons.length === 0) return;
    const firstProblemStep = Math.min(...reasons.map(stepIndexForReason));
    setActiveStepIndex(firstProblemStep);
    revealStep(firstProblemStep);
  }

  function trapMobileTab(event: React.KeyboardEvent<HTMLElement>) {
    if (!mobile || event.key !== "Tab") return;
    const focusable = keyboardFocusableElements(event.currentTarget);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      editorRef.current?.focus();
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

  return (
    <article
      ref={editorRef}
      className={`min-w-0 bg-[rgb(var(--bg-elevated))] transition-[border-color,box-shadow,transform] duration-200 motion-reduce:transition-none ${
        mobile
          ? "sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[70] flex flex-col overflow-hidden"
          : "flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] shadow-[var(--shadow-md)]"
      }`}
      role={mobile ? "dialog" : undefined}
      aria-modal={mobile ? true : undefined}
      aria-label={`Edit item ${String(index + 1)}`}
      tabIndex={mobile ? -1 : undefined}
      onKeyDownCapture={trapMobileTab}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-4 py-3 sm:px-5">
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
              Item {String(index + 1).padStart(2, "0")}
            </p>
            <h1 className="mt-0.5 truncate text-[17px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:text-[19px]">
              {draft.project.title.trim() || draft.client.name.trim() || "New active work"}
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

      <nav
        aria-label="Item steps"
        className="grid shrink-0 grid-cols-3 border-b border-[rgb(var(--border-subtle))]"
      >
        {IMPORT_EDITOR_STEPS.map((step, stepIndex) => {
          const current = stepIndex === activeStepIndex;
          const complete = ready || created || stepIndex <= completedThrough;
          const available = current || ready || created || stepIndex <= completedThrough + 1;
          return (
            <button
              key={step}
              type="button"
              disabled={!available}
              aria-current={current ? "step" : undefined}
              onClick={() => {
                setActiveStepIndex(stepIndex);
              }}
              className={`sk-press min-w-0 border-b-2 px-1 py-2.5 text-center transition-colors duration-150 motion-reduce:transition-none sm:px-2 ${
                current
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.09)] text-[rgb(var(--fg-default))]"
                  : "border-transparent text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] disabled:cursor-default disabled:opacity-45"
              }`}
            >
              <span className="flex items-center justify-center gap-1">
                {complete && !current ? <Check size={12} strokeWidth={2.4} aria-hidden /> : null}
                <span className="font-mono text-[9px] font-semibold">0{String(stepIndex + 1)}</span>
              </span>
              <span className="mt-0.5 block truncate text-[10px] font-bold sm:text-[11px]">
                {step}
              </span>
            </button>
          );
        })}
      </nav>

      <div
        className={
          mobile
            ? "sk-native-scroll min-h-0 flex-1 overflow-x-hidden px-4 pt-4 pb-36"
            : "min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-6"
        }
        onBlurCapture={() => {
          revealStep();
        }}
      >
        {created ? (
          <div className="mb-5 flex items-center gap-2 border-b border-[rgb(var(--border-subtle))] pb-4 text-[12px] text-[rgb(var(--fg-success-text))]">
            <Check size={15} strokeWidth={2.3} aria-hidden />
            Created quietly. The client was not contacted.
          </div>
        ) : null}

        <fieldset disabled={created} className="min-w-0 disabled:opacity-70">
          {activeStepIndex === 0 ? (
            <StepSection
              number="1"
              title="Client & Project"
              hint="Choose who this belongs to and name the work. Nothing is sent."
            >
              <div className="space-y-4">
                <div
                  role="group"
                  aria-label="Client type"
                  className="grid grid-cols-2 gap-1 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-1"
                >
                  <button
                    type="button"
                    aria-pressed={draft.client.existingClientId !== null}
                    onClick={() => {
                      const first = selectedClient ?? clients[0];
                      if (first) {
                        patchClient({
                          existingClientId: first.id,
                          name: first.name,
                          email: first.email,
                          phone: "",
                        });
                      }
                    }}
                    disabled={clients.length === 0}
                    className={`sk-press min-h-11 rounded-[var(--radius-lg)] px-3 text-[13px] font-bold ${
                      draft.client.existingClientId
                        ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                        : "text-[rgb(var(--fg-muted))]"
                    }`}
                  >
                    Existing client
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.client.existingClientId === null}
                    onClick={() => {
                      patchClient({ existingClientId: null, name: "", email: "", phone: "" });
                      setExistingClientSearch("");
                      setPhoneOpen(false);
                    }}
                    className={`sk-press min-h-11 rounded-[var(--radius-lg)] px-3 text-[13px] font-bold ${
                      draft.client.existingClientId === null
                        ? "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                        : "text-[rgb(var(--fg-muted))]"
                    }`}
                  >
                    New client
                  </button>
                </div>

                {draft.client.existingClientId && selectedClient ? (
                  <div className="space-y-2">
                    <FieldLabel htmlFor={`import-client-${row.operationKey}`}>
                      Find client
                    </FieldLabel>
                    <div className="relative">
                      <Search
                        size={15}
                        strokeWidth={2}
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[rgb(var(--fg-faint))]"
                      />
                      <input
                        id={`import-client-${row.operationKey}`}
                        type="search"
                        list={`import-client-options-${row.operationKey}`}
                        value={
                          existingClientSearch || `${selectedClient.name} — ${selectedClient.email}`
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          setExistingClientSearch(value);
                          const normalized = value.trim().toLowerCase();
                          const client = clients.find(
                            (option) =>
                              `${option.name} — ${option.email}`.toLowerCase() === normalized ||
                              option.email.toLowerCase() === normalized,
                          );
                          if (client) {
                            patchClient({
                              existingClientId: client.id,
                              name: client.name,
                              email: client.email,
                              phone: "",
                            });
                            setExistingClientSearch("");
                          }
                        }}
                        onBlur={() => {
                          setExistingClientSearch("");
                        }}
                        {...issueAttributes(
                          visibleReasons,
                          ["client.existingClientId", "client.email"],
                          issueId("client-selection"),
                        )}
                        className={`${FIELD_CLASS} pl-9`}
                      />
                    </div>
                    <datalist id={`import-client-options-${row.operationKey}`}>
                      {clients.map((client) => (
                        <option key={client.id} value={`${client.name} — ${client.email}`} />
                      ))}
                    </datalist>
                    <p className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                      {selectedClient.email} · Saved details and access stay unchanged.
                    </p>
                    <FieldIssues
                      id={issueId("client-selection")}
                      reasons={visibleReasons}
                      fields={["client.existingClientId", "client.email"]}
                    />
                  </div>
                ) : archivedSelected ? (
                  <div className="border-l-2 border-[rgb(var(--fg-warning))] pl-3">
                    <p className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
                      {archivedSelected.name}
                    </p>
                    <p className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
                      {archivedSelected.email}
                    </p>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <FieldLabel htmlFor={`import-client-name-${row.operationKey}`}>
                        Client name
                      </FieldLabel>
                      <input
                        id={`import-client-name-${row.operationKey}`}
                        value={draft.client.name}
                        maxLength={160}
                        autoComplete="name"
                        onChange={(event) => {
                          patchClient({ name: event.target.value });
                        }}
                        placeholder="Artist or band name"
                        {...issueAttributes(
                          visibleReasons,
                          ["client.name"],
                          issueId("client-name"),
                        )}
                        className={FIELD_CLASS}
                      />
                      <FieldIssues
                        id={issueId("client-name")}
                        reasons={visibleReasons}
                        fields={["client.name"]}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor={`import-client-email-${row.operationKey}`}>
                        Email
                      </FieldLabel>
                      <input
                        id={`import-client-email-${row.operationKey}`}
                        type="email"
                        value={draft.client.email}
                        maxLength={320}
                        autoComplete="email"
                        onChange={(event) => {
                          patchClient({ email: event.target.value });
                        }}
                        placeholder="artist@example.com"
                        {...issueAttributes(
                          visibleReasons,
                          ["client.email", "client.existingClientId"],
                          issueId("client-email"),
                        )}
                        className={FIELD_CLASS}
                      />
                      <FieldIssues
                        id={issueId("client-email")}
                        reasons={visibleReasons}
                        fields={["client.email", "client.existingClientId"]}
                      />
                    </div>
                    {phoneOpen ? (
                      <div className="space-y-2 sm:col-span-2 sm:max-w-[50%] sm:pr-2">
                        <FieldLabel htmlFor={`import-client-phone-${row.operationKey}`}>
                          Phone{" "}
                          <span className="font-normal text-[rgb(var(--fg-muted))]">
                            (optional)
                          </span>
                        </FieldLabel>
                        <input
                          id={`import-client-phone-${row.operationKey}`}
                          type="tel"
                          value={draft.client.phone}
                          maxLength={40}
                          autoComplete="tel"
                          onChange={(event) => {
                            patchClient({ phone: event.target.value });
                          }}
                          placeholder="+972 50…"
                          {...issueAttributes(
                            visibleReasons,
                            ["client.phone"],
                            issueId("client-phone"),
                          )}
                          className={FIELD_CLASS}
                        />
                        <FieldIssues
                          id={issueId("client-phone")}
                          reasons={visibleReasons}
                          fields={["client.phone"]}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setPhoneOpen(true);
                        }}
                        className="sk-press inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-lg)] px-2 text-[12px] font-bold text-[rgb(var(--fg-default))] sm:col-span-2"
                      >
                        <Plus size={15} strokeWidth={2.2} aria-hidden />
                        Add phone
                      </button>
                    )}
                  </div>
                )}

                {archivedMatch ? (
                  <div className="flex flex-col gap-3 border-l-2 border-[rgb(var(--fg-warning))] pl-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
                        {archivedMatch.name} is archived
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                        Restore this client first. Saved details stay unchanged.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onRestoreClient(archivedMatch);
                      }}
                      disabled={restoringClientId !== null}
                      className="sk-press inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[12px] font-bold text-[rgb(var(--fg-on-brand))] disabled:opacity-50"
                    >
                      <ArchiveRestore size={14} strokeWidth={2.2} aria-hidden />
                      {restoringClientId === archivedMatch.id ? "Restoring…" : "Restore client"}
                    </button>
                  </div>
                ) : emailMatch ? (
                  <div className="flex flex-col gap-3 border-l-2 border-[rgb(var(--brand-primary))] pl-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
                        This email belongs to {emailMatch.name}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                        Reuse the client to avoid a duplicate.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        patchClient({
                          existingClientId: emailMatch.id,
                          name: emailMatch.name,
                          email: emailMatch.email,
                          phone: "",
                        });
                      }}
                      className="sk-press min-h-11 shrink-0 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[12px] font-bold text-[rgb(var(--fg-on-brand))]"
                    >
                      Use existing client
                    </button>
                  </div>
                ) : null}

                <div className="border-t border-[rgb(var(--border-subtle))] pt-4">
                  <h3 className="text-[13px] font-bold text-[rgb(var(--fg-default))]">Project</h3>
                  <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <FieldLabel htmlFor={`import-project-title-${row.operationKey}`}>
                        Project name
                      </FieldLabel>
                      <input
                        id={`import-project-title-${row.operationKey}`}
                        value={draft.project.title}
                        maxLength={200}
                        onChange={(event) => {
                          patchProject({ title: event.target.value });
                        }}
                        placeholder="Blue Hour"
                        {...issueAttributes(
                          visibleReasons,
                          ["project.title"],
                          issueId("project-title"),
                        )}
                        className={FIELD_CLASS}
                      />
                      <FieldIssues
                        id={issueId("project-title")}
                        reasons={visibleReasons}
                        fields={["project.title"]}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor={`import-project-deadline-${row.operationKey}`}>
                        Deadline{" "}
                        <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
                      </FieldLabel>
                      <input
                        id={`import-project-deadline-${row.operationKey}`}
                        type="date"
                        value={draft.project.deadlineAt}
                        onChange={(event) => {
                          patchProject({ deadlineAt: event.target.value });
                        }}
                        {...issueAttributes(
                          visibleReasons,
                          ["project.deadlineAt"],
                          issueId("project-deadline"),
                        )}
                        className={FIELD_CLASS}
                      />
                      <FieldIssues
                        id={issueId("project-deadline")}
                        reasons={visibleReasons}
                        fields={["project.deadlineAt"]}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </StepSection>
          ) : null}

          {activeStepIndex === 1 ? (
            <AgreementEditor
              draft={draft}
              templates={templates}
              operationKey={row.operationKey}
              reasons={visibleReasons}
              onChange={onChange}
            />
          ) : null}

          {activeStepIndex === 2 ? (
            <PaymentHistoryEditor
              draft={draft}
              operationKey={row.operationKey}
              proofUploads={proofUploads}
              onChange={onChange}
              onUploadProof={onUploadProof}
              onEditingChange={setPaymentEditing}
            />
          ) : null}
        </fieldset>

        {!created ? <StepIssues reasons={fallbackReasons} /> : null}
      </div>

      {!created ? (
        <footer
          className={`${
            mobile
              ? "sk-native-action-dock fixed inset-x-0 z-[80]"
              : "border-t border-[rgb(var(--border-subtle))] px-5 py-3.5 sm:px-7"
          } flex items-center justify-between gap-3 bg-[rgb(var(--bg-elevated)/0.97)] backdrop-blur-md`}
        >
          <button
            type="button"
            onClick={() => {
              void onSaveForLater();
            }}
            disabled={stepBusy || row.saveState === "saving" || proofUploading}
            className="sk-press min-h-11 rounded-[var(--radius-lg)] px-2 text-[12px] font-semibold text-[rgb(var(--fg-muted))] disabled:opacity-50"
          >
            Save for later
          </button>
          <button
            type="button"
            onClick={() => {
              if (activeStepIndex === 2) void finishItem();
              else void continueStep();
            }}
            disabled={
              stepBusy ||
              row.saveState === "saving" ||
              proofUploading ||
              (activeStepIndex === 2 && paymentEditing)
            }
            className={`sk-press inline-flex min-h-12 min-w-32 items-center justify-center gap-2 rounded-[var(--radius-lg)] px-5 text-[14px] font-bold disabled:cursor-not-allowed ${
              activeStepIndex === 2 && paymentEditing
                ? "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))] shadow-none"
                : "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)] disabled:opacity-50"
            }`}
          >
            {proofUploading
              ? "Uploading proof…"
              : stepBusy || row.saveState === "saving"
                ? "Saving…"
                : activeStepIndex === 2
                  ? "Finish item"
                  : activeStepIndex === 0
                    ? "Continue to agreement"
                    : "Continue to payments"}
            {!stepBusy && row.saveState !== "saving" && activeStepIndex < 2 ? (
              <ChevronRight size={15} strokeWidth={2.2} aria-hidden />
            ) : null}
          </button>
        </footer>
      ) : null}
    </article>
  );
}
