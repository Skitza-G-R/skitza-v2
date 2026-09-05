"use client";

import { useState } from "react";

import { ImportRowEditor } from "~/components/dashboard/active-work-import/import-row-editor";
import {
  newImportDraft,
  type ActiveWorkImportDraft,
  type ExistingClientOption,
  type ImportReasonView,
  type WorkspaceImportRow,
} from "~/components/dashboard/active-work-import/model";
import { useBodyScrollLock } from "~/components/native/use-body-scroll-lock";

// Every server-facing callback on this page is inert: the gallery exists so
// the phone editor can be driven by hand, not to talk to the server.
const noReasons = () => Promise.resolve<readonly ImportReasonView[]>([]);
const noop = () => undefined;

const CLIENTS: readonly ExistingClientOption[] = [
  { id: "client-uri", name: "אורי שכיב", email: "shakivori@example.com" },
  { id: "client-maya", name: "Maya Levi", email: "maya@example.com" },
];

function freshRow(): WorkspaceImportRow {
  const draft = newImportDraft({
    defaultCurrency: "ILS",
    defaultTaxMode: "tax_free",
    defaultTaxRatePct: 0,
  });
  draft.client = {
    existingClientId: null,
    name: "אורי שכיב",
    email: "shakivori@example.com",
    phone: "",
  };
  draft.project.title = "הפקה מלאה";
  draft.agreement.name = "הפקה מלאה";
  draft.agreement.service = "production";
  return {
    rowId: "00000000-0000-4000-8000-000000000297",
    operationKey: "sk297-preview-row",
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
 * Writes exactly what NativeViewportSync writes on iOS when the software
 * keyboard opens: the visual viewport shrinks to the strip above the keyboard,
 * the obscured height becomes the keyboard inset, and the body is flagged open.
 */
function applyKeyboard(keyboardOpen: boolean, offsetTop = 0) {
  const root = document.documentElement;
  const innerHeight = window.innerHeight;
  const keyboardInset = keyboardOpen ? Math.round(innerHeight * 0.42) : 0;
  const height = innerHeight - keyboardInset - offsetTop;
  root.style.setProperty("--sk-viewport-height", `${String(height)}px`);
  root.style.setProperty("--sk-viewport-offset-top", `${String(offsetTop)}px`);
  root.style.setProperty("--sk-keyboard-inset", `${String(keyboardInset)}px`);
  document.body.dataset.skKeyboard = keyboardOpen ? "open" : "closed";
}

/**
 * SK-297 visual check. The workspace behind the phone editor is a long
 * scrollable queue, which is what let iOS scroll the document — and the fixed
 * editor with it — when the keyboard opened. This page reproduces that
 * backdrop and drives the same lock the workspace applies, with a switch so
 * the locked and unlocked document can be photographed side by side.
 */
export function Sk297Preview() {
  const [row, setRow] = useState<WorkspaceImportRow>(freshRow);
  const [editorOpen, setEditorOpen] = useState(true);
  const [lockEnabled, setLockEnabled] = useState(true);

  useBodyScrollLock(editorOpen && lockEnabled);

  function onChange(draft: ActiveWorkImportDraft) {
    setRow((current) => ({
      ...current,
      draft,
      localVersion: current.localVersion + 1,
    }));
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-background))] p-4 text-[rgb(var(--fg-default))]">
      <h1 className="text-[15px] font-extrabold">SK-297 — keyboard and the phone import editor</h1>
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
          data-sim="toggle-lock"
          onClick={() => {
            setLockEnabled((current) => !current);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Lock: {lockEnabled ? "on" : "off"}
        </button>
        <button
          type="button"
          data-sim="keyboard-open"
          onClick={() => {
            applyKeyboard(true);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Keyboard open
        </button>
        <button
          type="button"
          data-sim="keyboard-closed"
          onClick={() => {
            applyKeyboard(false);
          }}
          className="min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12px] font-bold"
        >
          Keyboard closed
        </button>
      </div>

      {/* The workspace queue behind the editor: long enough that the document
          has a real scroll range, which is the precondition for the bug. */}
      <ul aria-label="Backdrop queue" className="mt-4 space-y-2">
        {Array.from({ length: 24 }, (_, index) => (
          <li
            key={index}
            className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-4 text-[12px]"
          >
            Queue item {String(index + 1).padStart(2, "0")}
          </li>
        ))}
      </ul>

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
          onContinueStep={noReasons}
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
