// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: vi.fn(),
  updateProducer: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("~/components/push/push-preferences", () => ({
  PushPreferences: () => null,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/runtime-state/use-runtime-state", () => ({
  useProducerDisplayNameDraft: () => ({ clearDraft: vi.fn() }),
}));

vi.mock("~/lib/share/public-url", () => ({
  PUBLIC_BRAND_ORIGIN: "https://skitza.app",
  buildJoinUrl: (slug: string) => `https://skitza.app/join/${slug}`,
}));

vi.mock("~/lib/pwa/install-guidance", () => ({
  markMeaningfulInstallAction: vi.fn(),
}));

vi.mock("~/components/native/use-tab-swipe", () => ({
  useTabSwipe: () => ({}),
}));

vi.mock("../actions", () => ({
  updateProducer: mocks.updateProducer,
}));

import { SettingsClient } from "../settings-client";

const STRUCTURED_BANK = [
  "Account owner: Gili Asraf",
  "Bank: Hapoalim",
  "Branch: 613",
  "Account number: 12-345678",
].join("\n");

function renderGettingPaid({
  bankTransfer = STRUCTURED_BANK,
  bitPhone = "050-111-1111",
  note = "Use the project reference.",
}: {
  bankTransfer?: string;
  bitPhone?: string;
  note?: string;
} = {}) {
  return render(
    <SettingsClient
      initialActive="int"
      initial={{
        displayName: "Studio North",
        defaultCurrency: "ILS",
        taxMode: "tax_free",
        taxRatePct: 18,
        weekStart: "sunday",
        plan: "free",
        paymentInstructions: { bankTransfer, bitPhone, note },
      }}
      identity={{
        avatarUrl: null,
        initials: "SN",
        email: "studio@example.com",
        slug: "studio-north",
      }}
      storageUsage={{
        usedBytes: 200_000_000,
        reservedBytes: 0,
        committedBytes: 200_000_000,
        availableBytes: 800_000_000,
        limitBytes: 1_000_000_000,
        warningBytes: 800_000_000,
        isAtOrAboveWarning: false,
        isFull: false,
      }}
    />,
  );
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.toast.mockReset();
  mocks.updateProducer.mockReset();
  mocks.updateProducer.mockResolvedValue({ ok: true });
  window.history.replaceState(null, "", "/dashboard/settings?section=int");
});

afterEach(() => {
  cleanup();
});

