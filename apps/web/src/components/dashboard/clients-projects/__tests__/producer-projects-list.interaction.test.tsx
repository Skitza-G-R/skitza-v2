// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectRowData } from "~/components/dashboard/projects/project-row";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("~/components/dashboard/projects/project-action-controls", () => ({
  ProjectActionControls: ({ project }: { project: { title: string } }) => (
    <button type="button">Mock action for {project.title}</button>
  ),
}));

import {
  ProducerProjectsList,
  projectPhaseLabel,
  sortProjectRows,
  type ProjectListView,
} from "../producer-projects-list";
import type { ProjectListSort } from "../projects-table-header";

function project(
  id: string,
  title: string,
  lifecycleStatus: ProjectRowData["lifecycleStatus"],
  workflowStage: ProjectRowData["workflowStage"],
  client: string,
  createdAtIso: string,
): ProjectRowData {
  return {
    id,
    title,
    lifecycleStatus,
    workflowStage,
    client,
    clientEmail: `${id}@example.com`,
    progress: null,
    balance: null,
    deadline: "—",
    status: lifecycleStatus,
    statusTone: lifecycleStatus === "active" ? "ok" : "neutral",
    createdAtIso,
    updatedAtIso: createdAtIso,
    deadlineAtIso: null,
    canPermanentlyDelete: false,
  };
}

const PROJECTS = [
  project("active", "Morning tapes", "active", "production", "Lior", "2026-01-05T10:00:00Z"),
  project(
    "waiting",
    "First light",
    "waiting_for_payment",
    "brief",
    "Maya Cohen",
    "2026-02-05T10:00:00Z",
  ),
  project("paused", "Night shift", "paused", "mixing", "Dana", "2026-03-05T10:00:00Z"),
  project("complete", "Finished record", "completed", "done", "Noa", "2026-04-05T10:00:00Z"),
  project("canceled", "Stopped EP", "canceled", "mastering", "Ari", "2026-05-05T10:00:00Z"),
];

function Harness({
  projects = PROJECTS,
  initialView = "current",
  initialSearch = "",
}: {
  projects?: ProjectRowData[];
  initialView?: ProjectListView;
  initialSearch?: string;
}) {
  const [view, setView] = useState<ProjectListView>(initialView);
  const [sort, setSort] = useState<ProjectListSort>("oldest");
  const [search, setSearch] = useState(initialSearch);
  return (
    <ProducerProjectsList
      projects={projects}
      view={view}
      sort={sort}
      search={search}
      onViewChange={setView}
      onSortChange={setSort}
      onSearchChange={setSearch}
      onNewProject={vi.fn()}
    />
  );
}

