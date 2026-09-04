// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  router: { refresh: vi.fn(), replace: vi.fn() },
  toast: vi.fn(),
  stageAudioUploadAction: vi.fn(),
  finalizeAudioUploadAction: vi.fn(),
  cancelStagedAudioUploadAction: vi.fn(),
  addTrackAction: vi.fn(),
  addVersionAction: vi.fn(),
  initMultipartAction: vi.fn(),
  getAudioStorageUsageAction: vi.fn(),
  reconcileAudioStorageUsageAction: vi.fn(),
  setTrackStageAction: vi.fn(),
  beginManagedUpload: vi.fn(),
  cancelManagedUpload: vi.fn(),
  managedDismiss: vi.fn(),
  managedFail: vi.fn(),
  managedSetCancel: vi.fn(),
  managedSetCompleting: vi.fn(),
  managedSetPreparing: vi.fn(),
  managedSetReadyToSave: vi.fn(),
  managedSetRetry: vi.fn(),
  managedSetTerminalDispose: vi.fn(),
  managedSetUploading: vi.fn(),
  managedSucceed: vi.fn(),
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
  usePathname: () => "/dashboard/music",
  useRouter: () => mocked.router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocked.toast }),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/upload-actions", () => ({
  stageAudioUploadAction: mocked.stageAudioUploadAction,
  finalizeAudioUploadAction: mocked.finalizeAudioUploadAction,
  cancelStagedAudioUploadAction: mocked.cancelStagedAudioUploadAction,
  getAudioStorageUsageAction: mocked.getAudioStorageUsageAction,
  reconcileAudioStorageUsageAction: mocked.reconcileAudioStorageUsageAction,
  setTrackStageAction: mocked.setTrackStageAction,
  // These legacy actions intentionally remain available to prove the modal
  // does not create placeholder Songs or Versions before finalization.
  addTrackAction: mocked.addTrackAction,
  addVersionAction: mocked.addVersionAction,
  initMultipartAction: mocked.initMultipartAction,
}));

vi.mock("~/lib/audio/use-multipart-upload", () => ({
  createUploadCancellationRequest: vi.fn(() => ({ requested: false })),
  requestUploadCancellation: vi.fn((request: { requested: boolean }) => {
    request.requested = true;
  }),
  uploadCancellationRequested: vi.fn((request: { requested: boolean }) => request.requested),
}));

vi.mock("~/lib/audio/upload-manager", () => ({
  beginManagedUpload: mocked.beginManagedUpload,
  cancelManagedUpload: mocked.cancelManagedUpload,
}));

import { UploadTrackModal, type UploadTrackModalProps } from "../upload-track-modal";
import { AUDIO_STORAGE_FULL_MESSAGE } from "~/lib/audio/storage-limits";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const INTENT_ID = "44444444-4444-4444-8444-444444444444";
const REPLACEMENT_INTENT_ID = "55555555-5555-4555-8555-555555555555";

const STORAGE_USAGE = {
  usedBytes: 200_000_000,
  reservedBytes: 0,
  committedBytes: 200_000_000,
  availableBytes: 800_000_000,
  limitBytes: 1_000_000_000,
  warningBytes: 800_000_000,
  isAtOrAboveWarning: false,
  isFull: false,
};

const FULL_STORAGE_USAGE = {
  usedBytes: 1_000_000_000,
  reservedBytes: 0,
  committedBytes: 1_000_000_000,
  availableBytes: 0,
  limitBytes: 1_000_000_000,
  warningBytes: 800_000_000,
  isAtOrAboveWarning: true,
  isFull: true,
};

const RESERVED_FULL_STORAGE_USAGE = {
  ...FULL_STORAGE_USAGE,
  reservedBytes: 100_000_000,
  committedBytes: 900_000_000,
};

