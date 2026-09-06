import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  pathname: "/dashboard",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocked.pathname,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ProducerBottomNav } from "../producer-bottom-nav";

type RenderedTab = {
  attributes: string;
  href: string;
  label: string;
};

function renderTabs(pathname: string): { html: string; tabs: RenderedTab[] } {
  mocked.pathname = pathname;
  const html = renderToStaticMarkup(<ProducerBottomNav />);
  const tabs = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => {
    const attributes = match[1] ?? "";
    const content = match[2] ?? "";
    const href = attributes.match(/\bhref="([^"]+)"/)?.[1] ?? "";
    const label =
      content.match(
        /<span\b[^>]*class="[^"]*liquid-glass-bottom-nav__label[^"]*"[^>]*>([^<]+)<\/span>/,
      )?.[1] ?? "";

    return { attributes, href, label };
  });

  return { html, tabs };
}

beforeEach(() => {
  mocked.pathname = "/dashboard";
});

describe("ProducerBottomNav rendered behavior", () => {
  it("renders all five real routes with Today/Home in the far-left slot", () => {
    const { html, tabs } = renderTabs("/dashboard");

    expect(tabs.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: "Today", href: "/dashboard" },
      { label: "Music", href: "/dashboard/music" },
      { label: "Clients", href: "/dashboard/clients-projects" },
      { label: "Calendar", href: "/dashboard/calendar?tab=sessions" },
      { label: "Store", href: "/dashboard/store" },
    ]);
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toMatchObject({ label: "Today", href: "/dashboard" });
    expect(html).toContain('aria-label="Producer tabs"');
    expect(html).toContain("--sk-nav-column-count:5");
    expect(html).toContain('class="liquid-glass-bottom-nav__lens" aria-hidden="true"');
    expect(html).toContain('class="liquid-glass-bottom-nav__magnifier" aria-hidden="true"');
    expect(html).toContain("liquid-glass-bottom-nav__magnifier-grid");
    for (const tab of tabs) {
      expect(tab.attributes).toContain("liquid-glass-bottom-nav__tab");
      expect(tab.attributes).toContain("min-height:68px");
    }
  });

  it.each([
    ["/dashboard", "Today"],
    ["/dashboard/music", "Music"],
    ["/dashboard/clients-projects", "Clients"],
    ["/dashboard/calendar", "Calendar"],
    ["/dashboard/store", "Store"],
  ])("marks exactly one active tab for %s", (pathname, activeLabel) => {
    const { tabs } = renderTabs(pathname);
    const activeTabs = tabs.filter(
      ({ attributes }) =>
        attributes.includes('aria-current="page"') && attributes.includes('data-active="true"'),
    );

    expect(activeTabs).toHaveLength(1);
    expect(activeTabs[0]?.label).toBe(activeLabel);
    expect(
      tabs.filter(({ attributes }) => attributes.includes('data-active="false"')),
    ).toHaveLength(4);
  });

  it("leaves Payments out of the bar and marks no tab active on its route", () => {
    const { tabs } = renderTabs("/dashboard/payments");

    expect(tabs.map(({ href }) => href)).not.toContain("/dashboard/payments");
    expect(
      tabs.filter(({ attributes }) => attributes.includes('aria-current="page"')),
    ).toHaveLength(0);
  });
});
