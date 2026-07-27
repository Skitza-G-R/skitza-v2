// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  },
  pathname: "/dashboard/music",
  searchParams: new URLSearchParams(),
  toast: vi.fn(),
  claimSongSpaceAction: vi.fn(),
  createNoChargeSongProposalAction: vi.fn(),
  abortMultipartAction: vi.fn(),
  addTrackAction: vi.fn(),
  addVersionAction: vi.fn(),
  completeMultipartAction: vi.fn(),
  deleteVersionAction: vi.fn(),
  initMultipartAction: vi.fn(),
  setTrackStageAction: vi.fn(),
  signPartAction: vi.fn(),
  beginManagedUpload: vi.fn(),
}));

vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-dialog-root>{children}</div> : null,
  Portal: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Overlay: () => <div data-dialog-overlay />,
  Content: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  Title: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  Close: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children?: ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocked.pathname,
  useRouter: () => mocked.router,
  useSearchParams: () => mocked.searchParams,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocked.toast }),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/actions", () => ({
  claimSongSpaceAction: mocked.claimSongSpaceAction,
  createNoChargeSongProposalAction: mocked.createNoChargeSongProposalAction,
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/upload-actions", () => ({
  abortMultipartAction: mocked.abortMultipartAction,
  addTrackAction: mocked.addTrackAction,
  addVersionAction: mocked.addVersionAction,
  completeMultipartAction: mocked.completeMultipartAction,
  deleteVersionAction: mocked.deleteVersionAction,
  initMultipartAction: mocked.initMultipartAction,
  setTrackStageAction: mocked.setTrackStageAction,
  signPartAction: mocked.signPartAction,
}));

vi.mock("~/lib/audio/use-multipart-upload", () => ({
  cancelInitializedUploadIfRequested: vi.fn().mockResolvedValue(null),
  createUploadCancellationRequest: vi.fn(() => ({ requested: false })),
  markResumableProgress: vi.fn(),
  markVersionCleanupRequested: vi.fn(
    (trackVersionId: string, _createdAt: Date, accountId: string) => ({
      trackVersionId,
      accountId,
    }),
  ),
  persistResumableEntry: vi.fn(),
  removeResumableEntry: vi.fn(),
  removeVersionCleanupEntry: vi.fn(),
  requestExactMultipartCancellation: vi.fn().mockResolvedValue({ ok: true }),
  requestUploadCancellation: vi.fn(),
  requestVersionCleanup: vi.fn().mockResolvedValue({ ok: true }),
  startMultipartCancellationRecovery: vi.fn(),
  uploadCancellationRequested: vi.fn(() => false),
}));

vi.mock("~/lib/audio/upload-manager", () => ({
  beginManagedUpload: mocked.beginManagedUpload,
  cancelManagedUpload: vi.fn().mockResolvedValue({ ok: true }),
  requireUploadRuntimeAccountId: vi.fn(() => "test-account"),
}));

vi.mock("~/components/audio/persistent-player", () => ({
  playerPlay: vi.fn(),
}));

vi.mock("~/components/dashboard/projects/project-upload-access", () => ({
  canCreatePurchaseOwnedProjectWork: () => true,
}));

vi.mock("../song-space-hero", () => ({
  SongSpaceHero: ({
    onUploadNewVersion,
  }: {
    onUploadNewVersion?: (() => void) | undefined;
  }) => (
    <button type="button" data-testid="hero-upload" onClick={onUploadNewVersion}>
      Upload new version
    </button>
  ),
}));

vi.mock("../song-space-stat-strip", () => ({
  SongSpaceStatStrip: () => null,
}));

vi.mock("../song-tabs", () => ({
  SongTabs: () => null,
}));

vi.mock("../song-tabs/overview-tab", () => ({
  OverviewTab: () => null,
}));

vi.mock("../song-tabs/versions-tab", () => ({
  VersionsTab: () => null,
}));

vi.mock("../song-tabs/sessions-tab", () => ({
  SessionsTab: () => null,
}));

vi.mock("~/components/dashboard/projects/project-action-controls", () => ({
  ProjectActionControls: () => null,
}));

vi.mock("~/components/dashboard/projects/project-purchases-panel", () => ({
  ProjectPurchasesPanel: () => null,
}));

