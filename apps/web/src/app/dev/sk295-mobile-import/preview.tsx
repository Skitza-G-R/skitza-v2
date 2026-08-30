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
  type WorkspaceImportRow,
} from "~/components/dashboard/active-work-import/model";

// Every server-facing callback on this page is inert: the gallery exists so
// the phone editor can be driven by hand, not to talk to the server.
const noReasons = () => Promise.resolve<readonly ImportReasonView[]>([]);
const noop = () => undefined;

const CLIENTS: readonly ExistingClientOption[] = [
  { id: "client-uri", name: "אורי שכיב", email: "shakivori@example.com" },
  { id: "client-maya", name: "Maya Levi", email: "maya@example.com" },
  { id: "client-noa", name: "Noa Peretz", email: "noa@example.com" },
  { id: "client-daniel", name: "Daniel Ben-Ami", email: "daniel@example.com" },
];

function freshRow(): WorkspaceImportRow {
  const draft = newImportDraft({
    defaultCurrency: "ILS",
    defaultTaxMode: "tax_free",
    defaultTaxRatePct: 0,
  });
  draft.client = {
    existingClientId: null,
    name: "Typed Newcomer",
    email: "newcomer@example.com",
    phone: "",
  };
  draft.project.title = "Blue Hour";
  return {
    rowId: "00000000-0000-4000-8000-000000000295",
    operationKey: "sk295-preview-row",
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

/**
 * Simulates what NativeViewportSync writes during an iOS rubber-band
 * overscroll: a transient non-zero --sk-viewport-offset-top with the keyboard
 * closed. The anchored editor must ignore it; a keyboard-open editor must
 * follow it.
 */
function applyViewportSimulation(offset: number, keyboardOpen: boolean) {
  document.documentElement.style.setProperty(
    "--sk-viewport-offset-top",
    `${String(offset)}px`,
  );
  document.body.dataset.skKeyboard = keyboardOpen ? "open" : "closed";
}

export function Sk295Preview() {
  const [row, setRow] = useState<WorkspaceImportRow>(freshRow);
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
      <h1 className="text-[15px] font-extrabold">SK-295 — phone import editor</h1>
      <p className="mt-1 max-w-md text-[12px] text-[rgb(var(--fg-muted))]">
        Drives the real ImportRowEditor in mobile mode with inert saves. The
        buttons below write the same signals NativeViewportSync writes on iOS.
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
          data-sim="rubber-band"
          onClick={() => {
            applyViewportSimulation(48, false);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Simulate rubber-band offset (keyboard closed)
        </button>
        <button
          type="button"
          data-sim="keyboard-open"
          onClick={() => {
            applyViewportSimulation(48, true);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Simulate keyboard open (offset kept)
        </button>
        <button
          type="button"
          data-sim="reset-viewport"
          onClick={() => {
            applyViewportSimulation(0, false);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Reset viewport
        </button>
      </div>
      <p data-sim="state" className="mt-3 font-mono text-[11px] text-[rgb(var(--fg-muted))]">
        editor: {editorOpen ? "open" : "closed"} · client:{" "}
        {row.draft.client.existingClientId ?? "none"} · name: {row.draft.client.name || "—"} ·
        last step: {lastStep ?? "—"}
      </p>

      {editorOpen ? (
        <ImportRowEditor
          row={row}
          index={0}
          clients={CLIENTS}
          archivedClients={[]}
          templates={[]}
          mobile
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
      ) : null}
    </div>
  );
}
