// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AlbumSpace } from "../album-space";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("../album-tabs/songs-tab", () => ({
  SongsTab: ({ children }: { children?: React.ReactNode }) => (
    <div>
      Songs panel
      {children}
    </div>
  ),
}));

vi.mock("../project-song-workspace", () => ({
  ProjectSongWorkspace: ({ data }: { data: { song: { title: string } } }) => (
    <div>{`${data.song.title} inline workspace`}</div>
  ),
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
  selectedSongWorkspace: {
    song: {
      id: "song-1",
      purchaseId: "purchase-1",
      title: "Night Drive",
      archivedAtIso: null,
      currentVersion: "V1",
      workflowStage: "mixing" as const,
      progress: 60,
      deadline: "Aug 12",
      isOverdue: false,
      revisionCount: 0,
      publicExposure: "none" as const,
    },
    versions: [],
    sessions: [],
  },
  emptySlots: [],
  addSongHref: "/dashboard/music?addSong=1&projectId=project-1&lockProject=1",
  studioLog: { entries: [] },
};

afterEach(() => {
  cleanup();
});

describe("AlbumSpace interactions", () => {
  it("starts on Songs on every mount and switches the payment alert to Payments", async () => {
    const user = userEvent.setup();
    const first = render(<AlbumSpace {...PROPS} />);

    expect(screen.getByText("Songs panel")).not.toBeNull();
    expect(screen.getByText("Night Drive inline workspace")).not.toBeNull();
    expect(screen.queryByText("Payments panel")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Payment needs attention/i }));
    expect(screen.getByText("Payments panel")).not.toBeNull();
    expect(screen.queryByText("Songs panel")).toBeNull();
    expect(screen.queryByText("Night Drive inline workspace")).toBeNull();

    first.unmount();
    render(<AlbumSpace {...PROPS} />);
    expect(screen.getByText("Songs panel")).not.toBeNull();
    expect(screen.queryByText("Payments panel")).toBeNull();
  });
});
