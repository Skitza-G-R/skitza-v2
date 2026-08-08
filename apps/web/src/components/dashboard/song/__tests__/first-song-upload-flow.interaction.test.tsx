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
  abortMultipartAction: vi.fn(),
  completeMultipartAction: vi.fn(),
  deleteVersionAction: vi.fn(),
  getAudioStorageUsageAction: vi.fn(),
  reconcileAudioStorageUsageAction: vi.fn(),
  initMultipartAction: vi.fn(),
  setTrackStageAction: vi.fn(),
  signPartAction: vi.fn(),
  beginManagedUpload: vi.fn(),
  managedDismiss: vi.fn(),
  managedFail: vi.fn(),
  managedSetTerminalDispose: vi.fn(),
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
  abortMultipartAction: mocked.abortMultipartAction,
  addTrackAction: mocked.addTrackAction,
  addVersionAction: mocked.addVersionAction,
  cancelFirstVersionUploadAction: mocked.cancelFirstVersionUploadAction,
  completeFirstVersionUploadAction: mocked.completeFirstVersionUploadAction,
  completeMultipartAction: mocked.completeMultipartAction,
  deleteVersionAction: mocked.deleteVersionAction,
  getAudioStorageUsageAction: mocked.getAudioStorageUsageAction,
  reconcileAudioStorageUsageAction: mocked.reconcileAudioStorageUsageAction,
  initMultipartAction: mocked.initMultipartAction,
  prepareFirstVersionUploadAction: mocked.prepareFirstVersionUploadAction,
  setTrackStageAction: mocked.setTrackStageAction,
  signPartAction: mocked.signPartAction,
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
import { AUDIO_STORAGE_FULL_MESSAGE } from "~/lib/audio/storage-limits";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

