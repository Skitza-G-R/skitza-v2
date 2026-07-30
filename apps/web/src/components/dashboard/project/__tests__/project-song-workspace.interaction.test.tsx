// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  canUpload: true,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/clients-projects/project-1",
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("~/components/dashboard/projects/project-upload-access", () => ({
  canCreatePurchaseOwnedProjectWork: () => mocks.canUpload,
}));

vi.mock("~/components/dashboard/song/song-space-stat-strip", () => ({
  SongSpaceStatStrip: ({ trackId, workflowStage }: { trackId?: string; workflowStage: string }) => (
    <div>{`Workflow controls ${trackId ?? "none"} ${workflowStage}`}</div>
  ),
}));

vi.mock("~/components/dashboard/song/song-tabs/overview-tab", () => ({
  OverviewTab: () => <div>Overview workspace</div>,
}));

vi.mock("~/components/dashboard/song/song-tabs/versions-tab", () => ({
  VersionsTab: ({ onAddVersion }: { onAddVersion?: () => void }) => (
    <div>
      Versions workspace
      {onAddVersion ? (
        <button type="button" onClick={onAddVersion}>
          Add from versions
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("~/components/dashboard/song/song-tabs/sessions-tab", () => ({
  SessionsTab: () => <div>Sessions workspace</div>,
}));

vi.mock("~/components/dashboard/song/upload-track-modal", () => ({
  UploadTrackModal: ({ open, mode, trackId }: { open: boolean; mode: string; trackId?: string }) =>
    open ? (
      <div role="dialog" aria-label="Upload version">{`${mode}:${trackId ?? "none"}`}</div>
    ) : null,
}));

import { ProjectSongWorkspace } from "../project-song-workspace";

const PROJECT = { id: "project-1", name: "Full production" };
const ACTION_PROJECT = {
  id: "project-1",
  title: "Full production",
  clientName: "Maya",
  lifecycleStatus: "active" as const,
  workflowStage: "production" as const,
  deadlineAtIso: null,
  canDeleteEmptyDraft: false,
};
const DATA = {
  song: {
    id: "song-1",
    purchaseId: "purchase-1",
    title: "Night Drive",
    archivedAtIso: null,
    currentVersion: "V2",
    workflowStage: "mixing" as const,
    progress: 64,
    deadline: "Aug 12",
    isOverdue: false,
    revisionCount: 1,
    publicExposure: "none" as const,
  },
  versions: [
    {
      id: "version-2",
      versionLabel: "V2",
      audioUrl: "https://audio.example/v2.mp3",
      audioDeletedAtIso: null,
      uploadedAtIso: "2026-07-30T00:00:00.000Z",
      uploadedBy: "You",
      changelog: "",
      durationMs: 180_000,
      noteCount: 0,
    },
  ],
  sessions: [
    {
      id: "session-1",
      startsAt: new Date("2026-08-01T10:00:00.000Z"),
      durationMinutes: 60,
      name: "Session with Maya",
      attendees: ["Maya"],
    },
  ],
};

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.canUpload = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectSongWorkspace interactions", () => {
  it("keeps workflow, versions, upload, and sessions in the Project Space", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSongWorkspace
        project={PROJECT}
        actionProject={ACTION_PROJECT}
        purchases={[]}
        data={DATA}
      />,
    );

    expect(screen.getByRole("heading", { name: "Night Drive" })).not.toBeNull();
    expect(screen.getByText("Workflow controls song-1 mixing")).not.toBeNull();
    expect(screen.getByText("Overview workspace")).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: /Versions/ }));
    expect(screen.getByText("Versions workspace")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Upload new version" }));
    expect(screen.getByRole("dialog", { name: "Upload version" }).textContent).toBe(
      "new-version:song-1",
    );

    await user.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByText("Sessions workspace")).not.toBeNull();
  });

  it("consumes only upload=1 while retaining the selected song query", async () => {
    mocks.searchParams = new URLSearchParams("song=song-1&upload=1");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(
      <ProjectSongWorkspace
        project={PROJECT}
        actionProject={ACTION_PROJECT}
        purchases={[]}
        data={DATA}
        initialUploadOpen
      />,
    );

    expect(await screen.findByRole("dialog", { name: "Upload version" })).not.toBeNull();
    await waitFor(() => {
      expect(replaceState).toHaveBeenCalledWith(
        null,
        "",
        "/dashboard/clients-projects/project-1?song=song-1",
      );
    });
  });
});
