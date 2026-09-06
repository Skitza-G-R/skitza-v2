"use client";

import { useState } from "react";

import {
  ImportRowEditor,
  type ImportEditorStep,
} from "~/components/dashboard/active-work-import/import-row-editor";
import {
  newImportDraft,
  type ActiveWorkImportDraft,
  type ExistingClientOption,
  type ImportReasonView,
  type StoreTemplateOption,
  type WorkspaceImportRow,
} from "~/components/dashboard/active-work-import/model";

// Every server-facing callback on this page is inert: the gallery exists so
// the editor can be driven by hand, not to talk to the server.
const noReasons = () => Promise.resolve<readonly ImportReasonView[]>([]);
const noop = () => undefined;

const CLIENTS: readonly ExistingClientOption[] = [
  { id: "client-maya", name: "Maya Levi", email: "maya@example.com" },
  { id: "client-noa", name: "Noa Peretz", email: "noa@example.com" },
  { id: "client-daniel", name: "Daniel Ben-Ami", email: "daniel@example.com" },
];

const TEMPLATES: readonly StoreTemplateOption[] = [
  {
    id: "product-album",
    name: "Album production",
    kind: "album",
    service: "Production",
    deliverables: ["8 produced tracks", "Stems", "Masters"],
    subtotalCents: 1_800_000,
    currency: "ILS",
    taxMode: "tax_added",
    taxRatePct: 17,
    includedSongSpaces: 8,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: {
      master: { mode: "percentage", bps: 1_500 },
      composition: { mode: "none" },
    },
    rights: ["Artist owns the masters", "Producer credit on every release"],
    plans: [{ kind: "split_50_50" }],
    agreementText: "The producer delivers eight produced tracks with stems and masters.",
    agreementPdf: null,
    session: {
      limit: { kind: "fixed", count: 6 },
      durationMin: 120,
      locationType: "studio",
      bufferMinutes: 15,
      minLeadHours: 24,
    },
  },
  {
    id: "product-mix",
    name: "Single mix",
    kind: "mix",
    service: "Mixing",
    deliverables: ["One mixed single"],
    subtotalCents: 150_000,
    currency: "ILS",
    taxMode: "tax_added",
    taxRatePct: 17,
    includedSongSpaces: 1,
    revisionRule: { kind: "unlimited" },
    royaltyTerms: null,
    rights: [],
    plans: [{ kind: "full" }],
    agreementText: "",
    agreementPdf: { fileName: "single-mix-agreement.pdf", sizeBytes: 184_320 },
    session: null,
  },
  {
    id: "product-master",
    name: "Mastering",
    kind: "mastering",
    service: "Mastering",
    deliverables: ["Mastered WAV", "Streaming masters"],
    subtotalCents: 60_000,
    currency: "ILS",
    taxMode: "tax_added",
    taxRatePct: 17,
    includedSongSpaces: 1,
    revisionRule: { kind: "fixed", count: 1 },
    royaltyTerms: null,
    rights: [],
    plans: [{ kind: "full" }],
    agreementText: "",
    agreementPdf: null,
    session: null,
  },
  {
    id: "product-consult",
    name: "Studio day",
    kind: "session",
    service: "Studio session",
    deliverables: ["Recorded session files"],
    subtotalCents: 90_000,
    currency: "ILS",
    taxMode: "tax_added",
    taxRatePct: 17,
    includedSongSpaces: 0,
    revisionRule: null,
    royaltyTerms: null,
    rights: [],
    plans: [{ kind: "monthly", installments: 3 }],
    agreementText: "",
    agreementPdf: null,
    session: {
      limit: { kind: "fixed", count: 1 },
      durationMin: 480,
      locationType: "studio",
      bufferMinutes: 30,
      minLeadHours: 48,
    },
  },
];

function freshRow(): WorkspaceImportRow {
  const draft = newImportDraft({
    defaultCurrency: "ILS",
    defaultTaxMode: "tax_added",
    defaultTaxRatePct: 17,
  });
  return {
    rowId: "00000000-0000-4000-8000-000000000308",
    operationKey: "sk308-preview-row",
    revision: 1,
    draft,
    assessment: null,
    materializedAtIso: null,
    createdClientContactId: null,
    createdProjectId: null,
    createdPurchaseId: null,
    saveState: "idle",
    saveError: null,
    materializeError: null,
    localVersion: 1,
    persistedLocalVersion: 1,
  };
}

export function Sk308Preview() {
  const [row, setRow] = useState<WorkspaceImportRow>(freshRow);
  const [mobile, setMobile] = useState(true);
  const [editorOpen, setEditorOpen] = useState(true);
  const [lastStep, setLastStep] = useState<string | null>(null);

  function onChange(draft: ActiveWorkImportDraft) {
    setRow((current) => ({
      ...current,
      draft,
      localVersion: current.localVersion + 1,
    }));
  }

  function onContinueStep(step: ImportEditorStep) {
    setLastStep(step);
    return noReasons();
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-background))] p-4 text-[rgb(var(--fg-default))]">
      <h1 className="text-[15px] font-extrabold">SK-308 — simplified import editor</h1>
      <p className="mt-1 max-w-md text-[12px] text-[rgb(var(--fg-muted))]">
        Drives the real ImportRowEditor with four Store products and inert saves.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-sim="open-editor"
          onClick={() => {
            setEditorOpen(true);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Open editor
        </button>
        <button
          type="button"
          data-sim="toggle-layout"
          aria-pressed={mobile}
          onClick={() => {
            setMobile((current) => !current);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          {mobile ? "Phone layout" : "Desktop layout"}
        </button>
        <button
          type="button"
          data-sim="reset"
          onClick={() => {
            setRow(freshRow());
            setLastStep(null);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Reset draft
        </button>
      </div>
      <p data-sim="state" className="mt-3 font-mono text-[11px] text-[rgb(var(--fg-muted))]">
        editor: {editorOpen ? "open" : "closed"} · product:{" "}
        {row.draft.agreement.templateProductId ?? "custom"} · price:{" "}
        {row.draft.agreement.subtotal || "—"} · plan: {row.draft.agreement.planKind} · last step:{" "}
        {lastStep ?? "—"}
      </p>

      {editorOpen ? (
        <div className={mobile ? undefined : "mt-4 h-[calc(100dvh-11rem)] max-w-4xl"}>
          <ImportRowEditor
            row={row}
            index={0}
            clients={CLIENTS}
            archivedClients={[]}
            templates={TEMPLATES}
            mobile={mobile}
            onBack={() => {
              setEditorOpen(false);
            }}
            onChange={onChange}
            onContinueStep={onContinueStep}
            onFinishItem={noReasons}
            onSaveForLater={() => Promise.resolve(true)}
            onRemove={noop}
            removeDisabled={false}
            restoringClientId={null}
            onRestoreClient={noop}
            proofUploads={{}}
            onUploadProof={noop}
            onUploadAgreementPdf={noop}
          />
        </div>
      ) : null}
    </div>
  );
}