function Harness({
  onClosed = vi.fn(),
  mode = "new-song",
}: {
  onClosed?: () => void;
  mode?: "new-song" | "new-version";
}) {
  const [open, setOpen] = useState(true);
  return (
    <UploadTrackModal
      open={open}
      onClose={() => {
        setOpen(false);
        onClosed();
      }}
      mode={mode}
      projectId={PROJECT_ID}
      {...(mode === "new-version" ? { trackId: TRACK_ID } : {})}
      tracks={
        mode === "new-version" ? [{ id: TRACK_ID, title: "Existing Song", versionCount: 1 }] : []
      }
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getAudioStorageUsageAction.mockResolvedValue({
    ok: true,
    data: {
      usedBytes: 200_000_000,
      reservedBytes: 0,
      committedBytes: 200_000_000,
      availableBytes: 800_000_000,
      limitBytes: 1_000_000_000,
      warningBytes: 800_000_000,
      isAtOrAboveWarning: false,
      isFull: false,
    },
  });
  mocked.reconcileAudioStorageUsageAction.mockResolvedValue({
    ok: true,
    data: {
      usedBytes: 200_000_000,
      reservedBytes: 0,
      committedBytes: 200_000_000,
      availableBytes: 800_000_000,
      limitBytes: 1_000_000_000,
      warningBytes: 800_000_000,
      isAtOrAboveWarning: false,
      isFull: false,
    },
  });
  mocked.beginManagedUpload.mockReturnValue({
    id: "managed-first",
    dismiss: mocked.managedDismiss,
    fail: mocked.managedFail,
    setCancel: vi.fn(),
    setCompleting: vi.fn(),
    setPreparing: vi.fn(),
    setRetry: vi.fn(),
    setTerminalDispose: mocked.managedSetTerminalDispose,
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
      projectId: PROJECT_ID,
      trackId: TRACK_ID,
      versionId: VERSION_ID,
      url: `/api/audio/versions/${VERSION_ID}`,
    },
  });
  mocked.addVersionAction.mockResolvedValue({
    ok: true,
    data: { id: VERSION_ID, trackId: TRACK_ID, label: "V2" },
  });
  mocked.initMultipartAction.mockResolvedValue({
    ok: true,
    data: {
      uploadId: "multipart-upload",
      key: `producers/test/tracks/${VERSION_ID}/audio.wav`,
      completionToken: "a".repeat(64),
    },
  });
  mocked.signPartAction.mockImplementation(({ partNumber }: { partNumber: number }) =>
    Promise.resolve({
      ok: true,
      data: { url: `https://upload.example.test/part-${String(partNumber)}` },
    }),
  );
  mocked.completeMultipartAction.mockResolvedValue({
    ok: true,
    data: { url: `/api/audio/versions/${VERSION_ID}`, key: "private-audio-key" },
  });
  mocked.abortMultipartAction.mockResolvedValue({ ok: true, data: { ok: true } });
  mocked.deleteVersionAction.mockResolvedValue({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: '"part-etag"' }),
    }),
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
  it("loads real storage usage when the modal opens", async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(mocked.getAudioStorageUsageAction).toHaveBeenCalledOnce();
    });
    expect(screen.getByText("200 MB")).not.toBeNull();
    expect(screen.getByText("800 MB")).not.toBeNull();
  });

  it("lets a full producer explicitly clean failed upload leftovers and refresh usage", async () => {
    mocked.getAudioStorageUsageAction.mockResolvedValueOnce({
      ok: true,
      data: {
        usedBytes: 900_000_000,
        reservedBytes: 100_000_000,
        committedBytes: 1_000_000_000,
        availableBytes: 0,
        limitBytes: 1_000_000_000,
        warningBytes: 800_000_000,
        isAtOrAboveWarning: true,
        isFull: true,
      },
    });
    const user = userEvent.setup();
    render(<Harness />);

    expect(await screen.findByText(/never removes Songs or Versions/i)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Clean up old uploads" }));

    await waitFor(() => {
      expect(mocked.reconcileAudioStorageUsageAction).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("button", { name: "Clean up old uploads" })).toBeNull();
  });

  it("does not offer upload cleanup when completed Versions alone fill storage", async () => {
    mocked.getAudioStorageUsageAction.mockResolvedValueOnce({
      ok: true,
      data: {
        usedBytes: 1_000_000_000,
        reservedBytes: 0,
        committedBytes: 1_000_000_000,
        availableBytes: 0,
        limitBytes: 1_000_000_000,
        warningBytes: 800_000_000,
        isAtOrAboveWarning: true,
        isFull: true,
      },
    });
    render(<Harness />);

    expect(await screen.findByText(/Delete an old Version or Song/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Clean up old uploads" })).toBeNull();
    expect(mocked.reconcileAudioStorageUsageAction).not.toHaveBeenCalled();
  });

  it("rejects an audio file larger than 100 MB before upload setup", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const oversized = new File([new Uint8Array([0])], "too-large.wav", {
      type: "audio/wav",
    });
    Object.defineProperty(oversized, "size", { value: 100_000_001 });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), oversized);

    expect(await screen.findByText("Audio files can be up to 100 MB.")).not.toBeNull();
    expect(screen.queryByText("too-large.wav")).toBeNull();
    expect(mocked.prepareFirstVersionUploadAction).not.toHaveBeenCalled();
  });

  it("shows projected usage and disables upload when it would exceed 1 GB", async () => {
    mocked.getAudioStorageUsageAction.mockResolvedValue({
      ok: true,
      data: {
        usedBytes: 950_000_000,
        reservedBytes: 0,
        committedBytes: 950_000_000,
        availableBytes: 50_000_000,
        limitBytes: 1_000_000_000,
        warningBytes: 800_000_000,
        isAtOrAboveWarning: true,
        isFull: false,
      },
    });
    const user = userEvent.setup();
    render(<Harness />);
    const file = new File([new Uint8Array([0])], "projected.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: 60_000_000 });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);

    expect(await screen.findByText("After upload: 1.01 GB of 1 GB")).not.toBeNull();
    expect(screen.getByText(/Delete an old Version or Song/)).not.toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Upload" }).disabled).toBe(true);
  });

  it("allows a 100 MB file that reaches exactly the 1 GB decimal boundary", async () => {
    mocked.getAudioStorageUsageAction.mockResolvedValue({
      ok: true,
      data: {
        usedBytes: 900_000_000,
        reservedBytes: 0,
        committedBytes: 900_000_000,
        availableBytes: 100_000_000,
        limitBytes: 1_000_000_000,
        warningBytes: 800_000_000,
        isAtOrAboveWarning: true,
        isFull: false,
      },
    });
    const user = userEvent.setup();
    render(<Harness />);
    const boundaryFile = new File([new Uint8Array([0])], "boundary.wav", {
      type: "audio/wav",
    });
    Object.defineProperty(boundaryFile, "size", { value: 100_000_000 });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), boundaryFile);
    await user.type(screen.getByLabelText(/^Song title/), "Exact Boundary");

    expect(await screen.findByText("After upload: 1 GB of 1 GB")).not.toBeNull();
    expect(screen.queryByText("Audio files can be up to 100 MB.")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Upload" }).disabled).toBe(false);
  });

  it("refreshes stale usage and removes retry after the server rejects the quota race", async () => {
    mocked.getAudioStorageUsageAction
      .mockResolvedValueOnce({
        ok: true,
        data: {
          usedBytes: 200_000_000,
          reservedBytes: 0,
          committedBytes: 200_000_000,
          availableBytes: 800_000_000,
          limitBytes: 1_000_000_000,
          warningBytes: 800_000_000,
          isAtOrAboveWarning: false,
          isFull: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          usedBytes: 950_000_000,
          reservedBytes: 0,
          committedBytes: 950_000_000,
          availableBytes: 50_000_000,
          limitBytes: 1_000_000_000,
          warningBytes: 800_000_000,
          isAtOrAboveWarning: true,
          isFull: false,
        },
      });
    mocked.prepareFirstVersionUploadAction.mockResolvedValue({
      ok: false,
      error: `Upload setup failed. ${AUDIO_STORAGE_FULL_MESSAGE}`,
    });
    const user = userEvent.setup();
    render(<Harness />);
    const file = new File([new Uint8Array([0])], "quota-race.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: 60_000_000 });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    await user.type(screen.getByLabelText(/^Song title/), "Quota Race");
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mocked.getAudioStorageUsageAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText(AUDIO_STORAGE_FULL_MESSAGE)).not.toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Upload" }).disabled).toBe(true);
    expect(mocked.managedDismiss).toHaveBeenCalledOnce();
    expect(mocked.managedFail).not.toHaveBeenCalled();
  });

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

  it.each([
    ["small", 1_024],
    ["larger than the multipart threshold", 5 * 1024 * 1024 + 17],
  ])("uploads a %s file through the atomic new-Song path", async (_sizeClass, sizeBytes) => {
    mocked.prepareFirstVersionUploadAction.mockResolvedValue({
      ok: true,
      data: {
        status: "ready",
        intentId: "44444444-4444-4444-8444-444444444444",
        projectId: PROJECT_ID,
        trackId: TRACK_ID,
        versionId: VERSION_ID,
        uploadUrl: "https://upload.example.test/first-version",
        headers: {
          "Content-Type": "audio/wav",
          "x-amz-meta-skitza-upload-token": "a".repeat(64),
        },
        expiresInSeconds: 900,
      },
    });
    const user = userEvent.setup();
    render(<Harness />);
    const file = new File([new Uint8Array(sizeBytes)], "first-version.wav", {
      type: "audio/wav",
    });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    await user.type(screen.getByLabelText(/^Song title/), "Atomic Song");
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mocked.completeFirstVersionUploadAction).toHaveBeenCalledOnce();
    });
    expect(fetch).toHaveBeenCalledOnce();
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(request?.body).toBe(file);
    expect(mocked.prepareFirstVersionUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({ sizeBytes }),
    );
    expect(mocked.initMultipartAction).not.toHaveBeenCalled();
  });

  it.each([409, 412])(
    "continues to authoritative completion after a write-once PUT returns %s",
    async (status) => {
      mocked.prepareFirstVersionUploadAction.mockResolvedValue({
        ok: true,
        data: {
          status: "ready",
          intentId: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_ID,
          trackId: TRACK_ID,
          versionId: VERSION_ID,
          uploadUrl: "https://upload.example.test/first-version",
          headers: {
            "Content-Type": "audio/wav",
            "If-None-Match": "*",
            "x-amz-meta-skitza-upload-token": "a".repeat(64),
          },
          expiresInSeconds: 900,
        },
      });
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status,
        headers: new Headers(),
      } as Response);
      const user = userEvent.setup();
      render(<Harness />);
      await user.upload(
        screen.getByLabelText<HTMLInputElement>(/^Audio file/),
        new File([new Uint8Array([0])], "first-version.wav", { type: "audio/wav" }),
      );
      await user.type(screen.getByLabelText(/^Song title/), "Write Once Song");
      await user.click(screen.getByRole("button", { name: "Upload" }));

      await waitFor(() => {
        expect(mocked.completeFirstVersionUploadAction).toHaveBeenCalledOnce();
      });
      expect(mocked.cancelFirstVersionUploadAction).not.toHaveBeenCalled();
    },
  );

  it("replaces the browser's generic Failed to fetch with the transfer stage", async () => {
    mocked.prepareFirstVersionUploadAction.mockResolvedValue({
      ok: true,
      data: {
        status: "ready",
        intentId: "44444444-4444-4444-8444-444444444444",
        projectId: PROJECT_ID,
        trackId: TRACK_ID,
        versionId: VERSION_ID,
        uploadUrl: "https://upload.example.test/first-version",
        headers: { "Content-Type": "audio/wav" },
        expiresInSeconds: 900,
      },
    });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "first-version.wav", { type: "audio/wav" }),
    );
    await user.type(screen.getByLabelText(/^Song title/), "Transfer Failure");
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mocked.managedFail).toHaveBeenCalledWith(
        "Audio transfer failed. Check your connection and try again.",
      );
    });
    expect(mocked.toast).not.toHaveBeenCalledWith(
      "Audio transfer failed. Check your connection and try again.",
      "error",
    );
    expect(mocked.toast).not.toHaveBeenCalledWith("Failed to fetch", "error");
    expect(
      screen.queryByText("Audio transfer failed. Check your connection and try again."),
    ).toBeNull();
    expect(mocked.completeFirstVersionUploadAction).not.toHaveBeenCalled();
  });

  it("uses a fresh operation key when the form Upload button resubmits after PUT failure", async () => {
    let firstOperationKey: string | undefined;
    const operationKeys: string[] = [];
    mocked.prepareFirstVersionUploadAction.mockImplementation((input: { operationKey: string }) => {
      operationKeys.push(input.operationKey);
      if (!firstOperationKey) {
        firstOperationKey = input.operationKey;
        return Promise.resolve({
          ok: true as const,
          data: {
            status: "ready" as const,
            intentId: "44444444-4444-4444-8444-444444444444",
            projectId: PROJECT_ID,
            trackId: TRACK_ID,
            versionId: VERSION_ID,
            uploadUrl: "https://upload.example.test/first-version",
            headers: { "Content-Type": "audio/wav" },
            expiresInSeconds: 900,
          },
        });
      }
      if (input.operationKey === firstOperationKey) {
        return Promise.resolve({
          ok: false as const,
          error: "This upload was canceled. Choose the file again.",
        });
      }
      return Promise.resolve({
        ok: true as const,
        data: {
          status: "ready" as const,
          intentId: "55555555-5555-4555-8555-555555555555",
          projectId: PROJECT_ID,
          trackId: TRACK_ID,
          versionId: VERSION_ID,
          uploadUrl: "https://upload.example.test/first-version",
          headers: { "Content-Type": "audio/wav" },
          expiresInSeconds: 900,
        },
      });
    });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
      } as Response);
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "first-version.wav", { type: "audio/wav" }),
    );
    await user.type(screen.getByLabelText(/^Song title/), "Fresh retry identity");
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mocked.managedFail).toHaveBeenCalledWith(
        "Audio transfer failed. Check your connection and try again.",
      );
    });
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(mocked.completeFirstVersionUploadAction).toHaveBeenCalledOnce();
    });
    expect(operationKeys).toHaveLength(2);
    expect(operationKeys[1]).not.toBe(operationKeys[0]);
    expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledWith({
      intentId: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("keeps a double-clicked form resubmit single-flight while retiring the failed intent", async () => {
    let resolveCancellation: (value: {
      ok: true;
      data: { ok: true; completed: false };
    }) => void = () => {};
    const cancellation = new Promise<{ ok: true; data: { ok: true; completed: false } }>(
      (resolve) => {
        resolveCancellation = resolve;
      },
    );
    mocked.prepareFirstVersionUploadAction
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ready",
          intentId: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_ID,
          trackId: TRACK_ID,
          versionId: VERSION_ID,
          uploadUrl: "https://upload.example.test/first-version",
          headers: { "Content-Type": "audio/wav" },
          expiresInSeconds: 900,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ready",
          intentId: "55555555-5555-4555-8555-555555555555",
          projectId: PROJECT_ID,
          trackId: TRACK_ID,
          versionId: VERSION_ID,
          uploadUrl: "https://upload.example.test/first-version",
          headers: { "Content-Type": "audio/wav" },
          expiresInSeconds: 900,
        },
      });
    mocked.cancelFirstVersionUploadAction.mockReturnValue(cancellation);
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() } as Response);
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "first-version.wav", { type: "audio/wav" }),
    );
    await user.type(screen.getByLabelText(/^Song title/), "Single flight retry");
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.managedFail).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledOnce();
    });
    expect(mocked.prepareFirstVersionUploadAction).toHaveBeenCalledTimes(1);
    expect(mocked.beginManagedUpload).toHaveBeenCalledTimes(1);

    resolveCancellation({ ok: true, data: { ok: true, completed: false } });
    await waitFor(() => {
      expect(mocked.completeFirstVersionUploadAction).toHaveBeenCalledOnce();
    });
    expect(mocked.prepareFirstVersionUploadAction).toHaveBeenCalledTimes(2);
    expect(mocked.beginManagedUpload).toHaveBeenCalledTimes(2);
  });

  it("does not start a form resubmit until failed-intent cancellation succeeds", async () => {
    mocked.prepareFirstVersionUploadAction
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ready",
          intentId: "44444444-4444-4444-8444-444444444444",
          projectId: PROJECT_ID,
          trackId: TRACK_ID,
          versionId: VERSION_ID,
          uploadUrl: "https://upload.example.test/first-version",
          headers: { "Content-Type": "audio/wav" },
          expiresInSeconds: 900,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ready",
          intentId: "55555555-5555-4555-8555-555555555555",
          projectId: PROJECT_ID,
          trackId: TRACK_ID,
          versionId: VERSION_ID,
          uploadUrl: "https://upload.example.test/first-version",
          headers: { "Content-Type": "audio/wav" },
          expiresInSeconds: 900,
        },
      });
    mocked.cancelFirstVersionUploadAction
      .mockResolvedValueOnce({ ok: false, error: "Cancellation is temporarily unavailable" })
      .mockResolvedValueOnce({ ok: true, data: { ok: true, completed: false } });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() } as Response);
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "first-version.wav", { type: "audio/wav" }),
    );
    await user.type(screen.getByLabelText(/^Song title/), "Cancellation gate");
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.managedFail).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledOnce();
    });
    expect(mocked.prepareFirstVersionUploadAction).toHaveBeenCalledTimes(1);
    expect(mocked.beginManagedUpload).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.completeFirstVersionUploadAction).toHaveBeenCalledOnce();
    });
    expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledTimes(2);
    expect(mocked.prepareFirstVersionUploadAction).toHaveBeenCalledTimes(2);
  });

  it("keeps the exact failed intent and selected file when replacement cancellation fails", async () => {
    const intentId = "44444444-4444-4444-8444-444444444444";
    mocked.prepareFirstVersionUploadAction.mockResolvedValue({
      ok: true,
      data: {
        status: "ready",
        intentId,
        projectId: PROJECT_ID,
        trackId: TRACK_ID,
        versionId: VERSION_ID,
        uploadUrl: "https://upload.example.test/first-version",
        headers: { "Content-Type": "audio/wav" },
        expiresInSeconds: 900,
      },
    });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mocked.cancelFirstVersionUploadAction
      .mockResolvedValueOnce({ ok: false, error: "Cancellation is temporarily unavailable" })
      .mockResolvedValueOnce({ ok: true, data: { ok: true, completed: false } });
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText<HTMLInputElement>(/^Audio file/);

    await user.upload(
      input,
      new File([new Uint8Array([0])], "first-version.wav", { type: "audio/wav" }),
    );
    await user.type(screen.getByLabelText(/^Song title/), "Retained Intent");
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.managedFail).toHaveBeenCalledOnce();
    });

    await user.upload(
      input,
      new File([new Uint8Array([1])], "replacement.wav", { type: "audio/wav" }),
    );
    await waitFor(() => {
      expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledWith({ intentId });
    });
    expect(screen.getByText("first-version.wav")).not.toBeNull();
    expect(screen.queryByText("replacement.wav")).toBeNull();

    await user.upload(
      input,
      new File([new Uint8Array([2])], "replacement.wav", { type: "audio/wav" }),
    );
    await waitFor(() => {
      expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("replacement.wav")).not.toBeNull();
  });

  it("retains exact terminal cancellation after modal close fails", async () => {
    const intentId = "44444444-4444-4444-8444-444444444444";
    mocked.prepareFirstVersionUploadAction.mockResolvedValue({
      ok: true,
      data: {
        status: "ready",
        intentId,
        projectId: PROJECT_ID,
        trackId: TRACK_ID,
        versionId: VERSION_ID,
        uploadUrl: "https://upload.example.test/first-version",
        headers: { "Content-Type": "audio/wav" },
        expiresInSeconds: 900,
      },
    });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mocked.cancelFirstVersionUploadAction
      .mockResolvedValueOnce({ ok: false, error: "Cancellation is temporarily unavailable" })
      .mockResolvedValueOnce({ ok: true, data: { ok: true, completed: false } });
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "first-version.wav", { type: "audio/wav" }),
    );
    await user.type(screen.getByLabelText(/^Song title/), "Close Retains Intent");
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocked.managedFail).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledTimes(1);
    });
    expect(mocked.cancelFirstVersionUploadAction).toHaveBeenLastCalledWith({ intentId });

    const terminalDispose = mocked.managedSetTerminalDispose.mock.calls[0]?.[0] as
      | (() => Promise<{ ok: boolean }>)
      | undefined;
    expect(terminalDispose).toBeTypeOf("function");
    await expect(terminalDispose?.()).resolves.toEqual({ ok: true });
    expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledTimes(2);
    expect(mocked.cancelFirstVersionUploadAction).toHaveBeenLastCalledWith({ intentId });

    await expect(terminalDispose?.()).resolves.toEqual({ ok: true });
    expect(mocked.cancelFirstVersionUploadAction).toHaveBeenCalledTimes(2);
  });
});

