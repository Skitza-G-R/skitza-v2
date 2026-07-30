// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("~/components/dashboard/song/upload-track-modal", () => ({
  UploadTrackModal: ({ open, mode, trackId }: { open: boolean; mode: string; trackId?: string }) =>
    open ? (
      <div role="dialog" aria-label="Upload version">{`${mode}:${trackId ?? "none"}`}</div>
    ) : null,
}));

import { ProjectSongUploadController } from "../project-song-upload-controller";

const ACTION_PROJECT = {
  id: "project-1",
  title: "Full production",
  clientName: "Maya",
  lifecycleStatus: "active" as const,
  workflowStage: "production" as const,
  deadlineAtIso: null,
  canDeleteEmptyDraft: false,
};
const SONG = {
  id: "song-1",
  purchaseId: "purchase-1",
  title: "Night Drive",
  archivedAtIso: null,
  versionCount: 2,
  publicExposure: "none" as const,
};

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.canUpload = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectSongUploadController", () => {
  it("opens only the one-shot upload modal and clears the song handoff query", async () => {
    mocks.searchParams = new URLSearchParams("song=song-1&upload=1&ref=music");
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(
      <ProjectSongUploadController
        projectId="project-1"
        actionProject={ACTION_PROJECT}
        purchases={[]}
        song={SONG}
        initialUploadOpen
      />,
    );

    expect((await screen.findByRole("dialog", { name: "Upload version" })).textContent).toBe(
      "new-version:song-1",
    );
    expect(screen.queryByText("Workflow")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    await waitFor(() => {
      expect(replaceState).toHaveBeenCalledWith(
        null,
        "",
        "/dashboard/clients-projects/project-1?ref=music",
      );
    });
  });

  it("renders nothing without an explicit upload handoff", () => {
    render(
      <ProjectSongUploadController
        projectId="project-1"
        actionProject={ACTION_PROJECT}
        purchases={[]}
        song={SONG}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Night Drive")).toBeNull();
  });
});
