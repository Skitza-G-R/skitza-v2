// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvailabilityPanel } from "../availability-panel";

const actionMocks = vi.hoisted(() => ({
  updateAvailabilitySettings: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("../calendar-actions", () => ({
  addBlackout: vi.fn(),
  removeBlackout: vi.fn(),
  setAvailabilityWeek: vi.fn(),
  updateAvailabilitySettings: actionMocks.updateAvailabilitySettings,
}));

function renderPanel(maxSessionsPerDay: number | null = null) {
  return render(
    <AvailabilityPanel
      blocks={[]}
      blackouts={[]}
      settings={{
        autoConfirmBookings: false,
        cancellationPolicyHours: 24,
        maxSessionsPerDay,
      }}
      initialWeekStart="sunday"
      timeZone="Asia/Jerusalem"
      initialNow="2026-08-08T09:00:00.000Z"
    />,
  );
}

describe("Availability daily session limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("rejects values that are not positive whole numbers", () => {
    renderPanel();
    const input = screen.getByLabelText<HTMLInputElement>("Daily session limit");

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("status").textContent).toContain("Enter a whole number from 1");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(actionMocks.updateAvailabilitySettings).not.toHaveBeenCalled();
  });

  it("rejects values outside the database integer range", () => {
    renderPanel();
    const input = screen.getByLabelText<HTMLInputElement>("Daily session limit");

    fireEvent.change(input, { target: { value: "2147483648" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("status").textContent).toContain("2,147,483,647");
    expect(actionMocks.updateAvailabilitySettings).not.toHaveBeenCalled();
  });

  it("announces loading and saved states while persisting a limit", async () => {
    let finishSave: ((result: { ok: true }) => void) | undefined;
    actionMocks.updateAvailabilitySettings.mockReturnValueOnce(
      new Promise<{ ok: true }>((resolve) => {
        finishSave = resolve;
      }),
    );
    renderPanel();

    fireEvent.change(screen.getByLabelText("Daily session limit"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(true);
    expect(screen.getByText("Saving…", { selector: "p" })).toBeTruthy();
    await act(async () => {
      finishSave?.({ ok: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeTruthy();
    });
    expect(actionMocks.updateAvailabilitySettings).toHaveBeenCalledWith({
      maxSessionsPerDay: 4,
    });
  });

  it("saves a cleared field as No limit", async () => {
    actionMocks.updateAvailabilitySettings.mockResolvedValueOnce({ ok: true });
    renderPanel(4);
    const input = screen.getByLabelText<HTMLInputElement>("Daily session limit");

    expect(input.value).toBe("4");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeTruthy();
    });
    expect(actionMocks.updateAvailabilitySettings).toHaveBeenCalledWith({
      maxSessionsPerDay: null,
    });
    expect(input.value).toBe("");
    expect(input.getAttribute("placeholder")).toBe("No limit");
  });
});
