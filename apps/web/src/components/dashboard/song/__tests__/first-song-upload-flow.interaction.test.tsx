// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
  toast: vi.fn(),
  prepareFirstVersionUploadAction: vi.fn(),
  completeFirstVersionUploadAction: vi.fn(),
  cancelFirstVersionUploadAction: vi.fn(),
  addTrackAction: vi.fn(),
  addVersionAction: vi.fn(),
  beginManagedUpload: vi.fn(),
  managedFail: vi.fn(),
}));

vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div data-dialog-root>{children}</div> : null,
  Portal: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Overlay: () => <div data-dialog-overlay />,
  Content: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  Title: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocked.router,
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocked.toast }),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/upload-actions", () => ({
  abortMultipartAction: vi.fn(),
  addTrackAction: mocked.addTrackAction,
  addVersionAction: mocked.addVersionAction,
  cancelFirstVersionUploadAction: mocked.cancelFirstVersionUploadAction,
  completeFirstVersionUploadAction: mocked.completeFirstVersionUploadAction,
  completeMultipartAction: vi.fn(),
  deleteVersionAction: vi.fn(),
  initMultipartAction: vi.fn(),
  prepareFirstVersionUploadAction: mocked.prepareFirstVersionUploadAction,
  setTrackStageAction: vi.fn(),
  signPartAction: vi.fn(),
}));

vi.mock("~/lib/audio/use-multipart-upload", () => ({
  cancelInitializedUploadIfRequested: vi.fn().mockResolvedValue(null),
  createUploadCancellationRequest: vi.fn(() => ({ requested: false })),
  markResumableProgress: vi.fn(),
  markVersionCleanupRequested: vi.fn(),
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

import { UploadTrackModal } from "../upload-track-modal";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

function Harness({ onClosed = vi.fn() }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <UploadTrackModal
      open={open}
      onClose={() => {
        setOpen(false);
        onClosed();
      }}
      mode="new-song"
      projectId="11111111-1111-4111-8111-111111111111"
      tracks={[]}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.beginManagedUpload.mockReturnValue({
    id: "managed-first",
    dismiss: vi.fn(),
    fail: mocked.managedFail,
    setCancel: vi.fn(),
    setCompleting: vi.fn(),
    setPreparing: vi.fn(),
    setRetry: vi.fn(),
    setUploading: vi.fn(),
    succeed: vi.fn(),
  });
  mocked.cancelFirstVersionUploadAction.mockResolvedValue({
    ok: true,
    data: { ok: true, completed: false },
  });
  mocked.completeFirstVersionUploadAction.mockResolvedValue({
    ok: true,
    data: {
      projectId: "11111111-1111-4111-8111-111111111111",
      trackId: "22222222-2222-4222-8222-222222222222",
      versionId: "33333333-3333-4333-8333-333333333333",
      url: "/api/audio/versions/33333333-3333-4333-8333-333333333333",
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers() }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => {
      throw new Error("Duration unavailable in test");
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
});

describe("first Song upload journey", () => {
  it("chooses the file first and never creates a Song until atomic completion", async () => {
    const user = userEvent.setup();
    const closedWithoutFile = vi.fn();
    const first = render(<Harness onClosed={closedWithoutFile} />);

    expect(screen.getByRole("heading", { name: "Add Song" })).not.toBeNull();
    expect(screen.getByLabelText(/^Audio file/)).not.toBeNull();
    expect(screen.queryByLabelText(/^Song title/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closedWithoutFile).toHaveBeenCalledTimes(1);
    expect(mocked.prepareFirstVersionUploadAction).not.toHaveBeenCalled();
    expect(mocked.addTrackAction).not.toHaveBeenCalled();
    expect(mocked.addVersionAction).not.toHaveBeenCalled();
    first.unmount();

    mocked.prepareFirstVersionUploadAction
      .mockResolvedValueOnce({ ok: false, error: "Network interrupted" })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ready",
          intentId: "44444444-4444-4444-8444-444444444444",
          projectId: "11111111-1111-4111-8111-111111111111",
          trackId: "22222222-2222-4222-8222-222222222222",
          versionId: "33333333-3333-4333-8333-333333333333",
          uploadUrl: "https://upload.example.test/first-version",
          headers: {
            "Content-Type": "audio/wav",
            "x-amz-meta-skitza-upload-token": "a".repeat(64),
          },
          expiresInSeconds: 900,
        },
      });
    const closedAfterSuccess = vi.fn();
    render(<Harness onClosed={closedAfterSuccess} />);
    const file = new File([new Uint8Array([0])], "first-version.wav", {
      type: "audio/wav",
    });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    expect(screen.getByLabelText(/^Song title/)).not.toBeNull();
    expect(screen.queryByLabelText(/^Version label/)).toBeNull();
    await user.type(screen.getByLabelText(/^Song title/), "First Song");

    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.prepareFirstVersionUploadAction).toHaveBeenCalledTimes(1);
    });
    expect(mocked.managedFail).toHaveBeenCalledWith("Network interrupted");
    expect(mocked.toast).not.toHaveBeenCalledWith("Network interrupted", "error");
    expect(screen.queryByText("Network interrupted")).toBeNull();
    expect(mocked.completeFirstVersionUploadAction).not.toHaveBeenCalled();
    expect(mocked.addTrackAction).not.toHaveBeenCalled();
    expect(mocked.addVersionAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.completeFirstVersionUploadAction).toHaveBeenCalledTimes(1);
    });
    expect(mocked.prepareFirstVersionUploadAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "11111111-1111-4111-8111-111111111111",
        title: "First Song",
        label: "V1",
        filename: "first-version.wav",
      }),
    );
    expect(mocked.addTrackAction).not.toHaveBeenCalled();
    expect(mocked.addVersionAction).not.toHaveBeenCalled();
    expect(closedAfterSuccess).toHaveBeenCalledTimes(1);
  });
});
