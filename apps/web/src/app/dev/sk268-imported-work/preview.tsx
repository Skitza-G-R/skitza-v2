"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  newImportDraft,
  type ActiveWorkImportDraft,
  type ImportAssessmentView,
  type SetupOptionsView,
  type WorkspaceImportRow,
} from "~/components/dashboard/active-work-import/model";
import { PaymentHistoryEditor } from "~/components/dashboard/active-work-import/payment-history-editor";
import { ReviewAndFinish } from "~/components/dashboard/active-work-import/review-and-finish";

// Every callback on this page is deliberately inert: the gallery exists to be
// photographed, not to talk to the server.
const noop = () => undefined;

/* ---------------------------------------------------------------- fixtures */

/** The same Ready assessment the review tests build, with the SK-270 day. */
function readyAssessment(firstPaymentDueDate: string | null): ImportAssessmentView {
  return {
    state: "ready",
    creationDigest: `sha256:${"a".repeat(64)}`,
    normalized: {
      existingClientId: null,
      templateProductId: null,
      clientName: "Maya Levi",
      clientEmail: "maya@example.com",
      clientPhone: null,
      projectTitle: "Blue Hour EP",
      deadlineAtIso: null,
      firstPaymentDueDate,
      agreementPdf: null,
      plan: { kind: "monthly", installments: 2 },
      commercialSnapshot: {
        version: 2,
        bookingEnabled: false,
        productOrOfferName: "Full production",
        service: "Production and mixing",
        deliverables: ["Production", "Mix and master"],
        lineItems: [
          {
            label: "Full production",
            quantity: 1,
            listUnitPriceCents: 800_000,
            unitPriceCents: 800_000,
            totalCents: 800_000,
          },
        ],
        listSubtotalCents: 800_000,
        discountCents: 0,
        subtotalCents: 800_000,
        tax: { mode: "tax_included", ratePct: 18, amountCents: 122_034 },
        totalCents: 800_000,
        currency: "ILS",
        includedSongSpaces: 6,
        session: null,
        revisionRule: { kind: "fixed", count: 2 },
        royaltyTerms: null,
        rights: ["Artist owns masters"],
        selectedPaymentPlan: { kind: "monthly", installments: 2 },
        offeredPaymentPlans: [{ kind: "monthly", installments: 2 }],
        agreementText: "The exact existing agreement terms.",
        agreementMode: "text",
      },
      snapshotDigest: "snapshot-ready",
      schedule: [
        { sequence: 1, amountCents: 400_000, trigger: "producer_import", status: "confirmed" },
        { sequence: 2, amountCents: 400_000, trigger: "monthly_anniversary", status: "not_paid" },
      ],
      payments: [
        {
          operationKey: "payment-one",
          installmentPosition: 1,
          amountCents: 400_000,
          paidAtIso: "2026-07-10T00:00:00.000Z",
          note: "Bank transfer",
          hasProof: false,
        },
      ],
    },
  };
}

function workspaceRow(input: {
  operationKey: string;
  assessment: ImportAssessmentView | null;
  materialized: boolean;
}): WorkspaceImportRow {
  const draft = newImportDraft({
    defaultCurrency: "ILS",
    defaultTaxMode: "tax_included",
    defaultTaxRatePct: 18,
  });
  draft.client.name = "Maya Levi";
  draft.client.email = "maya@example.com";
  draft.project.title = "Blue Hour EP";
  draft.agreement.name = "Full production";
  draft.agreement.service = "Production and mixing";
  draft.agreement.deliverables = ["Production"];
  draft.agreement.rights = ["Artist owns masters"];
  draft.agreement.agreementText = "The exact existing agreement terms.";
  draft.agreement.subtotal = "8000";
  draft.agreement.taxMode = "tax_included";
  draft.agreement.taxRatePct = "18";
  draft.agreement.currency = "ILS";
  draft.agreement.includedSongSpaces = "6";
  draft.agreement.planKind = "monthly";
  draft.agreement.monthlyInstallments = "2";
  draft.payments = [
    {
      operationKey: "payment-one",
      installmentPosition: 1,
      amount: "4000",
      paidAt: "2026-07-10",
      note: "Bank transfer",
      proofUploadToken: null,
      proofFileName: null,
    },
  ];
  return {
    rowId: `${input.operationKey}-row`,
    operationKey: input.operationKey,
    revision: 1,
    draft,
    assessment: input.assessment,
    materializedAtIso: input.materialized ? "2026-08-21T10:00:00.000Z" : null,
    createdClientContactId: input.materialized ? "client-created" : null,
    createdProjectId: input.materialized ? "project-created" : null,
    createdPurchaseId: input.materialized ? "purchase-created" : null,
    saveState: "idle",
    saveError: null,
    materializeError: null,
    localVersion: 0,
    persistedLocalVersion: 0,
  };
}