vi.mock("~/components/payments/payment-history-view", () => ({
  PaymentHistoryView: () => null,
}));

import { AddSongDialog, type AddSongProjectOption } from "../add-song-dialog";
import { SongSpace } from "../song-space";

const projects: readonly AddSongProjectOption[] = [
  {
    id: "project-first",
    title: "First Project",
    clientName: "Test Artist",
    emptySlots: [
      {
        id: "purchase-first:1",
        purchaseId: "purchase-first",
        slotNumber: 1,
        label: "Song space 1",
      },
    ],
  },
];

const songSpaceProps = {
  mode: "single" as const,
  song: {
    id: "song-first",
    purchaseId: "purchase-first",
    title: "First Song",
    archivedAtIso: null,
    releasedAtIso: null,
    currentVersion: "No audio",
    noteCount: 0,
    durationMs: null,
    workflowStage: "brief" as const,
    progress: 5,
    deadline: "—",
    isOverdue: false,
    revisionCount: 0,
    publicExposure: "none" as const,
  },
  project: {
    id: "project-first",
    name: "First Project",
  },
  actionProject: {
    id: "project-first",
    title: "First Project",
    clientName: "Test Artist",
    lifecycleStatus: "active" as const,
    workflowStage: "brief" as const,
    deadlineAtIso: null,
    canDeleteEmptyDraft: false,
  },
  purchases: [],
  client: {
    id: "client-first",
    name: "Test Artist",
    email: "artist@example.test",
    linkState: "active" as const,
  },
  versions: [],
  sessions: [],
  gradientToken: "grad-slate" as const,
};

let originalCreateObjectUrlDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();

  mocked.pathname = "/dashboard/music";
  mocked.searchParams = new URLSearchParams();
  mocked.claimSongSpaceAction.mockResolvedValue({
    ok: true,
    data: {
      id: "song-first",
      projectId: "project-first",
      purchaseId: "purchase-first",
      title: "First Song",
    },
  });
  mocked.addTrackAction.mockResolvedValue({
    ok: true,
    data: {
      id: "unexpected-track",
      projectId: "project-first",
      title: "Unexpected",
    },
  });
  mocked.addVersionAction.mockResolvedValue({
    ok: true,
    data: {
      id: "version-first",
      trackId: "song-first",
      label: "V1",
    },
  });
  mocked.initMultipartAction.mockResolvedValue({
    ok: true,
    data: {
      uploadId: "upload-first",
      key: "test/song-first/version-first.wav",
      completionToken: "completion-first",
    },
  });
  mocked.signPartAction.mockResolvedValue({
    ok: true,
    data: { url: "https://upload.example.test/part/1" },
  });
  mocked.completeMultipartAction.mockResolvedValue({
    ok: true,
    data: {
      url: "https://audio.example.test/version-first.wav",
      key: "test/song-first/version-first.wav",
    },
  });
  mocked.abortMultipartAction.mockResolvedValue({ ok: true, data: { ok: true } });
  mocked.deleteVersionAction.mockResolvedValue({ ok: true });
  mocked.setTrackStageAction.mockResolvedValue({ ok: true });
  mocked.beginManagedUpload.mockReturnValue({
    id: "managed-first",
    dismiss: vi.fn(),
    fail: vi.fn(),
    setCancel: vi.fn(),
    setCompleting: vi.fn(),
    setPreparing: vi.fn(),
    setRetry: vi.fn(),
    setUploading: vi.fn(),
    succeed: vi.fn(),
  });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: '"etag-first"' }),
    }),
  );
  originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      throw new Error("Duration probe intentionally unavailable in this test");
    }),
  });
});

