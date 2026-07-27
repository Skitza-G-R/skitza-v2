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
        /<span\b[^>]*class="[^"]*producer-bottom-nav__label[^"]*"[^>]*>([^<]+)<\/span>/,
      )?.[1] ?? "";

    return { attributes, href, label };
  });

  return { html, tabs };
}

beforeEach(() => {
  mocked.pathname = "/dashboard";
});

describe("ProducerBottomNav rendered behavior", () => {
  it("renders all five real routes with Today/Home in the center slot", () => {
    const { html, tabs } = renderTabs("/dashboard");

    expect(tabs.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: "Music", href: "/dashboard/music" },
      { label: "Clients", href: "/dashboard/clients-projects" },
      { label: "Today", href: "/dashboard" },
      { label: "Calendar", href: "/dashboard/calendar?tab=sessions" },
      { label: "Payments", href: "/dashboard/payments" },
    ]);
    expect(tabs).toHaveLength(5);
    expect(tabs[2]).toMatchObject({ label: "Today", href: "/dashboard" });
    expect(html).toContain('aria-label="Producer tabs"');
    expect(html).toContain("grid-cols-5");
    expect(html).toContain('class="producer-bottom-nav__lens" aria-hidden="true"');
    expect(html).toContain('class="producer-bottom-nav__magnifier" aria-hidden="true"');
    expect(html).toContain("producer-bottom-nav__magnifier-grid");
    for (const tab of tabs) {
      expect(tab.attributes).toContain("producer-bottom-nav__tab");
      expect(tab.attributes).toContain("min-height:68px");
    }
  });

  it.each([
    ["/dashboard", "Today"],
    ["/dashboard/music", "Music"],
    ["/dashboard/clients-projects", "Clients"],
    ["/dashboard/calendar", "Calendar"],
    ["/dashboard/payments", "Payments"],
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
});
