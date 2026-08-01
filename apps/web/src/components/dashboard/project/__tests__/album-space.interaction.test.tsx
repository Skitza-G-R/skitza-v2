// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AlbumSpace } from "../album-space";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}));

vi.mock("../album-tabs/songs-tab", () => ({
  SongsTab: () => <div>Songs panel</div>,
}));

vi.mock("../project-song-upload-controller", () => ({
  ProjectSongUploadController: () => null,
}));

vi.mock("~/components/dashboard/song/upload-track-modal", () => ({
  UploadTrackModal: ({
    open,
    mode,
    projectId,
  }: {
    open: boolean;
    mode: string;
    projectId?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label="Add Song upload" data-mode={mode} data-project={projectId} />
    ) : null,
}));

vi.mock("../album-tabs/project-payments-tab", () => ({
  PaymentsTab: () => <div>Payments panel</div>,
}));

vi.mock("../album-tabs/studio-log-tab", () => ({
  StudioLogTab: () => <div>Studio Log panel</div>,
}));

vi.mock("../album-tabs/details-tab", () => ({
  DetailsTab: () => <div>Details panel</div>,
}));

const EMPTY_PAYMENT_VIEW = {
  section: {
    id: "empty",
    eyebrow: "Payments",
    title: "Payments",
    description: "Payments",
    emptyTitle: "Empty",
    emptyDescription: "Empty",
  },
  currencyTotals: [],
  projects: [],
};

const PROPS = {
  project: {
    id: "project-1",
    name: "First Album",
    clientName: "Maya Cohen",
    songsCount: 3,
    workflowStage: "mixing" as const,
    deadline: "Aug 12",
    isOverdue: false,
    paymentAttention: {
      needsReviewPurchaseCount: 1,
      dueOrOverduePurchaseCount: 0,
    },
  },
  actionProject: {
    id: "project-1",
    title: "First Album",
    clientName: "Maya Cohen",
    lifecycleStatus: "active" as const,
    workflowStage: "mixing" as const,
    deadlineAtIso: "2026-08-12T00:00:00.000Z",
    canDeleteEmptyDraft: false,
  },
  purchases: [],
  payments: {
    needsReview: EMPTY_PAYMENT_VIEW,
    dueOrOverdue: EMPTY_PAYMENT_VIEW,
    history: EMPTY_PAYMENT_VIEW,
  },
  tracks: [],
  selectedSongUpload: {
    id: "song-1",
    purchaseId: "purchase-1",
    title: "Night Drive",
    archivedAtIso: null,
    versionCount: 1,
    publicExposure: "none" as const,
  },
  studioLog: { entries: [] },
};

afterEach(() => {
  cleanup();
  mocks.push.mockReset();
});

describe("AlbumSpace interactions", () => {
  it("starts on Songs on every mount and switches the payment alert to Payments", async () => {
    const user = userEvent.setup();
    const first = render(<AlbumSpace {...PROPS} />);

    expect(screen.getByText("Songs panel")).not.toBeNull();
    expect(screen.queryByText("Workflow")).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Song section" })).toBeNull();
    expect(screen.queryByText("Payments panel")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Payment needs attention/i }));
    expect(screen.getByText("Payments panel")).not.toBeNull();
    expect(screen.queryByText("Songs panel")).toBeNull();

    first.unmount();
    render(<AlbumSpace {...PROPS} />);
    expect(screen.getByText("Songs panel")).not.toBeNull();
    expect(screen.queryByText("Payments panel")).toBeNull();
  });

  it("opens the contextual Add Song upload for the current Project", async () => {
    const user = userEvent.setup();
    render(<AlbumSpace {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "Add song to First Album" }));

    const dialog = screen.getByRole("dialog", { name: "Add Song upload" });
    expect(dialog.getAttribute("data-mode")).toBe("new-song");
    expect(dialog.getAttribute("data-project")).toBe("project-1");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
