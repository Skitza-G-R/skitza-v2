import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Chips } from "../chips";

// Chips primitive — static-markup contract tests.
//
// In-repo testing convention is node-env vitest with no jsdom (see
// vitest.config.ts), so we can't fire click events server-side. The
// `useChipsParam` hook + click handler behaviour is exercised by the
// real consumers (Phase 4 pages). What we CAN pin server-side:
//   - The wrapper renders with the supplied `aria-label`.
//   - Each item renders as a button with the locked tokens.
//   - The active item carries `aria-pressed="true"` and the amber
//     surface tokens; inactive items carry `aria-pressed="false"`
//     and the muted tokens.
//   - The count badge renders only when count > 0.
//   - When an item carries `href`, it renders as a link with
//     `aria-current="page"` for the active one.

describe("Chips primitive", () => {
  it("wraps the row in role='group' with the supplied aria-label", () => {
    const html = renderToStaticMarkup(
      <Chips
        ariaLabel="Filter clients"
        value="all"
        onChange={() => {
          /* no-op */
        }}
        items={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
        ]}
      />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Filter clients"');
  });

  it("renders one button per item with the active one aria-pressed", () => {
    const html = renderToStaticMarkup(
      <Chips
        ariaLabel="Filter"
        value="active"
        onChange={() => {
          /* no-op */
        }}
        items={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
          { value: "balance", label: "With balance" },
        ]}
      />,
    );
    // Three buttons total
    expect(html.match(/<button\b/g)?.length).toBe(3);
    // The 'active' chip is pressed
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?<span>Active<\/span>/);
    // The other two are not pressed
    expect(html).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?<span>All<\/span>/);
    expect(
      html,
    ).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?<span>With balance<\/span>/);
  });

  it("renders the count badge only when count > 0", () => {
    const html = renderToStaticMarkup(
      <Chips
        ariaLabel="Filter"
        value="all"
        onChange={() => {
          /* no-op */
        }}
        items={[
          { value: "all", label: "All", count: 12 },
          { value: "active", label: "Active", count: 0 },
          { value: "archived", label: "Archived", count: null },
        ]}
      />,
    );
    expect(html).toContain(">12<");
    // count: 0 should not render a badge — "All · 0" is noise on quiet rows.
    expect(html).not.toContain(">0<");
    // count: null is treated the same as undefined.
    expect(html).not.toContain(">null<");
  });

  it("applies the brand-primary tint on the active chip", () => {
    const html = renderToStaticMarkup(
      <Chips
        ariaLabel="Filter"
        value="active"
        onChange={() => {
          /* no-op */
        }}
        items={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
        ]}
      />,
    );
    expect(html).toContain("border-[rgb(var(--brand-primary))]");
    expect(html).toContain("bg-[rgb(var(--brand-primary)/0.08)]");
    expect(html).toContain("text-[rgb(var(--brand-primary))]");
  });

  it("renders as a Link when an item carries href, with aria-current on the active one", () => {
    const html = renderToStaticMarkup(
      <Chips
        ariaLabel="View"
        value="projects"
        items={[
          { value: "projects", label: "Projects", href: "/dashboard/clients-projects?view=projects" },
          { value: "clients", label: "Clients", href: "/dashboard/clients-projects?view=clients" },
        ]}
      />,
    );
    // Two links, no buttons
    expect(html).toContain('<a ');
    expect(html.match(/<a\b/g)?.length).toBe(2);
    expect(html.match(/<button\b/g)).toBeNull();
    // Exactly one aria-current="page" — only the active link.
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    // The active aria-current is on the Projects anchor (it appears
    // before the Projects span and after the Clients href).
    const activeIdx = html.indexOf('aria-current="page"');
    const projectsIdx = html.indexOf("<span>Projects</span>");
    const clientsIdx = html.indexOf("<span>Clients</span>");
    expect(activeIdx).toBeGreaterThan(-1);
    expect(activeIdx).toBeLessThan(projectsIdx);
    expect(activeIdx).toBeLessThan(clientsIdx); // both anchors come after; the active one's the closest.
    expect(projectsIdx).toBeLessThan(clientsIdx);
  });

  it("disables the button when onChange is missing (display-only state)", () => {
    const html = renderToStaticMarkup(
      <Chips
        ariaLabel="View"
        value="all"
        items={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
        ]}
      />,
    );
    // Both buttons disabled — clicking does nothing without onChange.
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
