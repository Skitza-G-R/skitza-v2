// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CenteredWheelPicker, type CenteredWheelPickerOption } from "../centered-wheel-picker";

const OPTIONS: readonly CenteredWheelPickerOption[] = [
  { value: "09:00", label: "09:00" },
  { value: "09:15", label: "09:15", disabled: true },
  { value: "09:30", label: "09:30" },
  { value: "09:45", label: "09:45" },
  { value: "10:00", label: "10:00" },
  { value: "10:15", label: "10:15" },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function installMotionPreference(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  );
}

describe("CenteredWheelPicker", () => {
  it("renders a centered five-row listbox with one active descendant", () => {
    render(
      <CenteredWheelPicker
        id="start-wheel"
        label="Start time"
        options={OPTIONS}
        value="09:30"
        onValueChange={vi.fn()}
      />,
    );

    const listbox = screen.getByRole("listbox", { name: "Start time" });
    const options = screen.getAllByRole("option");
    const selected = screen.getByRole("option", { name: "09:30" });
    const disabled = screen.getByRole("option", { name: "09:15" });
    const centerBand = screen.getByTestId("centered-wheel-center-band");

    expect(listbox.style.height).toBe("240px");
    expect(listbox.style.scrollSnapType).toBe("y mandatory");
    expect(listbox.getAttribute("aria-activedescendant")).toBe("start-wheel-option-2");
    expect(listbox.className).toContain("text-center");
    expect(options.every((option) => option.style.height === "48px")).toBe(true);
    expect(options.every((option) => option.style.scrollSnapAlign === "center")).toBe(true);
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.getAttribute("data-disabled")).toBe("true");
    expect(centerBand.style.top).toBe("96px");
    expect(centerBand.style.height).toBe("48px");
  });

  it("supports a compact three-row wheel without shrinking its touch targets", () => {
    render(
      <CenteredWheelPicker
        label="Date"
        options={OPTIONS}
        value="09:00"
        visibleRows={3}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Date" }).style.height).toBe("144px");
    expect(screen.getByTestId("centered-wheel-center-band").style.top).toBe("48px");
    expect(screen.getAllByRole("option").every((option) => option.style.minHeight === "48px")).toBe(
      true,
    );
  });

  it("keeps identity wheels compact and gives the active date/time row stronger hierarchy", () => {
    const { rerender } = render(
      <CenteredWheelPicker
        label="Client"
        options={OPTIONS}
        value="09:00"
        visibleRows={3}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Client" }).dataset.emphasis).toBe("compact");
    expect(screen.getByRole("option", { name: "09:00" }).className).not.toContain("text-[17px]");

    rerender(
      <CenteredWheelPicker
        label="Start"
        options={OPTIONS}
        value="09:00"
        emphasis="prominent"
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Start" }).dataset.emphasis).toBe("prominent");
    expect(screen.getByRole("option", { name: "09:00" }).className).toContain("text-[17px]");
  });

  it("selects enabled tapped options and ignores disabled taps", () => {
    installMotionPreference(false);
    const onValueChange = vi.fn();
    render(
      <CenteredWheelPicker
        label="Start time"
        options={OPTIONS}
        value="09:00"
        onValueChange={onValueChange}
      />,
    );
    const listbox = screen.getByRole("listbox", { name: "Start time" });
    const scrollTo = vi.fn();
    Object.defineProperty(listbox, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.click(screen.getByRole("option", { name: "09:15" }));
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("option", { name: "09:45" }));
    expect(onValueChange).toHaveBeenCalledWith("09:45");
    expect(listbox.getAttribute("aria-activedescendant")).toMatch(/option-3$/);
    expect(scrollTo).toHaveBeenCalledWith({ top: 3 * 48, behavior: "smooth" });
  });

  it("selects the centered enabled option after touch scrolling settles", () => {
    vi.useFakeTimers();
    const onValueChange = vi.fn();
    render(
      <CenteredWheelPicker
        label="Start time"
        options={OPTIONS}
        value="09:00"
        onValueChange={onValueChange}
      />,
    );
    const listbox = screen.getByRole("listbox", { name: "Start time" });
    Object.defineProperty(listbox, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(listbox, "scrollTop", {
      configurable: true,
      writable: true,
      value: 2 * 48,
    });

    fireEvent.scroll(listbox);
    act(() => {
      vi.runAllTimers();
    });

    expect(onValueChange).toHaveBeenCalledWith("09:30");
    expect(listbox.getAttribute("aria-activedescendant")).toMatch(/option-2$/);
  });

  it("skips disabled options for arrow, paging, Home, and End keys", () => {
    const onValueChange = vi.fn();
    render(
      <CenteredWheelPicker
        label="Start time"
        options={OPTIONS}
        value="09:00"
        visibleRows={3}
        onValueChange={onValueChange}
      />,
    );
    const listbox = screen.getByRole("listbox", { name: "Start time" });
    Object.defineProperty(listbox, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "End" });
    fireEvent.keyDown(listbox, { key: "Home" });
    fireEvent.keyDown(listbox, { key: "PageDown" });
    fireEvent.keyDown(listbox, { key: "PageUp" });
    fireEvent.keyDown(listbox, { key: " " });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledTimes(5);
    expect(onValueChange).toHaveBeenNthCalledWith(1, "09:30");
    expect(onValueChange).toHaveBeenNthCalledWith(2, "10:15");
    expect(onValueChange).toHaveBeenNthCalledWith(3, "09:00");
    expect(onValueChange).toHaveBeenNthCalledWith(4, "09:45");
    expect(onValueChange).toHaveBeenNthCalledWith(5, "09:00");
    expect(listbox.getAttribute("aria-activedescendant")).toMatch(/option-0$/);
  });

  it("uses non-smooth programmatic scrolling when reduced motion is requested", () => {
    installMotionPreference(true);
    render(
      <CenteredWheelPicker
        label="Start time"
        options={OPTIONS}
        value="09:00"
        onValueChange={vi.fn()}
      />,
    );
    const listbox = screen.getByRole("listbox", { name: "Start time" });
    const scrollTo = vi.fn();
    Object.defineProperty(listbox, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.click(screen.getByRole("option", { name: "10:00" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 4 * 48, behavior: "auto" });
    expect(listbox.className).toContain("motion-reduce:scroll-auto");
  });
});