describe("producer payment instructions settings interaction", () => {
  it("shows saved details as quiet read-only fields until Edit is chosen", () => {
    const view = renderGettingPaid();
    const saved = screen.getByRole("region", { name: "Saved payment details" });

    expect(within(saved).getByText("Account owner")).toBeTruthy();
    expect(within(saved).getByText("Gili Asraf")).toBeTruthy();
    expect(within(saved).getByText("Bank")).toBeTruthy();
    expect(within(saved).getByText("Hapoalim")).toBeTruthy();
    expect(within(saved).getByText("Branch")).toBeTruthy();
    expect(within(saved).getByText("613")).toBeTruthy();
    expect(within(saved).getByText("Account number")).toBeTruthy();
    expect(within(saved).getByText("12-345678")).toBeTruthy();
    expect(screen.queryByLabelText("Account owner")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(view.container.querySelector(".s-payment-editor")?.getAttribute("data-mode")).toBe(
      "read",
    );
  });

  it("keeps a payment draft out of the global savebar, guards role switches, and Cancels locally", async () => {
    const view = renderGettingPaid();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Account owner"), {
      target: { value: "Changed owner" },
    });

    expect(
      view.container.querySelector(".s-layout")?.getAttribute("data-role-switch-unsaved"),
    ).toBe("true");
    expect(view.container.querySelector(".s-savebar")?.getAttribute("aria-hidden")).toBe("true");
    expect(
      view.container.querySelector<HTMLButtonElement>(".s-savebar .s-btn-amber")?.disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Account owner")).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Saved payment details" })).getByText("Gili Asraf"),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        view.container.querySelector(".s-layout")?.getAttribute("data-role-switch-unsaved"),
      ).toBeNull();
    });
    expect(mocks.updateProducer).not.toHaveBeenCalled();
  });

  it("keeps a local payment draft when another Settings section is opened", () => {
    renderGettingPaid();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Account owner"), {
      target: { value: "Draft owner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Getting paid" }));

    expect(screen.getByLabelText<HTMLInputElement>("Account owner").value).toBe("Draft owner");
    expect(document.querySelector(".s-layout")?.getAttribute("data-role-switch-unsaved")).toBe(
      "true",
    );
    expect(mocks.updateProducer).not.toHaveBeenCalled();
  });

  it("locally saves all payment keys and serializes the four Bank fields", async () => {
    const view = renderGettingPaid();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "700" } });
    fireEvent.change(screen.getByLabelText("Bit phone number"), {
      target: { value: "050-222-2222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save payment details" }));

    await waitFor(() => {
      expect(mocks.updateProducer).toHaveBeenCalledWith({
        paymentInstructions: {
          bankTransfer: [
            "Account owner: Gili Asraf",
            "Bank: Hapoalim",
            "Branch: 700",
            "Account number: 12-345678",
          ].join("\n"),
          bitPhone: "050-222-2222",
          note: "Use the project reference.",
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Branch")).toBeNull();
    });
    const saved = screen.getByRole("region", { name: "Saved payment details" });
    expect(within(saved).getByText("700")).toBeTruthy();
    expect(within(saved).getByText("050-222-2222")).toBeTruthy();
    expect(mocks.toast).toHaveBeenCalledWith("Payment details saved.", "success");
    await waitFor(() => {
      expect(
        view.container.querySelector(".s-layout")?.getAttribute("data-role-switch-unsaved"),
      ).toBeNull();
    });
  });

  it("writes legacy free-text Bank details back unchanged for a Bit-only edit", async () => {
    const legacyBank = "Hapoalim 613 / account 12-345678";
    renderGettingPaid({ bankTransfer: legacyBank });

    expect(screen.getAllByText(legacyBank)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Kept as-is unless you edit a bank field above.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Bit phone number"), {
      target: { value: "050-333-3333" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save payment details" }));

    await waitFor(() => {
      expect(mocks.updateProducer).toHaveBeenCalledWith({
        paymentInstructions: {
          bankTransfer: legacyBank,
          bitPhone: "050-333-3333",
          note: "Use the project reference.",
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByLabelText("Bit phone number")).toBeNull();
    });
    expect(screen.getAllByText(legacyBank)).toHaveLength(2);
  });

  it("keeps unknown legacy Bank lines when a structured Bank field changes", async () => {
    const legacyInstruction = "Use reference SKITZA when sending the transfer";
    const mixedBank = [
      "Account owner: Gili Asraf",
      "Bank: Hapoalim",
      "Branch: 613",
      "Account number: 12-345678",
      legacyInstruction,
    ].join("\n");
    renderGettingPaid({ bankTransfer: mixedBank });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "700" } });
    fireEvent.click(screen.getByRole("button", { name: "Save payment details" }));

    await waitFor(() => {
      expect(mocks.updateProducer).toHaveBeenCalledWith({
        paymentInstructions: {
          bankTransfer: [
            "Account owner: Gili Asraf",
            "Bank: Hapoalim",
            "Branch: 700",
            "Account number: 12-345678",
            legacyInstruction,
          ].join("\n"),
          bitPhone: "050-111-1111",
          note: "Use the project reference.",
        },
      });
    });
  });

  it("keeps the editor and its draft open when the local save fails", async () => {
    mocks.updateProducer.mockResolvedValueOnce({
      ok: false,
      error: "Payment details were not saved.",
    });
    renderGettingPaid();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "Leumi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save payment details" }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith("Payment details were not saved.", "error");
    });
    expect(screen.getByLabelText<HTMLInputElement>("Bank").value).toBe("Leumi");
    expect(screen.getByRole("button", { name: "Save payment details" })).toBeTruthy();
  });
});