function reviewProps(rows: readonly WorkspaceImportRow[]) {
  return {
    rows,
    clients: [],
    archivedClients: [],
    retryableFailedOperationKeys: new Set<string>(),
    setupAttempted: false,
    loadingSetup: false,
    creating: false,
    finishing: false,
    error: null,
    selectedClientIds: new Set<string>(),
    onBack: noop,
    onCreate: noop,
    onReloadSetup: noop,
    onToggleClient: noop,
    onDone: noop,
    producerSlug: "demo",
    producerName: "Demo Studio",
    onLeaveToDashboard: noop,
  };
}

/** A Payments step draft: monthly plan, nothing recorded yet. */
function paymentDraft(firstPaymentDueAt: string): ActiveWorkImportDraft {
  const draft = newImportDraft({
    defaultCurrency: "ILS",
    defaultTaxMode: "tax_included",
    defaultTaxRatePct: 18,
  });
  draft.agreement.subtotal = "8000";
  draft.agreement.currency = "ILS";
  draft.agreement.planKind = "monthly";
  draft.agreement.monthlyInstallments = "3";
  draft.agreement.firstPaymentDueAt = firstPaymentDueAt;
  return draft;
}

const DATED_ROW = workspaceRow({
  operationKey: "dated",
  assessment: readyAssessment("2026-09-15"),
  materialized: false,
});
const UNDATED_ROW = workspaceRow({
  operationKey: "undated",
  assessment: readyAssessment(null),
  materialized: false,
});
const CREATED_ROW = workspaceRow({
  operationKey: "created",
  assessment: null,
  materialized: true,
});

const SHARED_INSTALLMENT = {
  rowId: "created-row",
  projectId: "project-created",
  purchaseId: "purchase-created",
  projectTitle: "Blue Hour EP",
  agreementName: "Full production",
  amountCents: 200_000,
  remainingCents: 200_000,
  currency: "ILS",
  status: "not_paid",
  remindersEnabled: false,
  triggeredAtIso: null,
} as const;

/** One dated payment and one that still has no date, so both groups show. */
const MIXED_SETUP: SetupOptionsView = {
  setupDigest: `sha256:${"d".repeat(64)}`,
  distinctClientCount: 1,
  projectPurchaseCount: 1,
  clients: [],
  installments: [
    {
      ...SHARED_INSTALLMENT,
      id: "installment-dated",
      position: 1,
      dueTrigger: "producer_import",
      dueAtIso: "2026-09-01T10:00:00.000Z",
      reminderEligible: true,
      reminderWaitingForDueDate: false,
    },
    {
      ...SHARED_INSTALLMENT,
      id: "installment-undated",
      position: 2,
      dueTrigger: "monthly_anniversary",
      dueAtIso: null,
      reminderEligible: true,
      reminderWaitingForDueDate: true,
    },
  ],
};

const PLAIN_SETUP: SetupOptionsView = {
  setupDigest: `sha256:${"b".repeat(64)}`,
  distinctClientCount: 1,
  projectPurchaseCount: 1,
  clients: [
    {
      id: "client-created",
      name: "Maya Levi",
      email: "maya@example.com",
      connected: false,
      providerAcceptedAtIso: null,
      invitationEligible: true,
      invitationState: "available",
    },
  ],
  installments: [
    {
      ...SHARED_INSTALLMENT,
      id: "installment-final",
      position: 2,
      dueTrigger: "producer_import",
      dueAtIso: "2026-09-01T10:00:00.000Z",
      reminderEligible: true,
      reminderWaitingForDueDate: false,
    },
  ],
};

// Copied word for word from `unfinishedImportMessage(2)` in
// active-work-import-workspace.tsx. That helper is private to the workspace and
// only a real signed-in Finish setup round trip can produce it, so the gallery
// hands the sentence to the real banner instead of reaching the server.
const UNFINISHED_BATCH_MESSAGE =
  "This import is not finished: 2 items are still saved as drafts and were never created, " +
  "so it will still be here next time. Your created work, invitations and reminders are all safe. " +
  "Go back, finish or remove those items, then press Finish setup again.";

/* ------------------------------------------------------------------ layout */