describe("existing Song version upload journey", () => {
  it.each([
    ["small", 1_024, 1],
    ["multipart", 5 * 1024 * 1024 + 17, 2],
  ])(
    "uploads a %s file with the expected part orchestration",
    async (_sizeClass, sizeBytes, parts) => {
      const user = userEvent.setup();
      render(<Harness mode="new-version" />);
      const file = new File([new Uint8Array(sizeBytes)], "next-version.wav", {
        type: "audio/wav",
      });

      await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
      await user.click(screen.getByRole("button", { name: "Upload" }));

      await waitFor(() => {
        expect(mocked.completeMultipartAction).toHaveBeenCalledOnce();
      });
      expect(mocked.initMultipartAction).toHaveBeenCalledWith(
        expect.objectContaining({ trackVersionId: VERSION_ID, sizeBytes }),
      );
      expect(mocked.signPartAction).toHaveBeenCalledTimes(parts);
      expect(
        mocked.signPartAction.mock.calls.map(
          ([input]) => (input as { partNumber: number }).partNumber,
        ),
      ).toEqual(Array.from({ length: parts }, (_, index) => index + 1));
      expect(fetch).toHaveBeenCalledTimes(parts);
      expect(mocked.completeMultipartAction).toHaveBeenCalledWith(
        expect.objectContaining({
          trackVersionId: VERSION_ID,
          sizeBytes,
          parts: Array.from({ length: parts }, (_, index) => ({
            partNumber: index + 1,
            eTag: "part-etag",
          })),
        }),
      );
      expect(mocked.prepareFirstVersionUploadAction).not.toHaveBeenCalled();
    },
  );
});
