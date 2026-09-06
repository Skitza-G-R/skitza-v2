// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { newImportDraft, type ActiveWorkImportDraft } from "../model";
import { PaymentHistoryEditor, type ProofUploadView } from "../payment-history-editor";

let scrollIntoView = vi.fn();

function paymentDraft(
  planKind: ActiveWorkImportDraft["agreement"]["planKind"] = "monthly",
): ActiveWorkImportDraft {
  const draft = newImportDraft({
    defaultCurrency: "USD",
    defaultTaxMode: "tax_free",
    defaultTaxRatePct: 0,
  });
  draft.agreement.subtotal = "1000.00";
  draft.agreement.currency = "USD";
  draft.agreement.planKind = planKind;
  draft.agreement.monthlyInstallments = "2";
  return draft;
}

function Harness({
  initialDraft,
  proofUploads = {},
  onUploadProof = vi.fn(),
  onEditingChange,
}: {
  initialDraft: ActiveWorkImportDraft;
  proofUploads?: Readonly<Record<string, ProofUploadView>>;
  onUploadProof?: (paymentOperationKey: string, file: File) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <>
      <PaymentHistoryEditor
        draft={draft}
        operationKey="row-payment-test"
        proofUploads={proofUploads}
        onChange={setDraft}
        onUploadProof={onUploadProof}
        {...(onEditingChange ? { onEditingChange } : {})}
      />
      <output data-testid="payment-draft">{JSON.stringify(draft)}</output>
    </>
  );
}

function currentDraft(): ActiveWorkImportDraft {
  return JSON.parse(screen.getByTestId("payment-draft").textContent) as ActiveWorkImportDraft;
}

function inputNamed(name: string): HTMLInputElement {
  const input = screen.getByLabelText(name);
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`Expected ${name} to label an input`);
  }
  return input;
}

function textareaNamed(name: RegExp): HTMLTextAreaElement {
  const textarea = screen.getByLabelText(name);
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new TypeError(`Expected ${name.source} to label a textarea`);
  }
  return textarea;
}

function installmentRows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Installment schedule" })).getAllByRole(
    "listitem",
  );
}

async function openFirstPayment(user: ReturnType<typeof userEvent.setup>) {
  const first = installmentRows()[0];
  if (!first) throw new Error("Expected Payment 1");
  await user.click(within(first).getByRole("button", { name: "Add payment" }));
  return screen.getByRole("group", { name: "Edit Payment 1" });
}