function Panel({
  index,
  title,
  changed,
  children,
}: {
  index: string;
  title: string;
  changed: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-8">
      <div className="px-4 sm:px-5">
        <h2 className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
          {index} · {title}
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          {changed}
        </p>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Review &amp; finish is a full-screen panel: fixed on phones, and a flex child
 * of the workspace column on desktop. A transform on this host makes it the
 * containing block for those fixed children, so several panels can sit on one
 * scrolling gallery page without stacking on top of each other. Its height is
 * the same `sk-native-screen` height the panel gives itself, so nothing is cut.
 */
function ScreenFrame({
  openFirstRow = false,
  children,
}: {
  openFirstRow?: boolean;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!openFirstRow || openedRef.current || !host) return undefined;
    openedRef.current = true;
    const details = host.querySelector("details");
    // The row opens on a real click, exactly as a producer opens it.
    if (details && !details.open) details.querySelector("summary")?.click();
    // Then park the frozen "First payment due" line inside the panel's own
    // scroller, so the panel can be photographed without scrolling it by hand.
    const timer = window.setTimeout(() => {
      const scroller = host.querySelector<HTMLElement>(".sk-native-scroll");
      const label = [...host.querySelectorAll("p")].find(
        (node) => node.textContent === "First payment due",
      );
      if (!scroller || !label) return;
      scroller.scrollTop +=
        label.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [openFirstRow]);

  return (
    <div
      ref={hostRef}
      className="sk-native-screen relative w-full [transform:translateZ(0)] overflow-hidden bg-[rgb(var(--bg-background))] sm:rounded-[var(--radius-lg)] sm:ring-1 sm:ring-[rgb(var(--border-subtle))] lg:flex lg:min-h-0"
    >
      {children}
    </div>
  );
}

function PaymentsStep({ dueAt, operationKey }: { dueAt: string; operationKey: string }) {
  const [draft, setDraft] = useState(() => paymentDraft(dueAt));
  return (
    <div className="px-4 sm:px-5">
      <div className="min-w-0 bg-[rgb(var(--bg-elevated))] px-4 py-4 sm:rounded-[var(--radius-lg)] sm:px-5 sm:py-5 sm:ring-1 sm:ring-[rgb(var(--border-subtle))]">
        <PaymentHistoryEditor
          draft={draft}
          operationKey={operationKey}
          proofUploads={{}}
          onChange={setDraft}
          onUploadProof={noop}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export function Sk268Preview() {
  return (
    <div className="mx-auto w-full max-w-[1100px] py-10">
      <header className="px-4 sm:px-5">
        <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-[rgb(var(--brand-primary-text))] uppercase">
          SK-268 · visual check
        </p>
        <h1 className="font-display mt-2 text-3xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
          Bring in active work
        </h1>
        <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          Each panel below is a real wizard component in the state this wave repaired, fed fixed
          fixtures. Nothing here talks to the server.
        </p>
      </header>

      <Panel
        index="1a"
        title="First payment due — empty"
        changed="The Payments step now asks one optional date. Left empty, the first payment lands on the day the work is added."
      >
        <PaymentsStep dueAt="" operationKey="empty-due-date" />
      </Panel>

      <Panel
        index="1b"
        title="First payment due — a date picked"
        changed="Before this wave the first payment was stamped with the exact import instant, so the client turned Overdue the next day. The producer now sets the real day, and monthly payments count forward from it."
      >
        <PaymentsStep dueAt="2026-09-15" operationKey="filled-due-date" />
      </Panel>

      <Panel
        index="2a"
        title="Review & finish — the date the producer picked"
        changed="The frozen details now carry a First payment due line, so the picked day is visible before anything is created."
      >
        <ScreenFrame openFirstRow>
          <ReviewAndFinish
            {...reviewProps([DATED_ROW])}
            stage="review"
            canReturnToItems
            effectiveReadyOperationKeys={new Set(["dated"])}
            setupOptions={null}
          />
        </ScreenFrame>
      </Panel>

      <Panel
        index="2b"
        title="Review & finish — no date picked"
        changed="With the date left empty the same line says plainly that the first payment lands on the day you add this."
      >
        <ScreenFrame openFirstRow>
          <ReviewAndFinish
            {...reviewProps([UNDATED_ROW])}
            stage="review"
            canReturnToItems
            effectiveReadyOperationKeys={new Set(["undated"])}
            setupOptions={null}
          />
        </ScreenFrame>
      </Panel>

      <Panel
        index="3"
        title="No date yet — reminders that cannot send"
        changed="A payment with no date is armed like every other one, but it is listed on its own so the producer is never told a reminder is live when it is only waiting."
      >
        <ScreenFrame>
          <ReviewAndFinish
            {...reviewProps([CREATED_ROW])}
            stage="setup"
            canReturnToItems={false}
            effectiveReadyOperationKeys={new Set<string>()}
            setupOptions={MIXED_SETUP}
          />
        </ScreenFrame>
      </Panel>

      <Panel
        index="4"
        title="Finish setup did not actually finish"
        changed="Finish setup used to send the producer away as if it had worked while the batch stayed open. It now stays put and names what is unfinished. The sentence is a fixture copied from the workspace, because only a signed-in server round trip can raise it."
      >
        <ScreenFrame>
          <ReviewAndFinish
            {...reviewProps([CREATED_ROW])}
            stage="setup"
            canReturnToItems={false}
            effectiveReadyOperationKeys={new Set<string>()}
            setupOptions={PLAIN_SETUP}
            error={UNFINISHED_BATCH_MESSAGE}
          />
        </ScreenFrame>
      </Panel>
    </div>
  );
}
