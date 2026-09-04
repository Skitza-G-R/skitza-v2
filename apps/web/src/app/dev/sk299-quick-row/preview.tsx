"use client";

import { useState } from "react";

import { PostImportSummary } from "~/components/dashboard/active-work-import/post-import-summary";
import { QuickRowForm } from "~/components/dashboard/active-work-import/quick-row-form";
import {
  newImportDraft,
  type ActiveWorkImportDraft,
  type SetupClientOption,
  type SetupInstallmentOption,
  type StoreTemplateOption,
  type WorkspaceImportRow,
} from "~/components/dashboard/active-work-import/model";

const defaults = {
  defaultCurrency: "ILS",
  defaultTaxMode: "tax_included" as const,
  defaultTaxRatePct: 17,
};

const TEMPLATE: StoreTemplateOption = {
  id: "template-quick",
  name: "Full production",
  kind: "album",
  service: "Production and mixing",
  deliverables: ["Mixes", "Masters"],
  subtotalCents: 500_000,
  currency: "ILS",
  taxMode: "tax_included",
  taxRatePct: 17,
  includedSongSpaces: 3,
  revisionRule: { kind: "fixed", count: 2 },
  royaltyTerms: null,
  rights: ["Artist owns the masters"],
  plans: [{ kind: "split_50_50" }],
  agreementText: "The agreement we already signed, carried over exactly as it was.",
  session: null,
};

function row(draft: ActiveWorkImportDraft): WorkspaceImportRow {
  return {
    rowId: "row-1",
    operationKey: "op-1",
    revision: 1,
    draft,
    assessment: { state: "ready", creationDigest: "digest", normalized: {} as never },
    materializedAtIso: null,
    createdClientContactId: null,
    createdProjectId: null,
    createdPurchaseId: null,
    saveState: "saved",
    saveError: null,
    materializeError: null,
    localVersion: 0,
    persistedLocalVersion: 0,
  };
}

const CREATED_ROW: WorkspaceImportRow = {
  ...row(newImportDraft(defaults)),
  materializedAtIso: "2026-09-04T10:00:00.000Z",
  createdClientContactId: "client-1",
};

const INSTALLMENTS: readonly SetupInstallmentOption[] = [
  {
    id: "installment-1",
    rowId: "row-1",
    projectId: "project-1",
    purchaseId: "purchase-1",
    projectTitle: "Noya EP",
    agreementName: "Full production",
    position: 2,
    amountCents: 250_000,
    remainingCents: 250_000,
    currency: "ILS",
    dueTrigger: "artist_approval",
    dueAtIso: "2026-10-15T00:00:00.000Z",
    triggeredAtIso: null,
    status: "not_paid",
    remindersEnabled: true,
    reminderEligible: true,
    reminderWaitingForDueDate: false,
  },
];

const CLIENTS: readonly SetupClientOption[] = [
  {
    id: "client-1",
    name: "Noya Levi",
    email: "noya@example.com",
    connected: false,
    providerAcceptedAtIso: null,
    invitationEligible: true,
    invitationState: "available",
  },
];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-2 font-mono text-[11px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
        {title}
      </h2>
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
        {children}
      </div>
    </section>
  );
}

export function Sk299Preview() {
  const [draft, setDraft] = useState<ActiveWorkImportDraft>(() => newImportDraft(defaults));

  return (
    <main className="mx-auto min-w-0 max-w-[900px] px-3 py-6 sm:px-5">
      <h1 className="mb-6 text-[20px] font-extrabold text-[rgb(var(--fg-default))]">
        SK-299 — quick row and the screen after
      </h1>

      <Panel title="Quick row — live, type in it">
        <div className="flex h-[640px] flex-col">
          <QuickRowForm
            row={row(draft)}
            template={TEMPLATE}
            mobile={false}
            reasons={[]}
            saving={false}
            onBack={() => undefined}
            onChange={setDraft}
            onSave={() => Promise.resolve()}
            onChangeDetails={() => undefined}
            onRemove={() => undefined}
            removeDisabled={false}
          />
        </div>
      </Panel>

      <Panel title="After the import">
        <div className="p-4">
          <PostImportSummary
            rows={[CREATED_ROW]}
            installments={INSTALLMENTS}
            clients={CLIENTS}
            producerSlug="gili"
            producerName="Gili"
            onDone={() => undefined}
          />
        </div>
      </Panel>
    </main>
  );
}