afterEach(() => {
  cleanup();
  if (originalCreateObjectUrlDescriptor) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrlDescriptor);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("first song upload journey", () => {
  it("opens the first picker, creates nothing on close, and submits the first audio as V1", async () => {
    const user = userEvent.setup();
    const closeAddSong = vi.fn();

    const view = render(
      <StrictMode>
        <AddSongDialog open onClose={closeAddSong} projects={projects} />
      </StrictMode>,
    );

    await user.type(screen.getByPlaceholderText("Untitled song"), "First Song");
    await user.click(screen.getByRole("button", { name: "Add Song" }));

    const claimedHref =
      "/dashboard/clients-projects/project-first/songs/song-first?upload=1";
    await waitFor(() => {
      expect(mocked.router.push).toHaveBeenCalledWith(claimedHref);
    });
    expect(mocked.claimSongSpaceAction).toHaveBeenCalledTimes(1);
    expect(closeAddSong).toHaveBeenCalledTimes(1);
    expect(mocked.router.refresh).not.toHaveBeenCalled();

    const destination = new URL(claimedHref, "https://skitza.example.test");
    destination.searchParams.set("view", "versions");
    destination.hash = "versions";
    window.history.replaceState(
      null,
      "",
      `${destination.pathname}${destination.search}${destination.hash}`,
    );
    const historyReplace = vi.spyOn(window.history, "replaceState");
    mocked.pathname = destination.pathname;
    mocked.searchParams = destination.searchParams;
    view.rerender(
      <StrictMode>
        <SongSpace
          key="first-arrival"
          {...songSpaceProps}
          initialUploadOpen={destination.searchParams.get("upload") === "1"}
        />
      </StrictMode>,
    );

    const firstArrivalHeading = screen.getByRole("heading", {
      name: "Upload new version",
    });
    const firstArrivalModal = firstArrivalHeading.closest("section");
    expect(firstArrivalModal).not.toBeNull();
    expect(screen.getByText("First Song")).not.toBeNull();
    expect(
      within(firstArrivalModal as HTMLElement).queryByRole("option", {
        name: "+ New song",
      }),
    ).toBeNull();
    expect(screen.getByLabelText(/^Audio file/)).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText<HTMLInputElement>(/^Version label/).value).toBe("V1");
    const canonicalHref = `${destination.pathname}?view=versions#versions`;
    await waitFor(() => {
      expect(historyReplace).toHaveBeenCalledWith(null, "", canonicalHref);
    });
    expect(historyReplace).toHaveBeenCalledTimes(1);
    expect(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ).toBe(canonicalHref);
    expect(mocked.router.replace).not.toHaveBeenCalled();
    expect(mocked.router.refresh).not.toHaveBeenCalled();
    expect(mocked.addVersionAction).not.toHaveBeenCalled();

    mocked.searchParams = new URLSearchParams("view=versions");
    view.rerender(
      <StrictMode>
        <SongSpace key="first-arrival" {...songSpaceProps} initialUploadOpen />
      </StrictMode>,
    );
    expect(screen.getByRole("heading", { name: "Upload new version" })).not.toBeNull();
    expect(historyReplace).toHaveBeenCalledTimes(1);
    expect(mocked.router.replace).not.toHaveBeenCalled();
    expect(mocked.router.refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/^Audio file/)).toBeNull();
    expect(mocked.addVersionAction).not.toHaveBeenCalled();

    view.rerender(
      <StrictMode>
        <SongSpace key="canonical-reload" {...songSpaceProps} initialUploadOpen={false} />
      </StrictMode>,
    );
    expect(screen.queryByLabelText(/^Audio file/)).toBeNull();
    expect(historyReplace).toHaveBeenCalledTimes(1);
    expect(mocked.router.replace).not.toHaveBeenCalled();
    expect(mocked.router.refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Upload new version" }));

    const fileInput = screen.getByLabelText<HTMLInputElement>(/^Audio file/);
    const labelInput = screen.getByLabelText<HTMLInputElement>(/^Version label/);
    expect(labelInput.value).toBe("V1");

    const fixture = new File([new Uint8Array([0])], "harmless-first-upload.wav", {
      type: "audio/wav",
    });
    await user.upload(fileInput, fixture);

    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mocked.completeMultipartAction).toHaveBeenCalledTimes(1);
    });
    expect(mocked.addTrackAction).not.toHaveBeenCalled();
    expect(mocked.addVersionAction).toHaveBeenCalledTimes(1);
    expect(mocked.addVersionAction).toHaveBeenCalledWith({
      trackId: "song-first",
      label: "V1",
      audioUrl: null,
    });
    expect(mocked.addVersionAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ label: "V2" }),
    );
    expect(mocked.completeMultipartAction).toHaveBeenCalledWith(
      expect.objectContaining({
        trackVersionId: "version-first",
        uploadId: "upload-first",
      }),
    );
  });
});
