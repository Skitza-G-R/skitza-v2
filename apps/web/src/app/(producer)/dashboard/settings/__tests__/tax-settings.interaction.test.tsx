// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderRegion({
  taxMode = "tax_free",
  taxRatePct = 18,
}: {
  taxMode?: "tax_free" | "tax_included" | "tax_added";
  taxRatePct?: number;
} = {}) {
  return render(
    <SettingsClient
      initialActive="region"
      initial={{
        displayName: "Studio North",
        defaultCurrency: "USD",
        taxMode,
        taxRatePct,
        weekStart: "sunday",
        plan: "free",
        paymentInstructions: {
          bankTransfer: "",
          bitPhone: "",
          note: "",
        },
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
  window.history.replaceState(null, "", "/dashboard/settings?section=region");
});

afterEach(() => {
  cleanup();
});

describe("studio tax settings interaction", () => {
  it("shows the rate only when the selected treatment uses one", () => {
    renderRegion();

    expect(screen.queryByLabelText("Tax rate")).toBeNull();

    fireEvent.change(screen.getByLabelText("Tax treatment"), {
      target: { value: "tax_included" },
    });
    expect(screen.getByLabelText<HTMLInputElement>("Tax rate").value).toBe("18");

    fireEvent.change(screen.getByLabelText("Tax treatment"), {
      target: { value: "tax_free" },
    });
    expect(screen.queryByLabelText("Tax rate")).toBeNull();
  });

  it("saves only the changed tax treatment and rate", async () => {
    renderRegion();

    fireEvent.change(screen.getByLabelText("Tax treatment"), {
      target: { value: "tax_added" },
    });
    fireEvent.change(screen.getByLabelText("Tax rate"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mocks.updateProducer).toHaveBeenCalledWith({
        taxMode: "tax_added",
        taxRatePct: 20,
      });
    });
  });

  it("restores the saved tax values when changes are discarded", () => {
    renderRegion({ taxMode: "tax_included", taxRatePct: 18 });

    fireEvent.change(screen.getByLabelText("Tax treatment"), {
      target: { value: "tax_added" },
    });
    fireEvent.change(screen.getByLabelText("Tax rate"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByLabelText<HTMLSelectElement>("Tax treatment").value).toBe(
      "tax_included",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Tax rate").value).toBe("18");
  });
});
