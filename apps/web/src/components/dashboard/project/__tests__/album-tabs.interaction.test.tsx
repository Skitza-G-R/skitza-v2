// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AlbumTabs, type AlbumTab } from "../album-tabs";

function AlbumTabsHarness() {
  const [active, setActive] = useState<AlbumTab>("songs");
  return <AlbumTabs active={active} onChange={setActive} songsCount={3} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AlbumTabs interactions", () => {
  it("renders the four locked tabs in order with Songs selected by default", () => {
    render(<AlbumTabsHarness />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent.replace(/\s+/gu, " ").trim())).toEqual([
      "Songs (3)",
      "Payments",
      "Studio Log",
      "Details",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.getAttribute("tabindex")).toBe("0");
    expect(tabs[0]?.getAttribute("aria-controls")).toBe("panel-songs");
    expect(tabs[3]?.getAttribute("aria-controls")).toBe("panel-details");
  });

  it("activates clicked tabs and supports roving keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<AlbumTabsHarness />);

    const payments = screen.getByRole("tab", { name: "Payments" });
    await user.click(payments);
    expect(payments.getAttribute("aria-selected")).toBe("true");
    expect(payments.getAttribute("tabindex")).toBe("0");

    await user.keyboard("{End}");
    const details = screen.getByRole("tab", { name: "Details" });
    expect(details.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(details);

    await user.keyboard("{ArrowLeft}");
    const studioLog = screen.getByRole("tab", { name: "Studio Log" });
    expect(studioLog.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(studioLog);

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Songs (3)" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("brings a clipped programmatically selected tab into view without moving focus", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const onChange = vi.fn();
    const { rerender } = render(<AlbumTabs active="songs" onChange={onChange} songsCount={3} />);
    const tablist = screen.getByRole("tablist", { name: "Project sections" });
    const details = screen.getByRole("tab", { name: "Details" });
    const scrollIntoView = vi.fn();
    Object.defineProperty(details, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.spyOn(tablist, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 300,
    } as DOMRect);
    vi.spyOn(details, "getBoundingClientRect").mockReturnValue({
      left: 310,
      right: 400,
    } as DOMRect);

    rerender(<AlbumTabs active="details" onChange={onChange} songsCount={3} />);

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
    expect(document.activeElement).not.toBe(details);
  });
});