beforeEach(() => {
  mocks.push.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ProducerProjectsList", () => {
  it("shows every unfinished lifecycle once in Current and no Active badge", () => {
    const view = render(<Harness />);
    const desktopIds = Array.from(view.container.querySelectorAll("tbody [data-project-id]")).map(
      (row) => row.getAttribute("data-project-id"),
    );

    expect(desktopIds).toEqual(["active", "waiting", "paused"]);
    expect(view.container.querySelector('[data-project-state="active"]')).toBeNull();
    expect(
      view.container.querySelectorAll('[data-project-state="waiting_for_payment"]'),
    ).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-project-state="paused"]')).toHaveLength(2);
    expect(view.container.querySelector('[data-project-id="complete"]')).toBeNull();
    expect(view.container.querySelector('[data-project-id="canceled"]')).toBeNull();
  });

  it("keeps Completed and Canceled distinct in Archived", () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(view.container.querySelectorAll('[data-project-state="completed"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-project-state="canceled"]')).toHaveLength(2);
    expect(view.container.querySelector('[data-project-id="active"]')).toBeNull();
  });

  it("renders the locked five-column semantic desktop table", () => {
    render(<Harness />);
    const table = screen.getByRole("table", { name: "Current projects" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent.trim()),
    ).toEqual(["Project", "Client", "Started", "Phase", "Actions"]);
  });

  it("maps stored brief to Guide and orders the locked phase sequence", () => {
    expect(projectPhaseLabel("brief")).toBe("Guide");
    expect(sortProjectRows(PROJECTS.slice(0, 3), "phase").map((row) => row.workflowStage)).toEqual([
      "brief",
      "production",
      "mixing",
    ]);
  });

  it("defaults to oldest and lets the Started header switch to newest", () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Started/ }));
    const desktopIds = Array.from(view.container.querySelectorAll("tbody [data-project-id]")).map(
      (row) => row.getAttribute("data-project-id"),
    );
    expect(desktopIds).toEqual(["paused", "waiting", "active"]);
  });

  it("offers exactly the locked mobile sort choices", () => {
    render(<Harness />);
    const sort = screen.getByRole("combobox", { name: "Sort projects" });
    expect(
      within(sort)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Oldest", "Newest", "Phase", "Project name"]);
  });

  it("searches project and client names and exposes the exact search-empty recovery", async () => {
    const view = render(<Harness />);
    const search = screen.getByRole("searchbox", { name: "Search projects" });
    fireEvent.change(search, { target: { value: "Maya Cohen" } });

    await waitFor(() => {
      expect(view.container.querySelectorAll("tbody [data-project-id]")).toHaveLength(1);
    });
    expect(view.container.querySelector('[data-project-id="waiting"]')).not.toBeNull();

    fireEvent.change(search, { target: { value: "not here" } });
    expect(await screen.findByText("No projects match your search")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => {
      expect(view.container.querySelectorAll("tbody [data-project-id]")).toHaveLength(3);
    });
  });

  it("opens a desktop row with mouse and keyboard without action clicks navigating", () => {
    const view = render(<Harness />);
    const row = view.container.querySelector<HTMLTableRowElement>('[data-project-id="active"]');
    expect(row).not.toBeNull();
    if (!row) return;

    fireEvent.click(row);
    expect(mocks.push).toHaveBeenLastCalledWith("/dashboard/clients-projects/active");

    mocks.push.mockClear();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(mocks.push).toHaveBeenLastCalledWith("/dashboard/clients-projects/active");

    mocks.push.mockClear();
    const [action] = screen.getAllByRole("button", { name: "Mock action for Morning tapes" });
    expect(action).toBeDefined();
    if (!action) return;
    fireEvent.click(action);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("renders compact mobile rows with project, client, phase, date, and reachable actions", () => {
    const view = render(<Harness />);
    const mobileRow = view.container.querySelector('[data-mobile-project-id="waiting"]');
    expect(mobileRow).not.toBeNull();
    if (!mobileRow) return;

    expect(within(mobileRow as HTMLElement).getByText("First light")).toBeTruthy();
    expect(within(mobileRow as HTMLElement).getByText("Maya Cohen")).toBeTruthy();
    expect(within(mobileRow as HTMLElement).getByText("Guide")).toBeTruthy();
    expect(within(mobileRow as HTMLElement).getByText("Feb 5, 2026")).toBeTruthy();
    expect(
      within(mobileRow as HTMLElement).getByRole("button", { name: "Actions for First light" }),
    ).toBeTruthy();
    expect(
      within(mobileRow as HTMLElement)
        .getByRole("link", { name: "Open project First light" })
        .getAttribute("href"),
    ).toBe("/dashboard/clients-projects/waiting");
  });

  it("renders the three exact non-loading empty states", () => {
    const { rerender } = render(<Harness projects={[]} />);
    expect(screen.getByText("No current projects")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();

    rerender(<Harness key="archived" projects={[]} initialView="archived" />);
    expect(screen.getByText("No archived projects")).toBeTruthy();

    rerender(<Harness key="search" projects={[]} initialSearch="none" />);
    expect(screen.getByText("No projects match your search")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });
});
