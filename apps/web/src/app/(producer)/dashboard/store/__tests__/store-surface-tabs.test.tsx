// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { StoreSurfaceTabs, type StoreSurface } from "../store-surface-tabs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-surface-tabs.tsx"), "utf8");

afterEach(cleanup);

function TabsHarness() {
  const [surface, setSurface] = useState<StoreSurface>("products");
  return (
    <StoreSurfaceTabs
      value={surface}
      onChange={setSurface}
      productCount={4}
      offerCount={2}
    />
  );
}

describe("StoreSurfaceTabs", () => {
  it("uses real tab semantics for Products and Private offers", () => {
    expect(SRC).toMatch(/role="tablist"/);
    expect(SRC).toMatch(/role="tab"/);
    expect(SRC).toContain("Products");
    expect(SRC).toContain("Private offers");
    expect(SRC).toMatch(/aria-selected/);
    expect(SRC).toMatch(/aria-controls/);
  });

  it("keeps both controls phone-safe", () => {
    expect(SRC).toMatch(/min-h-\[44px\]/);
  });

  it("uses one solid Skitza-orange selected state without a second underline", () => {
    expect(SRC).toContain("bg-[rgb(var(--brand-primary))]");
    expect(SRC).toContain("text-[rgb(var(--fg-on-brand))]");
    expect(SRC).not.toContain("-bottom-1 h-0.5");
    expect(SRC).not.toContain("shadow-[");
    expect(SRC).not.toContain("brand-primary-text");
  });

  it("supports the standard horizontal-tab arrow keys", () => {
    expect(SRC).toContain('event.key === "ArrowLeft"');
    expect(SRC).toContain('event.key === "ArrowRight"');
    expect(SRC).toMatch(/document\.getElementById\(nextSurface\.tabId\)\?\.focus\(\)/);
  });

  it("opens Products by default and switches to Private offers", () => {
    render(<TabsHarness />);

    const products = screen.getByRole("tab", { name: /Products/ });
    const offers = screen.getByRole("tab", { name: /Private offers/ });
    expect(products.getAttribute("aria-selected")).toBe("true");
    expect(offers.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(offers);
    expect(products.getAttribute("aria-selected")).toBe("false");
    expect(offers.getAttribute("aria-selected")).toBe("true");
    expect(offers.className).toContain("bg-[rgb(var(--brand-primary))]");
  });
});
