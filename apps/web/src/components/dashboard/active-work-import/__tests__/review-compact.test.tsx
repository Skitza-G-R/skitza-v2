// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewAndFinish } from "../review-and-finish";
import {
  IMPORT_NOTICE,
  newImportDraft,
  type ImportAssessmentView,
  type SetupOptionsView,
  type WorkspaceImportRow,
} from "../model";

function readyAssessment(): ImportAssessmentView {
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
      firstPaymentDueDate: null,
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
        {
          sequence: 2,
          amountCents: 400_000,
          trigger: "monthly_anniversary",
          status: "not_paid",
        },
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
  clientName: string;
  projectTitle: string;
  assessment: ImportAssessmentView | null;
  materialized?: boolean;
}): WorkspaceImportRow {
  const draft = newImportDraft({
    defaultCurrency: "ILS",
    defaultTaxMode: "tax_included",
    defaultTaxRatePct: 18,
  });
  draft.client.name = input.clientName;
  draft.client.email = `${input.operationKey}@example.com`;
  draft.project.title = input.projectTitle;
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
    stage: "review" as const,
    rows,
    clients: [],
    archivedClients: [],
    effectiveReadyOperationKeys: new Set(["ready"]),
    retryableFailedOperationKeys: new Set<string>(),
    canReturnToItems: true,
    setupAttempted: false,
    setupOptions: null,
    loadingSetup: false,
    creating: false,
    finishing: false,
    error: null,
    selectedClientIds: new Set<string>(),
    onBack: vi.fn(),
    onCreate: vi.fn(),
    onReloadSetup: vi.fn(),
    onToggleClient: vi.fn(),
    onDone: vi.fn(),
  };
}

afterEach(cleanup);

