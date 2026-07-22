import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ClientsTableHeader } from "../clients-table-header";

// Source-grep tests for ClientsTableHeader — locks in the grid +
// sortable column behavior the parent depends on.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "clients-table-header.tsx"), "utf-8");

describe("ClientsTableHeader — automatic client roster columns", () => {
  it("exports a ClientsTableHeader component", () => {
    expect(SRC).toMatch(/export function ClientsTableHeader/);
  });

  it("uses the compact 7-column grid shared with ClientCompactRow", () => {
    expect(SRC).toContain("44px minmax(0,1.4fr) minmax(0,1.5fr) 110px 90px 110px 44px");
    expect(SRC).toContain("export const CLIENTS_TABLE_GRID");
  });

  it("declares only scan-useful roster labels", () => {
    expect(SRC).toContain("Client");
    expect(SRC).toContain("Email");
    expect(SRC).toContain("Link");
    expect(SRC).toContain("Projects");
    expect(SRC).toContain("Joined");
    expect(SRC).not.toContain('label: "Lifetime"');
    expect(SRC).not.toContain('label: "Owed"');
  });

  it("makes the visible Joined header dispatch the joined sort", () => {
    expect(SRC).toMatch(/label:\s*"Joined",\s*sortKey:\s*"joined"/);
    expect(SRC).toMatch(/onSortChange\(col\.sortKey\)/);
    expect(SRC).toContain("ArrowUpDown");
    expect(SRC).not.toContain('aria-hidden="true"');
  });

  it("dispatches joined when a user activates the rendered Joined button", () => {
    const onSortChange = vi.fn();
    const header = ClientsTableHeader({ sort: "recent", onSortChange }) as ReactElement<{
      children?: ReactNode;
    }>;
    const columns = Children.toArray(header.props.children);
    const joinedButton = columns
      .filter(isValidElement)
      .map((column) => (column as ReactElement<{ children?: ReactNode }>).props.children)
      .find(
        (child): child is ReactElement<{ children?: ReactNode; onClick: () => void }> =>
          isValidElement(child) &&
          child.type === "button" &&
          Children.toArray((child as ReactElement<{ children?: ReactNode }>).props.children).includes(
            "Joined",
          ),
      );

    expect(joinedButton).toBeDefined();
    joinedButton?.props.onClick();
    expect(onSortChange).toHaveBeenCalledWith("joined");
  });

  it("limits the aligned desktop header to xl screens", () => {
    expect(SRC).toMatch(/className="[^"]*hidden[^"]*xl:grid[^"]*"/);
    expect(SRC).not.toMatch(/className="[^"]*hidden[^"]*lg:grid[^"]*"/);
  });

  it("forbids forbidden CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