function stagedUploadReady(intentId = INTENT_ID, versionId = VERSION_ID) {
  return {
    ok: true as const,
    data: {
      status: "ready" as const,
      intentId,
      versionId,
      uploadUrl: "https://upload.example.test/staged-audio",
      headers: {
        "Content-Type": "audio/flac",
        "x-amz-meta-skitza-upload-token": "a".repeat(64),
      },
      expiresInSeconds: 900,
    },
  };
}

function successfulCancellation() {
  return {
    ok: true as const,
    data: { ok: true as const, completed: false as const },
  };
}

function successfulPut(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function Harness({
  onClosed = vi.fn(),
  mode = "new-song",
  songLyrics,
  onSaveLyrics,
  hasLyrics,
}: {
  onClosed?: () => void;
  mode?: "new-song" | "new-version";
  songLyrics?: { text: string | null; updatedAtIso: string | null };
  onSaveLyrics?: UploadTrackModalProps["onSaveLyrics"];
  hasLyrics?: boolean;
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
        mode === "new-version"
          ? [
              {
                id: TRACK_ID,
                title: "Existing Song",
                versionCount: 1,
                ...(hasLyrics === undefined ? {} : { hasLyrics }),
              },
            ]
          : []
      }
      {...(songLyrics === undefined ? {} : { songLyrics })}
      {...(onSaveLyrics === undefined ? {} : { onSaveLyrics })}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getAudioStorageUsageAction.mockResolvedValue({ ok: true, data: STORAGE_USAGE });
  mocked.reconcileAudioStorageUsageAction.mockResolvedValue({ ok: true, data: STORAGE_USAGE });
  mocked.stageAudioUploadAction.mockResolvedValue(stagedUploadReady());
  mocked.finalizeAudioUploadAction.mockResolvedValue({
    ok: true,
    data: {
      projectId: PROJECT_ID,
      trackId: TRACK_ID,
      versionId: VERSION_ID,
      url: "/api/audio/versions/" + VERSION_ID,
    },
  });
  mocked.cancelStagedAudioUploadAction.mockResolvedValue(successfulCancellation());
  mocked.cancelManagedUpload.mockResolvedValue(false);
  mocked.beginManagedUpload.mockReturnValue({
    id: "managed-staged-audio",
    dismiss: mocked.managedDismiss,
    fail: mocked.managedFail,
    setCancel: mocked.managedSetCancel,
    setCompleting: mocked.managedSetCompleting,
    setPreparing: mocked.managedSetPreparing,
    setReadyToSave: mocked.managedSetReadyToSave,
    setRetry: mocked.managedSetRetry,
    setTerminalDispose: mocked.managedSetTerminalDispose,
    setUploading: mocked.managedSetUploading,
    succeed: mocked.managedSucceed,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulPut()));
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

describe("staged audio upload journey", () => {
  it("starts a supported non-MP3 transfer on file selection without durable finalization", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const file = new File([new Uint8Array([0])], "rough-mix.flac", {
      type: "audio/flac",
    });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);

    await waitFor(() => {
      expect(mocked.stageAudioUploadAction).toHaveBeenCalledOnce();
      expect(mocked.stageAudioUploadAction.mock.calls[0]?.[0]).toMatchObject({
        filename: "rough-mix.flac",
        sizeBytes: file.size,
        contentType: "audio/flac",
      });
      expect(
        typeof (
          mocked.stageAudioUploadAction.mock.calls[0]?.[0] as { operationKey?: unknown } | undefined
        )?.operationKey,
      ).toBe("string");
    });
    expect(screen.getByLabelText<HTMLInputElement>(/^Song title/).disabled).toBe(false);
    expect(mocked.finalizeAudioUploadAction).not.toHaveBeenCalled();
    expect(mocked.addTrackAction).not.toHaveBeenCalled();
    expect(mocked.addVersionAction).not.toHaveBeenCalled();
  });

  it("keeps metadata editable while the selected audio is still transferring", async () => {
    const put = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(put.promise);
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "deferred-transfer.m4a", { type: "audio/mp4" }),
    );
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });

    const title = screen.getByLabelText<HTMLInputElement>(/^Song title/);
    expect(title.disabled).toBe(false);
    await user.type(title, "Editable During Transfer");
    expect(title.value).toBe("Editable During Transfer");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Uploading audio…" }).disabled,
    ).toBe(true);
    expect(mocked.finalizeAudioUploadAction).not.toHaveBeenCalled();

    await act(async () => {
      put.resolve(successfulPut());
      await put.promise;
    });

    expect(await screen.findByText("Audio ready — finish the details, then save.")).not.toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(/^Song title/).value).toBe(
      "Editable During Transfer",
    );
  });

  it("finalizes the staged intent only after the producer submits the ready form", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const file = new File([new Uint8Array([0])], "first-version.aiff", {
      type: "audio/aiff",
    });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    expect(await screen.findByText("Audio ready — finish the details, then save.")).not.toBeNull();
    expect(mocked.finalizeAudioUploadAction).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText<HTMLInputElement>(/^Song title/), "Finished Details");

    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Create Song" });
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    await user.click(submit);

    await waitFor(() => {
      expect(mocked.finalizeAudioUploadAction).toHaveBeenCalledWith({
        intentId: INTENT_ID,
        destination: {
          kind: "new-song",
          projectId: PROJECT_ID,
          title: "Finished Details",
        },
        label: "V1",
        acknowledgePublicExposure: false,
      });
    });
    expect(mocked.addTrackAction).not.toHaveBeenCalled();
    expect(mocked.addVersionAction).not.toHaveBeenCalled();
    expect(mocked.router.refresh).toHaveBeenCalledOnce();
    expect(mocked.router.replace).toHaveBeenCalledWith("/dashboard/music/" + VERSION_ID);
  });

  it("keeps a ready server-reserved intent finalizable when refreshed usage is full", async () => {
    const usage = deferred<{
      ok: true;
      data: typeof RESERVED_FULL_STORAGE_USAGE;
    }>();
    mocked.getAudioStorageUsageAction.mockReturnValueOnce(usage.promise);
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "reserved.flac", { type: "audio/flac" }),
    );
    expect(await screen.findByText("Audio ready — finish the details, then save.")).not.toBeNull();
    await user.type(screen.getByLabelText<HTMLInputElement>(/^Song title/), "Reserved Upload");
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Create Song" });
    expect(submit.disabled).toBe(true);

    await act(async () => {
      usage.resolve({ ok: true, data: RESERVED_FULL_STORAGE_USAGE });
      await usage.promise;
    });

    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    expect(screen.queryByText(AUDIO_STORAGE_FULL_MESSAGE)).toBeNull();
    await user.click(submit);
    await waitFor(() => {
      expect(mocked.finalizeAudioUploadAction).toHaveBeenCalledWith(
        expect.objectContaining({ intentId: INTENT_ID }),
      );
    });
  });

  it("keeps finalization blocked when quota rejects staging before a reservation exists", async () => {
    mocked.getAudioStorageUsageAction
      .mockResolvedValueOnce({ ok: true, data: STORAGE_USAGE })
      .mockResolvedValueOnce({ ok: true, data: FULL_STORAGE_USAGE });
    mocked.stageAudioUploadAction.mockResolvedValueOnce({
      ok: false,
      error: AUDIO_STORAGE_FULL_MESSAGE,
    });
    const user = userEvent.setup();
    render(<Harness />);
    expect(await screen.findByText("200 MB")).not.toBeNull();

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "quota-rejected.flac", { type: "audio/flac" }),
    );

    await waitFor(() => {
      expect(mocked.getAudioStorageUsageAction).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(AUDIO_STORAGE_FULL_MESSAGE)).not.toBeNull();
    await user.type(screen.getByLabelText<HTMLInputElement>(/^Song title/), "Blocked Upload");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Create Song" }).disabled).toBe(
      true,
    );
    expect(mocked.finalizeAudioUploadAction).not.toHaveBeenCalled();
  });

  it("finalizes a new Version without placeholder creation and replaces the exact returned route", async () => {
    const user = userEvent.setup();
    render(<Harness mode="new-version" />);
    const file = new File([new Uint8Array([0])], "next-version.flac", {
      type: "audio/flac",
    });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    expect(await screen.findByText("Audio ready — finish the details, then save.")).not.toBeNull();
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Add Version" });
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    await user.click(submit);

    await waitFor(() => {
      expect(mocked.finalizeAudioUploadAction).toHaveBeenCalledWith({
        intentId: INTENT_ID,
        destination: {
          kind: "new-version",
          projectId: PROJECT_ID,
          trackId: TRACK_ID,
        },
        label: "V2",
        acknowledgePublicExposure: false,
      });
    });
    expect(mocked.addVersionAction).not.toHaveBeenCalled();
    expect(mocked.initMultipartAction).not.toHaveBeenCalled();
    expect(mocked.router.refresh).toHaveBeenCalledOnce();
    expect(mocked.router.replace).toHaveBeenCalledWith("/dashboard/music/" + VERSION_ID);
  });

  it("retires the exact failed intent before a dock retry allocates a fresh stage", async () => {
    mocked.stageAudioUploadAction
      .mockResolvedValueOnce(stagedUploadReady(INTENT_ID))
      .mockResolvedValueOnce(stagedUploadReady(REPLACEMENT_INTENT_ID));
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(successfulPut());
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "retry-me.flac", { type: "audio/flac" }),
    );
    await waitFor(() => {
      expect(mocked.managedFail).toHaveBeenCalledWith(
        "Audio transfer failed. Check your connection and try again.",
      );
    });

    const retry = mocked.managedSetRetry.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
    expect(retry).toBeTypeOf("function");
    await retry?.();

    await waitFor(() => {
      expect(mocked.cancelStagedAudioUploadAction).toHaveBeenCalledWith({
        intentId: INTENT_ID,
      });
      expect(mocked.stageAudioUploadAction).toHaveBeenCalledTimes(2);
    });
    expect(mocked.cancelStagedAudioUploadAction.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.stageAudioUploadAction.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocked.stageAudioUploadAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ filename: "retry-me.flac" }),
    );
  });

  it("retains exact staged cancellation for dock cleanup when modal-close cleanup fails", async () => {
    mocked.cancelStagedAudioUploadAction
      .mockResolvedValueOnce({ ok: false, error: "Cancellation is temporarily unavailable" })
      .mockResolvedValueOnce(successfulCancellation());
    const onClosed = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClosed={onClosed} />);

    await user.upload(
      screen.getByLabelText<HTMLInputElement>(/^Audio file/),
      new File([new Uint8Array([0])], "close-me.flac", { type: "audio/flac" }),
    );
    expect(await screen.findByText("Audio ready — finish the details, then save.")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClosed).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(mocked.cancelManagedUpload).toHaveBeenCalledWith("managed-staged-audio");
      expect(mocked.cancelStagedAudioUploadAction).toHaveBeenCalledWith({
        intentId: INTENT_ID,
      });
    });
    expect(mocked.finalizeAudioUploadAction).not.toHaveBeenCalled();

    const retry = mocked.managedSetRetry.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
    expect(retry).toBeTypeOf("function");
    await retry?.();
    expect(mocked.cancelStagedAudioUploadAction).toHaveBeenCalledTimes(2);
    expect(mocked.cancelStagedAudioUploadAction).toHaveBeenLastCalledWith({
      intentId: INTENT_ID,
    });
    expect(mocked.managedDismiss).toHaveBeenCalledOnce();
    expect(mocked.stageAudioUploadAction).toHaveBeenCalledOnce();
  });

  it("keeps the selected file and exact staged intent when replacement cancellation fails", async () => {
    mocked.stageAudioUploadAction
      .mockResolvedValueOnce(stagedUploadReady(INTENT_ID))
      .mockResolvedValueOnce(stagedUploadReady(REPLACEMENT_INTENT_ID));
    mocked.cancelStagedAudioUploadAction
      .mockResolvedValueOnce({ ok: false, error: "Cancellation is temporarily unavailable" })
      .mockResolvedValueOnce(successfulCancellation());
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText<HTMLInputElement>(/^Audio file/);

    await user.upload(
      input,
      new File([new Uint8Array([0])], "original.flac", { type: "audio/flac" }),
    );
    expect(await screen.findByText("Audio ready — finish the details, then save.")).not.toBeNull();

    await user.upload(
      input,
      new File([new Uint8Array([1])], "replacement.flac", { type: "audio/flac" }),
    );
    expect(await screen.findByText("Cancellation is temporarily unavailable")).not.toBeNull();
    expect(mocked.cancelStagedAudioUploadAction).toHaveBeenCalledWith({
      intentId: INTENT_ID,
    });
    expect(mocked.stageAudioUploadAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("original.flac")).not.toBeNull();
    expect(screen.queryByText("replacement.flac")).toBeNull();

    await user.upload(
      input,
      new File([new Uint8Array([2])], "replacement.flac", { type: "audio/flac" }),
    );
    await waitFor(() => {
      expect(mocked.cancelStagedAudioUploadAction).toHaveBeenCalledTimes(2);
      expect(mocked.stageAudioUploadAction).toHaveBeenCalledTimes(2);
    });
    expect(mocked.cancelStagedAudioUploadAction).toHaveBeenLastCalledWith({
      intentId: INTENT_ID,
    });
    expect(screen.getByText("replacement.flac")).not.toBeNull();
    expect(mocked.finalizeAudioUploadAction).not.toHaveBeenCalled();
  });

  it("rejects files above 100 MB before creating a staged intent", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const oversized = new File([new Uint8Array([0])], "too-large.wav", {
      type: "audio/wav",
    });
    Object.defineProperty(oversized, "size", { value: 100_000_001 });

    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), oversized);

    expect(await screen.findByText("Audio files can be up to 100 MB.")).not.toBeNull();
    expect(mocked.stageAudioUploadAction).not.toHaveBeenCalled();
    expect(mocked.finalizeAudioUploadAction).not.toHaveBeenCalled();
  });
});