describe("compact active-work Review", () => {
  it("keeps original order, one expanded row, exact details, and every Needs-info reason", () => {
    const ready = workspaceRow({
      operationKey: "ready",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: readyAssessment(),
    });
    const needsInfo = workspaceRow({
      operationKey: "needs-info",
      clientName: "Noa Band",
      projectTitle: "Northbound Album",
      assessment: {
        state: "needs_info",
        reasons: [
          {
            code: "amount_invalid",
            field: "agreement.totalCents",
            message: "Add the agreed price.",
          },
          {
            code: "payment_invalid",
            field: "payments.0",
            message: "Add the real payment date.",
          },
        ],
      },
    });

    const { container } = render(<ReviewAndFinish {...reviewProps([ready, needsInfo])} />);

    const table = screen.getByRole("region", { name: "Needs info · 1" });
    const surface = screen
      .getByRole("heading", { name: "Review before creating" })
      .closest("section");
    expect(surface?.className).toContain("lg:w-full");
    expect(surface?.className).toContain("lg:h-full");
    expect(surface?.className).toContain("lg:flex-1");
    expect(surface?.className).toContain("lg:border-[rgb(var(--border-subtle))]");
    expect(surface?.className).toContain("lg:shadow-[var(--shadow-sm)]");
    expect(surface?.className.split(/\s+/)).toContain("overflow-hidden");
    expect(surface?.querySelector(".sk-native-scroll")?.className).toContain("lg:overflow-y-auto");
    expect(surface?.querySelector(".sk-native-scroll")?.className).toContain("pb-28");
    expect(table.className).toContain("rounded-[var(--radius-md)]");
    expect(table.className).toContain("border-[rgb(var(--border-subtle))]");
    expect(table.className).toContain("shadow-[var(--shadow-sm)]");
    const summaries = table.querySelectorAll("summary");
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.textContent).toContain("Maya Levi");
    expect(summaries[1]?.textContent).toContain("Noa Band");
    // Every row starts collapsed; details open only on a deliberate click.
    expect(table.querySelectorAll("details[open]")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Blue Hour EP" })).toBeNull();

    fireEvent.click(summaries[0] as HTMLElement);

    expect(table.querySelectorAll("details[open]")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Blue Hour EP" })).not.toBeNull();
    expect(screen.getByText(IMPORT_NOTICE)).not.toBeNull();
    const safety = screen.getByText("Nothing will be sent");
    expect(safety.className).toContain("min-h-6");
    const create = screen.getByRole("button", { name: "Create 1 ready item" });
    const footer = create.closest("footer");
    expect(footer?.className).toContain("lg:static");
    expect(footer?.className).toContain("gap-1.5");
    const mobileActionRow = footer?.querySelector('[data-review-action-row="compact"]');
    expect(mobileActionRow?.className).toContain("grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]");
    expect(mobileActionRow?.querySelectorAll("button")).toHaveLength(2);
    expect(
      [...(mobileActionRow?.querySelectorAll("button") ?? [])].filter((button) =>
        button.className.includes("bg-[rgb(var(--brand-primary))]"),
      ),
    ).toHaveLength(1);
    expect(table.querySelector('[data-review-ready-details="dense"]')).not.toBeNull();
    expect(screen.getByText("Silent creation checkpoint").className).toContain(
      "text-[rgb(var(--fg-muted))]",
    );
    expect(screen.getByText("Total").className).toContain("text-[9.5px]");
    expect(container.innerHTML).not.toMatch(/text-\[(?:8|8\.5)px\]/);
    expect(container.innerHTML).not.toContain("brand-primary-text");
    expect(container.innerHTML).not.toContain("font-syne");
    expect(container.innerHTML).not.toContain("shadow-[0_");

    fireEvent.click(summaries[1] as HTMLElement);

    expect(table.querySelectorAll("details[open]")).toHaveLength(1);
    const needsArticle = within(table).getByRole("article", { name: "Item 2 needs info" });
    expect(within(needsArticle).getAllByText("Add the agreed price.")).toHaveLength(2);
    expect(within(needsArticle).getByText("Add the real payment date.")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Blue Hour EP" })).toBeNull();

    // Clicking the open row closes it again.
    fireEvent.click(summaries[1] as HTMLElement);
    expect(table.querySelectorAll("details[open]")).toHaveLength(0);
  });

  it("lists the attached agreement PDF in the frozen details", () => {
    const base = readyAssessment();
    if (base.state !== "ready") throw new Error("Expected a ready assessment");
    const ready = workspaceRow({
      operationKey: "ready",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: {
        ...base,
        normalized: {
          ...base.normalized,
          agreementPdf: { fileName: "deal.pdf", sizeBytes: 2_048 },
        },
      },
    });
    render(<ReviewAndFinish {...reviewProps([ready])} />);
    const summary = screen.getByRole("region", { name: "Review items" }).querySelector("summary");
    if (!summary) throw new Error("Expected the compact Review summary");
    fireEvent.click(summary);

    const details = document.querySelector<HTMLElement>('[data-review-ready-details="dense"]');
    if (!details) throw new Error("Expected dense Ready details");
    expect(within(details).getByText("Agreement PDF")).not.toBeNull();
    expect(
      within(details).getByText("deal.pdf · 2.0 KB · frozen with this agreement"),
    ).not.toBeNull();
  });

  // SK-270: the producer must be able to SEE the first payment date they
  // picked before they finish, and see plainly when they left it empty.
  it("shows the captured first payment due date in the Ready details", () => {
    const base = readyAssessment();
    if (base.state !== "ready") throw new Error("Expected a ready assessment");
    const ready = workspaceRow({
      operationKey: "ready",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: {
        ...base,
        normalized: { ...base.normalized, firstPaymentDueDate: "2026-09-15" },
      },
    });
    render(<ReviewAndFinish {...reviewProps([ready])} />);
    const summary = screen.getByRole("region", { name: "Review items" }).querySelector("summary");
    if (!summary) throw new Error("Expected the compact Review summary");
    fireEvent.click(summary);

    const details = document.querySelector<HTMLElement>('[data-review-ready-details="dense"]');
    if (!details) throw new Error("Expected dense Ready details");
    expect(within(details).getByText("First payment due")).not.toBeNull();
    expect(within(details).getByText("Sep 15, 2026")).not.toBeNull();
  });

  it("says the first payment lands on the import day when no date was captured", () => {
    const base = readyAssessment();
    if (base.state !== "ready") throw new Error("Expected a ready assessment");
    const ready = workspaceRow({
      operationKey: "ready",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: base,
    });
    render(<ReviewAndFinish {...reviewProps([ready])} />);
    const summary = screen.getByRole("region", { name: "Review items" }).querySelector("summary");
    if (!summary) throw new Error("Expected the compact Review summary");
    fireEvent.click(summary);

    const details = document.querySelector<HTMLElement>('[data-review-ready-details="dense"]');
    if (!details) throw new Error("Expected dense Ready details");
    expect(within(details).getByText("The day you add this")).not.toBeNull();
  });

  it("explains the wait while ready items are being created", () => {
    const ready = workspaceRow({
      operationKey: "ready",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: readyAssessment(),
    });
    render(<ReviewAndFinish {...reviewProps([ready])} creating />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Creating 1 item");
    expect(status.textContent).toContain("can take a few seconds");
    expect(screen.queryByText("Nothing will be sent")).toBeNull();
    const creating = screen.getByRole("button", { name: "Creating…" });
    expect((creating as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports remaining and overpaid money per installment in the summary", () => {
    const base = readyAssessment();
    if (base.state !== "ready") throw new Error("Expected a ready assessment");
    const ready = workspaceRow({
      operationKey: "ready",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: {
        ...base,
        normalized: {
          ...base.normalized,
          payments: [
            {
              operationKey: "payment-one",
              installmentPosition: 1,
              amountCents: 500_000,
              paidAtIso: "2026-07-10T00:00:00.000Z",
              note: null,
              hasProof: false,
            },
          ],
        },
      },
    });
    ready.draft.payments = ready.draft.payments.map((payment) => ({ ...payment, amount: "5000" }));
    const draftOnly = workspaceRow({
      operationKey: "needs-info",
      clientName: "Noa Band",
      projectTitle: "Northbound Album",
      assessment: null,
    });
    draftOnly.draft.payments = draftOnly.draft.payments.map((payment) => ({
      ...payment,
      amount: "5000",
    }));

    render(<ReviewAndFinish {...reviewProps([ready, draftOnly])} />);

    const summaries = screen
      .getByRole("region", { name: "Needs info · 1" })
      .querySelectorAll("summary");
    expect(summaries[0]?.textContent).toContain("₪5,000 paid");
    expect(summaries[0]?.textContent).toContain("₪4,000 remaining");
    expect(summaries[0]?.textContent).toContain("₪1,000 overpaid");
    expect(summaries[1]?.textContent).toContain("₪4,000 remaining");
    expect(summaries[1]?.textContent).toContain("₪1,000 overpaid");
  });

  it("wraps long mobile Client, Project, email, and agreement facts", () => {
    const longClient = "The International Artist Collective With A Very Long Client Name";
    const longProject = "An Exceptionally Long Album Project Title That Must Stay Fully Readable";
    const longEmail =
      "artist-with-an-extremely-long-address-that-must-wrap@very-long-example-domain.test";
    const longAgreement =
      "Worldwide production, arrangement, mixing, mastering, and delivery coordination";
    const baseAssessment = readyAssessment();
    if (baseAssessment.state !== "ready") throw new Error("Expected a Ready assessment");
    const row = workspaceRow({
      operationKey: "ready",
      clientName: longClient,
      projectTitle: longProject,
      assessment: {
        ...baseAssessment,
        normalized: {
          ...baseAssessment.normalized,
          clientName: longClient,
          clientEmail: longEmail,
          projectTitle: longProject,
          commercialSnapshot: {
            ...baseAssessment.normalized.commercialSnapshot,
            service: longAgreement,
          },
        },
      },
    });

    render(<ReviewAndFinish {...reviewProps([row])} />);

    const summary = screen.getByRole("region", { name: "Review items" }).querySelector("summary");
    if (!summary) throw new Error("Expected the compact Review summary");
    const clientCopy = within(summary).getByText(longClient);
    const projectCopy = within(summary).getByText(longProject);
    expect(clientCopy.className.split(/\s+/)).not.toContain("truncate");
    expect(clientCopy.className).toContain("[overflow-wrap:anywhere]");
    expect(projectCopy.className.split(/\s+/)).not.toContain("truncate");
    expect(projectCopy.className).toContain("[overflow-wrap:anywhere]");

    fireEvent.click(summary);
    const denseDetails = document.querySelector<HTMLElement>('[data-review-ready-details="dense"]');
    if (!denseDetails) throw new Error("Expected dense Ready details");
    expect(within(denseDetails).getByText(`${longClient} · ${longEmail}`).className).toContain(
      "[overflow-wrap:anywhere]",
    );
    expect(within(denseDetails).getByText(longAgreement).className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });
});

describe("compact active-work setup", () => {
  it("keeps invitations optional and reminders mandatory/read-only through one Finish action", () => {
    const created = workspaceRow({
      operationKey: "created",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: null,
      materialized: true,
    });
    const setupOptions: SetupOptionsView = {
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
          id: "installment-final",
          rowId: "created-row",
          projectId: "project-created",
          purchaseId: "purchase-created",
          projectTitle: "Blue Hour EP",
          agreementName: "Full production",
          position: 2,
          amountCents: 400_000,
          remainingCents: 400_000,
          currency: "ILS",
          dueTrigger: "artist_approval",
          dueAtIso: "2026-09-01T10:00:00.000Z",
          triggeredAtIso: "2026-09-01T10:00:00.000Z",
          status: "pending",
          remindersEnabled: false,
          reminderEligible: true,
          reminderWaitingForDueDate: false,
        },
      ],
    };
    const onDone = vi.fn();

    render(
      <ReviewAndFinish
        {...reviewProps([created])}
        stage="setup"
        canReturnToItems={false}
        setupOptions={setupOptions}
        effectiveReadyOperationKeys={new Set()}
        onDone={onDone}
      />,
    );

    expect(screen.getByText(/1 client · 1 project and agreement added/)).not.toBeNull();
    expect(
      screen.getByText(
        "Creating these items contacted nobody. Your imported work is ready in Skitza.",
      ),
    ).not.toBeNull();
    const invitation = screen.getByRole("checkbox", { name: /Maya Levi/ });
    expect((invitation as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("checkbox", { name: /Blue Hour EP/ })).toBeNull();
    expect(screen.getByText("Will turn on")).not.toBeNull();
    expect(
      screen.getByText("Reminder delivery waits for Artist approval. It will not send early."),
    ).not.toBeNull();
    const finish = screen.getByRole("button", { name: "Finish setup" });
    expect(finish).not.toBeNull();
    const setupSurface = screen.getByRole("heading", { name: "Finish setup" }).closest("section");
    expect(setupSurface?.className).toContain("lg:w-full");
    expect(setupSurface?.className).toContain("lg:h-full");
    const setupContent = setupSurface?.querySelector("[data-setup-content]");
    expect(setupContent?.className).toContain("mx-auto");
    expect(setupContent?.className).toContain("w-full");
    expect(setupContent?.className).toContain("max-w-4xl");
    const setupActionRow = finish.closest("footer")?.querySelector("[data-review-action-row]");
    expect(setupActionRow).toBeNull();
    expect(finish.closest("footer")?.querySelectorAll("button")).toHaveLength(1);
    expect(finish.className).toContain("bg-[rgb(var(--brand-primary))]");
    fireEvent.click(finish);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("promises reminders only for eligible unpaid payments and wraps long setup copy", () => {
    const longClient = "The Very Long International Artist Collective Client Name";
    const longEmail = "provider-accepted-artist-with-a-long-address@very-long-example-domain.test";
    const longProject =
      "A Long Imported Project Title With Enough Detail To Wrap On A Narrow Mobile Screen";
    const longAgreement =
      "A detailed existing agreement name covering production, mixing, mastering, and delivery";
    const ineligibleProject = "Canceled imported project that must not promise a reminder";
    const created = workspaceRow({
      operationKey: "created",
      clientName: longClient,
      projectTitle: longProject,
      assessment: null,
      materialized: true,
    });
    const setupOptions: SetupOptionsView = {
      setupDigest: `sha256:${"c".repeat(64)}`,
      distinctClientCount: 1,
      projectPurchaseCount: 2,
      clients: [
        {
          id: "client-created",
          name: longClient,
          email: longEmail,
          connected: false,
          providerAcceptedAtIso: "2026-08-01T10:00:00.000Z",
          invitationEligible: false,
          invitationState: "provider_accepted",
        },
      ],
      installments: [
        {
          id: "installment-eligible",
          rowId: "created-row",
          projectId: "project-created",
          purchaseId: "purchase-created",
          projectTitle: longProject,
          agreementName: longAgreement,
          position: 2,
          amountCents: 400_000,
          remainingCents: 400_000,
          currency: "ILS",
          dueTrigger: "artist_approval",
          dueAtIso: "2026-09-01T10:00:00.000Z",
          triggeredAtIso: "2026-09-01T10:00:00.000Z",
          status: "pending",
          remindersEnabled: false,
          reminderEligible: true,
          reminderWaitingForDueDate: false,
        },
        {
          id: "installment-ineligible",
          rowId: "created-row",
          projectId: "project-canceled",
          purchaseId: "purchase-canceled",
          projectTitle: ineligibleProject,
          agreementName: "Canceled agreement",
          position: 1,
          amountCents: 100_000,
          remainingCents: 100_000,
          currency: "ILS",
          dueTrigger: "producer_import",
          dueAtIso: null,
          triggeredAtIso: null,
          status: "canceled",
          remindersEnabled: false,
          reminderEligible: false,
          reminderWaitingForDueDate: false,
        },
      ],
    };

    render(
      <ReviewAndFinish
        {...reviewProps([created])}
        stage="setup"
        canReturnToItems={false}
        setupOptions={setupOptions}
        effectiveReadyOperationKeys={new Set()}
      />,
    );

    expect(
      screen.getByText(
        "Creating these items contacted nobody. Your imported work is ready in Skitza.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText(/Nothing was sent/)).toBeNull();
    expect(screen.getAllByText("Will turn on")).toHaveLength(1);
    expect(screen.queryByText(ineligibleProject)).toBeNull();

    const clientCopy = screen.getByText(longClient);
    const emailCopy = screen.getByText(longEmail);
    const reminderCopy = screen.getByText(`${longProject} · payment 2`);
    expect(clientCopy.className.split(/\s+/)).not.toContain("truncate");
    expect(clientCopy.className).toContain("[overflow-wrap:anywhere]");
    expect(emailCopy.className.split(/\s+/)).not.toContain("truncate");
    expect(emailCopy.className).toContain("[overflow-wrap:anywhere]");
    expect(reminderCopy.className.split(/\s+/)).not.toContain("truncate");
    expect(reminderCopy.className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText((text) => text.endsWith(longAgreement)).className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });

  // A payment with no date can never produce a reminder, so it must not sit in
  // the armed list. It also must not vanish without a word.
  it("says plainly that a payment with no date has no reminder yet", () => {
    const created = workspaceRow({
      operationKey: "created",
      clientName: "Maya Levi",
      projectTitle: "Blue Hour EP",
      assessment: null,
      materialized: true,
    });
    const installment = {
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
    const setupOptions: SetupOptionsView = {
      setupDigest: `sha256:${"d".repeat(64)}`,
      distinctClientCount: 1,
      projectPurchaseCount: 1,
      clients: [],
      installments: [
        {
          ...installment,
          id: "installment-dated",
          position: 1,
          dueTrigger: "producer_import",
          dueAtIso: "2026-09-01T10:00:00.000Z",
          reminderEligible: true,
          reminderWaitingForDueDate: false,
        },
        {
          ...installment,
          id: "installment-undated",
          position: 2,
          dueTrigger: "monthly_anniversary",
          dueAtIso: null,
          // Armed like every other unpaid instalment — the server only marks it
          // as waiting, which is what keeps it out of the "Will turn on" list.
          reminderEligible: true,
          reminderWaitingForDueDate: true,
        },
      ],
    };

    render(
      <ReviewAndFinish
        {...reviewProps([created])}
        stage="setup"
        canReturnToItems={false}
        setupOptions={setupOptions}
        effectiveReadyOperationKeys={new Set()}
      />,
    );

    expect(screen.getAllByText("Will turn on")).toHaveLength(1);
    expect(screen.getByText("Blue Hour EP · payment 1")).not.toBeNull();
    expect(screen.getByText("Blue Hour EP · payment 2")).not.toBeNull();
    expect(screen.getByText("No date yet")).not.toBeNull();
    expect(
      screen.getByText(
        "One payment below has no date yet. Its reminder is turned on, but nothing can be sent until the payment has a date.",
      ),
    ).not.toBeNull();
  });
});