beforeEach(() => {
  scrollIntoView = vi.fn();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("compact active-work payment history", () => {
  // SK-308: the plan is three cards with a split picture (one block, two
  // halves, N blocks) so the choice reads without English; the money summary
  // keeps its three metrics and gains a thin paid-progress bar.
  it("shows the payment plan as three split cards and the Total, Paid, Remaining summary with a progress bar", async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft()} />);

    const plan = screen.getByRole("group", { name: "Agreed payment plan" });
    const cards = within(plan).getAllByRole("button");
    expect(cards.map((card) => card.textContent.trim())).toEqual(["Full", "50/50", "Monthly"]);
    expect(cards.map((card) => card.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(
      cards.map((card) => card.querySelectorAll("[data-plan-split] > *").length),
    ).toEqual([1, 2, 2]);
    for (const card of cards) {
      expect(card.className).toContain("min-h-11");
      expect(card.className).not.toContain("border-strong");
      expect(card.className).not.toContain("rounded-full");
    }
    expect(cards[0]?.className).toContain("border-subtle");
    expect(cards[2]?.className).toContain("border-[rgb(var(--brand-primary))]");
    const monthlyControls = screen.getByRole("group", {
      name: "Monthly payment count controls",
    });
    expect(monthlyControls.className).toContain("border-subtle");
    expect(monthlyControls.className).not.toContain("border-strong");
    await user.click(screen.getByRole("button", { name: "Use one more monthly payment" }));
    expect(cards[2]?.querySelectorAll("[data-plan-split] > *")).toHaveLength(3);

    const summary = document.querySelector("[data-payment-summary]");
    const metrics = document.querySelector("[data-payment-summary-metrics]");
    expect(summary).not.toBeNull();
    expect(metrics?.classList.contains("grid-cols-3")).toBe(true);
    expect(metrics?.children).toHaveLength(3);
    expect(within(summary as HTMLElement).getByText("Total")).not.toBeNull();
    expect(within(summary as HTMLElement).getByText("Paid")).not.toBeNull();
    expect(within(summary as HTMLElement).getByText("Remaining")).not.toBeNull();
    const progress = within(summary as HTMLElement).getByRole("progressbar", {
      name: "Paid so far",
    });
    expect(progress.getAttribute("aria-valuenow")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
  });

  it("numbers each installment with a mono badge and shows an icon status chip", () => {
    const draft = paymentDraft("split_50_50");
    draft.payments = [
      {
        operationKey: "half-of-first",
        installmentPosition: 1,
        amount: "250.00",
        paidAt: "2020-01-02",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    ];
    render(<Harness initialDraft={draft} />);

    const [first, second] = installmentRows();
    if (!first || !second) throw new Error("Expected two installment rows");
    const badge = within(first).getByText("01");
    expect(badge.className).toContain("font-mono");
    expect(within(second).getByText("02").className).toContain("font-mono");
    const partial = first.querySelector("[data-installment-state]");
    expect(partial?.getAttribute("data-installment-state")).toBe("Partial");
    expect(partial?.textContent).toContain("Partial");
    expect(partial?.querySelector("svg")).not.toBeNull();
    expect(partial?.className).toContain("fg-warning");
    const locked = second.querySelector("[data-installment-state]");
    expect(locked?.getAttribute("data-installment-state")).toBe("Locked");
    expect(locked?.querySelector("svg")).not.toBeNull();
    const progress = screen.getByRole("progressbar", { name: "Paid so far" });
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByLabelText(/First payment due/)).not.toBeNull();
    expect(screen.queryByLabelText(/When is the first payment due/)).toBeNull();
  });

  it("reports editor hierarchy changes and leaves mustard to Save payment", async () => {
    const onEditingChange = vi.fn<(editing: boolean) => void>();
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft()} onEditingChange={onEditingChange} />);

    expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([false]);
    const first = installmentRows()[0];
    if (!first) throw new Error("Expected Payment 1");
    const record = within(first).getByRole("button", { name: "Add payment" });
    expect(record.className).not.toContain("brand-primary-text");
    await user.click(record);

    expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([false, true]);
    const amount = screen.getByLabelText("Amount received");
    const date = screen.getByLabelText("Date received");
    expect(amount.className).toContain("border-subtle");
    expect(amount.className).not.toContain("border-strong");
    expect(date.className).toContain("border-subtle");
    expect(date.className).not.toContain("border-strong");
    const save = screen.getByRole("button", { name: "Save payment" });
    expect(save.classList.contains("bg-[rgb(var(--brand-primary))]")).toBe(true);
    expect(screen.getByRole("button", { name: "Add note" }).className).not.toContain(
      "brand-primary-text",
    );
    expect(screen.queryByRole("button", { name: "Add proof" })).toBeNull();
    expect(screen.getByText("Drop proof of payment here").closest("label")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Full" }));
    expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([false, true, false]);
  });

  it("shows one proof drop box under the payment line that accepts a drop or a click", async () => {
    const onUploadProof = vi.fn<(paymentOperationKey: string, file: File) => void>();
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft()} onUploadProof={onUploadProof} />);

    const editor = await openFirstPayment(user);
    const zone = within(editor).getByText("Drop proof of payment here").closest("label");
    if (!zone) throw new Error("Expected the proof drop zone");
    expect(within(editor).queryByRole("button", { name: "Add proof" })).toBeNull();
    expect(within(zone).getByText("or click to choose a file")).not.toBeNull();
    expect(zone.className).toContain("border-dashed");
    const fileInput = zone.querySelector("input[type=file]");
    if (!(fileInput instanceof HTMLInputElement)) throw new Error("Expected a file input");

    const dropped = new File(["%PDF-1.4"], "receipt.pdf", { type: "application/pdf" });
    fireEvent.drop(zone, { dataTransfer: { files: [dropped] } });
    expect(onUploadProof).toHaveBeenCalledWith(expect.any(String), dropped);
    expect(currentDraft().payments[0]?.proofFileName).toBe("receipt.pdf");

    const picked = new File(["img"], "receipt.png", { type: "image/png" });
    await user.upload(fileInput, picked);
    expect(onUploadProof).toHaveBeenLastCalledWith(expect.any(String), picked);
    expect(onUploadProof.mock.calls[0]?.[0]).toBe(onUploadProof.mock.calls[1]?.[0]);
  });

  it("reports an initial incomplete editor and clears editing state on unmount", () => {
    const draft = paymentDraft();
    draft.payments = [
      {
        operationKey: "initial-incomplete",
        installmentPosition: 1,
        amount: "500.00",
        paidAt: "",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    ];
    const onEditingChange = vi.fn<(editing: boolean) => void>();
    const { unmount } = render(<Harness initialDraft={draft} onEditingChange={onEditingChange} />);

    expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([true]);
    unmount();
    expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([true, false]);
  });

  it("fully records Payment 1, then opens, scrolls to, and focuses Payment 2 without persisting a blank payment", async () => {
    const onEditingChange = vi.fn<(editing: boolean) => void>();
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft()} onEditingChange={onEditingChange} />);

    await openFirstPayment(user);
    expect(inputNamed("Amount received").value).toBe("500.00");
    expect(inputNamed("Date received").value).toBe("");
    fireEvent.change(screen.getByLabelText("Date received"), {
      target: { value: "2020-01-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save payment" }));

    expect(await screen.findByRole("group", { name: "Edit Payment 2" })).not.toBeNull();
    expect(document.querySelectorAll("[data-payment-inline-editor]")).toHaveLength(1);
    const nextAmount = inputNamed("Amount received");
    expect(nextAmount.value).toBe("500.00");
    expect(inputNamed("Date received").value).toBe("");
    await waitFor(() => {
      expect(document.activeElement).toBe(nextAmount);
    });
    const editorActions = document.querySelector("[data-payment-editor-actions]");
    expect(editorActions).not.toBeNull();
    expect(editorActions?.classList.contains("scroll-mb-6")).toBe(true);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      behavior: "smooth",
    });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(editorActions);
    expect(onEditingChange.mock.calls.map(([editing]) => editing)).toEqual([false, true]);
    expect(screen.getByText("Payment 1 saved. Payment 2 is ready.")).not.toBeNull();
    expect(currentDraft().payments).toHaveLength(1);
    expect(currentDraft().payments[0]).toMatchObject({
      installmentPosition: 1,
      amount: "500.00",
      paidAt: "2020-01-02",
    });
  });

  it.each([
    ["missing", ""],
    ["invalid", "2026-02-31"],
    ["future", "2099-01-01"],
  ])(
    "keeps a monetarily covered Payment 1 with a %s date as the only Continue target",
    async (_dateCase, paidAt) => {
      const draft = paymentDraft();
      draft.payments = [
        {
          operationKey: "complete-payment-two",
          installmentPosition: 2,
          amount: "500.00",
          paidAt: "2020-01-03",
          note: "",
          proofUploadToken: null,
          proofFileName: null,
        },
        {
          operationKey: "incomplete-payment-one",
          installmentPosition: 1,
          amount: "500.00",
          paidAt,
          note: "",
          proofUploadToken: null,
          proofFileName: null,
        },
      ];
      const user = userEvent.setup();
      render(<Harness initialDraft={draft} />);

      expect(screen.getByRole("group", { name: "Edit Payment 1" })).not.toBeNull();
      expect(screen.getByText("Needs info")).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "Close" }));

      const [first, second] = installmentRows();
      if (!first || !second) throw new Error("Expected two installment rows");
      expect(within(first).getByRole("button", { name: "Continue" })).not.toBeNull();
      expect(within(second).getByRole("button", { name: "Waiting" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByRole("button", { name: "Continue Payment 1" })).not.toBeNull();

      await user.click(within(first).getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Save payment" }));

      const date = inputNamed("Date received");
      expect(date.getAttribute("aria-invalid")).toBe("true");
      const errorId = date.getAttribute("aria-describedby");
      expect(errorId).toBe("import-payment-error-incomplete-payment-one");
      expect(document.getElementById(errorId ?? "")?.textContent).toContain(
        "Add the real date received",
      );
      expect(inputNamed("Amount received").getAttribute("aria-invalid")).toBeNull();
      expect(screen.queryByRole("group", { name: "Edit Payment 2" })).toBeNull();
    },
  );

  it("links an invalid amount to its inline error without marking the date invalid", async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft()} />);

    await openFirstPayment(user);
    await user.clear(inputNamed("Amount received"));
    fireEvent.change(inputNamed("Date received"), {
      target: { value: "2020-01-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save payment" }));

    const amount = inputNamed("Amount received");
    expect(amount.getAttribute("aria-invalid")).toBe("true");
    const errorId = amount.getAttribute("aria-describedby");
    expect(errorId).not.toBeNull();
    expect(document.getElementById(errorId ?? "")?.textContent).toBe(
      "Add the real amount received.",
    );
    expect(inputNamed("Date received").getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps a partial Payment 1 on Payment 1 and prefills only its remaining amount", async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft()} />);

    await openFirstPayment(user);
    const amount = screen.getByLabelText("Amount received");
    await user.clear(amount);
    await user.type(amount, "200");
    fireEvent.change(screen.getByLabelText("Date received"), {
      target: { value: "2020-01-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save payment" }));

    expect(await screen.findByRole("group", { name: "Edit Payment 1" })).not.toBeNull();
    expect(document.querySelectorAll("[data-payment-inline-editor]")).toHaveLength(1);
    const remaining = inputNamed("Amount received");
    expect(remaining.value).toBe("300.00");
    expect(inputNamed("Date received").value).toBe("");
    await waitFor(() => {
      expect(document.activeElement).toBe(remaining);
    });
    expect(screen.getByText("Payment 1 saved. Add the remaining $300.")).not.toBeNull();
    expect(currentDraft().payments).toHaveLength(1);
    expect(currentDraft().payments[0]).toMatchObject({
      installmentPosition: 1,
      amount: "200",
    });
  });

  it("has no next installment for Full and never guesses its payment date", async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft("full")} />);

    await openFirstPayment(user);
    expect(inputNamed("Date received").value).toBe("");
    fireEvent.change(screen.getByLabelText("Date received"), {
      target: { value: "2020-01-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save payment" }));

    expect(screen.queryByLabelText("Amount received")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add another payment" })).toBeNull();
    expect(screen.getByText("Payment 1 saved.")).not.toBeNull();
    expect(currentDraft().payments).toHaveLength(1);
  });

  it("keeps the final 50/50 installment read-only behind Artist approval", async () => {
    const user = userEvent.setup();
    render(<Harness initialDraft={paymentDraft("split_50_50")} />);

    const finalRow = installmentRows()[1];
    if (!finalRow) throw new Error("Expected final 50/50 payment");
    expect(within(finalRow).getByText("Locked")).not.toBeNull();
    expect(within(finalRow).getByText("Final 50% starts after Artist approval.")).not.toBeNull();
    expect(within(finalRow).queryByRole("button")).toBeNull();

    await openFirstPayment(user);
    fireEvent.change(screen.getByLabelText("Date received"), {
      target: { value: "2020-01-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save payment" }));

    expect(screen.queryByRole("group", { name: /Edit Payment/ })).toBeNull();
    expect(screen.getByText(/Final 50% stays locked until Artist approval/)).not.toBeNull();
    expect(currentDraft().payments).toHaveLength(1);
  });

  it("warns before a plan change with history and preserves every payment position", async () => {
    const draft = paymentDraft();
    draft.payments = [
      {
        operationKey: "history-one",
        installmentPosition: 1,
        amount: "100.00",
        paidAt: "2020-01-02",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    ];
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<Harness initialDraft={draft} />);

    await user.click(screen.getByRole("button", { name: "Full" }));
    expect(currentDraft().agreement.planKind).toBe("monthly");
    expect(currentDraft().payments).toEqual(draft.payments);

    await user.click(screen.getByRole("button", { name: "Full" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(currentDraft().agreement.planKind).toBe("full");
    expect(currentDraft().payments).toEqual(draft.payments);
    expect(
      screen.getByText(
        "Payment history was kept on its original installments. Review any Needs info before finishing.",
      ),
    ).not.toBeNull();
  });

  it("keeps optional note and proof compact, then restores persisted values when editing", async () => {
    const draft = paymentDraft("full");
    draft.payments = [
      {
        operationKey: "history-proof",
        installmentPosition: 1,
        amount: "1000.00",
        paidAt: "2020-01-02",
        note: "Bank transfer reference 42",
        proofUploadToken: "private-proof-capability",
        proofFileName: "receipt.pdf",
      },
    ];
    const user = userEvent.setup();
    render(<Harness initialDraft={draft} />);

    expect(screen.queryByLabelText(/Note/)).toBeNull();
    expect(screen.queryByText("receipt.pdf")).toBeNull();
    const first = installmentRows()[0];
    if (!first) throw new Error("Expected Payment 1");
    await user.click(within(first).getByRole("button", { name: "Edit" }));

    expect(textareaNamed(/Note/).value).toBe("Bank transfer reference 42");
    expect(screen.getByText("receipt.pdf")).not.toBeNull();
    expect(screen.getByTitle("receipt.pdf").textContent).toContain("Private");
    expect(screen.getByRole("button", { name: "Remove proof" })).not.toBeNull();
    expect(document.querySelectorAll("[data-payment-inline-editor]")).toHaveLength(1);
  });

  it("keeps the second half remaining when the first half of a 50/50 is overpaid", () => {
    const draft = paymentDraft("split_50_50");
    draft.payments = [
      {
        operationKey: "history-first-half",
        installmentPosition: 1,
        amount: "700.00",
        paidAt: "2020-01-02",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    ];
    render(<Harness initialDraft={draft} />);

    const summary = screen.getByText("Remaining").parentElement;
    expect(summary?.textContent).toContain("$500");
    expect(screen.getByText("Paid").parentElement?.textContent).toContain("$700");
    expect(screen.getByText(/This purchase is overpaid by \$200/)).not.toBeNull();
    const [first, second] = installmentRows();
    expect(first?.textContent).toContain("Overpaid");
    expect(second?.textContent).toContain("Locked");
  });

  it("shows overpayment clearly and does not create another installment", () => {
    const draft = paymentDraft("full");
    draft.payments = [
      {
        operationKey: "history-overpaid",
        installmentPosition: 1,
        amount: "1200.00",
        paidAt: "2020-01-02",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    ];
    render(<Harness initialDraft={draft} />);

    expect(screen.getByText("Overpaid")).not.toBeNull();
    expect(screen.getByText(/This purchase is overpaid by \$200/)).not.toBeNull();
    expect(screen.getByText(/The excess stays on this purchase/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add another payment" })).toBeNull();
  });
});
