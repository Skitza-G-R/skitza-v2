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
  initMultipartAction: vi.fn(),
  setTrackStageAction: vi.fn(),
  signPartAction: vi.fn(),
  beginManagedUpload: vi.fn(),
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
  mocked.beginManagedUpload.mockReturnValue({
    id: "managed-first",
    dismiss: vi.fn(),
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
    mocked.prepareFirstVersionUploadAction.mockImplementation(
      (input: { operationKey: string }) => {
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
      },
    );
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