// ─── SK-305 lyrics field ─────────────────────────────────────────────

describe("SK-305 lyrics in the upload modal", () => {
  const SHEET_STAMP = "2026-09-03T10:00:00.000Z";
  const lyricsField = () => document.querySelector('[data-test="upload-lyrics-field"]');
  const lyricsToggle = () =>
    document.querySelector<HTMLButtonElement>('[data-test="upload-lyrics-toggle"]');
  const lyricsBadge = () => document.querySelector<HTMLElement>('[data-test="upload-lyrics-badge"]');

  async function uploadAndSave(user: ReturnType<typeof userEvent.setup>) {
    const file = new File([new Uint8Array([0])], "v2.aiff", { type: "audio/aiff" });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    expect(await screen.findByText("Audio ready — finish the details, then save.")).not.toBeNull();
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: /Save|Add Version/ });
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    await user.click(submit);
  }

  it("stays out of the collapsed Stage and notes drawer", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mode="new-version"
        songLyrics={{ text: null, updatedAtIso: null }}
        onSaveLyrics={vi.fn(() => Promise.resolve({ ok: true as const }))}
      />,
    );
    const file = new File([new Uint8Array([0])], "v2.aiff", { type: "audio/aiff" });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);

    const field = lyricsField();
    expect(field).not.toBeNull();
    // The drawer beside it already hides a field nothing renders. Burying this
    // one there would make it just as invisible.
    expect(field?.closest("details")).toBeNull();
  });

  it("arrives pre-filled when the song page already holds the sheet", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mode="new-version"
        songLyrics={{ text: "one\ntwo\nthree", updatedAtIso: SHEET_STAMP }}
        onSaveLyrics={vi.fn(() => Promise.resolve({ ok: true as const }))}
      />,
    );
    const file = new File([new Uint8Array([0])], "v2.aiff", { type: "audio/aiff" });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);

    expect(lyricsBadge()?.textContent).toBe("3 lines");
    await user.click(lyricsToggle() as HTMLElement);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Lyrics").value).toBe("one\ntwo\nthree");
  });

  it("goes read-only for a library upload into a song that already has words", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mode="new-version"
        hasLyrics
        onSaveLyrics={vi.fn(() => Promise.resolve({ ok: true as const }))}
      />,
    );
    const file = new File([new Uint8Array([0])], "v2.aiff", { type: "audio/aiff" });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);

    expect(lyricsBadge()?.textContent).toBe("already written");
    expect(lyricsToggle()?.disabled).toBe(true);
    expect(screen.queryByLabelText("Lyrics")).toBeNull();
  });

  it("saves the words after the audio, never inside its payload", async () => {
    const user = userEvent.setup();
    const onSaveLyrics = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <Harness
        mode="new-version"
        songLyrics={{ text: "old", updatedAtIso: SHEET_STAMP }}
        onSaveLyrics={onSaveLyrics}
      />,
    );
    const file = new File([new Uint8Array([0])], "v2.aiff", { type: "audio/aiff" });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    await user.click(lyricsToggle() as HTMLElement);
    await user.type(screen.getByLabelText("Lyrics"), " and new");

    const submit = screen.getByRole<HTMLButtonElement>("button", { name: /Save|Add Version/ });
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    await user.click(submit);

    await waitFor(() => {
      expect(onSaveLyrics).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        trackId: TRACK_ID,
        lyrics: "old and new",
        expectedUpdatedAtIso: SHEET_STAMP,
      });
    });
    // The guarded upload payload is untouched. SK-302 added one field to a
    // payload like this with no migration and every booking rolled back.
    const payload = mocked.finalizeAudioUploadAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain("lyrics");
  });

  it("does not touch the sheet when the words were never edited", async () => {
    const user = userEvent.setup();
    const onSaveLyrics = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <Harness
        mode="new-version"
        songLyrics={{ text: "untouched", updatedAtIso: SHEET_STAMP }}
        onSaveLyrics={onSaveLyrics}
      />,
    );
    await uploadAndSave(user);

    await waitFor(() => {
      expect(mocked.finalizeAudioUploadAction).toHaveBeenCalled();
    });
    // Opening the field must never stamp the song as "updated by you just now".
    expect(onSaveLyrics).not.toHaveBeenCalled();
  });

  it("keeps the upload successful when the lyrics clash", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mode="new-version"
        songLyrics={{ text: "mine", updatedAtIso: SHEET_STAMP }}
        onSaveLyrics={vi.fn(() =>
          Promise.resolve({ ok: false as const, reason: "stale" as const }),
        )}
      />,
    );
    const file = new File([new Uint8Array([0])], "v2.aiff", { type: "audio/aiff" });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    await user.click(lyricsToggle() as HTMLElement);
    await user.type(screen.getByLabelText("Lyrics"), "!");

    const submit = screen.getByRole<HTMLButtonElement>("button", { name: /Save|Add Version/ });
    await waitFor(() => {
      expect(submit.disabled).toBe(false);
    });
    await user.click(submit);

    await waitFor(() => {
      expect(mocked.toast).toHaveBeenCalledWith(
        "Version saved. Lyrics unchanged — someone else edited them while you uploaded.",
        "error",
      );
    });
    // The audio is what matters. It landed, and the modal reports success.
    expect(mocked.router.refresh).toHaveBeenCalled();
  });

  it("shows no lyrics field at all when the caller cannot save them", async () => {
    const user = userEvent.setup();
    render(<Harness mode="new-version" />);
    const file = new File([new Uint8Array([0])], "v2.aiff", { type: "audio/aiff" });
    await user.upload(screen.getByLabelText<HTMLInputElement>(/^Audio file/), file);
    expect(lyricsField()).toBeNull();
  });
});
