import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep style tests (no jsdom) for the Phase 4 Upload Track modal.
// Mirrors the new-client-modal.test.tsx + invite-modal.test.tsx pattern:
// we read the .tsx source and assert structural invariants that would
// break the modal if drifted (Radix imports, field ids, Server Action
// usage, no forbidden CSS tokens).

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "upload-track-modal.tsx"), "utf-8");

describe("UploadTrackModal — Phase 4 upload entry point", () => {
  it("exports an UploadTrackModal component (function)", () => {
    expect(SRC).toMatch(/export function UploadTrackModal/);
  });

  it("is a client component", () => {
    expect(SRC).toMatch(/^["']use client["']/);
  });

  it("uses Radix Dialog Portal for portaling to body", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
    expect(SRC).toMatch(/Portal/);
  });

  it("declares contextual Library, Project, and Song upload props", () => {
    expect(SRC).toMatch(/open:\s*boolean/);
    expect(SRC).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    expect(SRC).toMatch(/projectId\?:\s*string/);
    expect(SRC).toMatch(
      /mode:\s*["']library["']\s*\|\s*["']new-song["']\s*\|\s*["']new-version["']/,
    );
    expect(SRC).toMatch(/tracks\?:\s*UploadTrackModalTrack\[\]/);
    expect(SRC).toMatch(/projects\?:\s*UploadTrackModalProject\[\]/);
    expect(SRC).toMatch(/onCreated\?:/);
    expect(SRC).toMatch(/trackId\?:\s*string/);
    expect(SRC).toMatch(/defaultLabel\?:\s*string/);
  });

  it("exports the UploadTrackModalTrack data type (id + title + versionCount)", () => {
    expect(SRC).toMatch(/export interface UploadTrackModalTrack/);
    expect(SRC).toMatch(/id:\s*string/);
    expect(SRC).toMatch(/title:\s*string/);
    expect(SRC).toMatch(/versionCount:\s*number/);
  });

  it("renders a song picker (select) for new-song mode and a locked label for new-version mode", () => {
    expect(SRC).toMatch(/id="upload-track-song"/);
    // locked-mode song display id
    expect(SRC).toMatch(/id="upload-track-song-locked"/);
  });

  it("renders the new-song name input when the picker is on '+ New song'", () => {
    expect(SRC).toMatch(/id="upload-track-new-song-name"/);
  });

  it("renders a required version label input", () => {
    expect(SRC).toMatch(/id="upload-track-label"/);
    expect(SRC).toMatch(/<input[\s\S]*?id="upload-track-label"[\s\S]*?required/);
  });

  it("renders an (optional) Advance-to-stage select with all 5 stages + 'No change'", () => {
    expect(SRC).toMatch(/id="upload-track-stage"/);
    expect(SRC).toContain("WORKFLOW_STAGES");
    expect(SRC).toContain("No change");
    expect(SRC).toMatch(/Advance\s*to\s*stage/);
  });

  it("renders an (optional) description textarea", () => {
    expect(SRC).toMatch(/id="upload-track-description"/);
    expect(SRC).toMatch(/<textarea[\s\S]*?id="upload-track-description"/);
  });

  // C2 — the description value must be threaded into staged finalization
  // so it lands on track_versions.description. Pre-fix the textarea was
  // pure UI: the user typed notes, hit Upload, and the value evaporated.
  it("forwards trimmed notes only when the staged upload is finalized", () => {
    expect(SRC).toContain("const submittedDescription = description.trim()");
    expect(SRC).toMatch(
      /finalizeAudioUploadAction\(\{[\s\S]*?\.\.\.\(submittedDescription \? \{ description: submittedDescription \} : \{\}\)/,
    );
  });

  it("advertises every supported audio extension to the native file picker", () => {
    expect(SRC).toMatch(/id="upload-track-file"/);
    const acceptValue = SRC.match(/id="upload-track-file"[\s\S]{0,200}?accept="([^"]+)"/)?.[1];
    expect(acceptValue?.split(",")).toEqual(
      expect.arrayContaining(["audio/*", ".mp3", ".m4a", ".wav", ".flac", ".aif", ".aiff"]),
    );
    expect(SRC).toContain("onDrop");
    expect(SRC).toContain("onDragOver");
  });

  it("loads and displays real producer storage usage when opened", () => {
    expect(SRC).toContain("getAudioStorageUsageAction");
    expect(SRC).toContain("storageUsage?.usedBytes");
    expect(SRC).toContain("storageUsage?.availableBytes");
    expect(SRC).toContain("After upload:");
  });

  it("offers explicit cleanup for full storage without deleting Songs or Versions", () => {
    expect(SRC).toContain("reconcileAudioStorageUsageAction");
    expect(SRC).toContain("Clean up old uploads");
    expect(SRC).toContain("It never removes");
    expect(SRC).toContain("Songs or Versions");
  });

  it("keeps only the modal's attached progress bar — no duplicate dock card", () => {
    expect(SRC).toContain("showInDock: false");
  });

  it("continues to authoritative completion after conditional PUT conflicts", () => {
    expect(SRC).toContain("putResponse.status !== 409");
    expect(SRC).toContain("putResponse.status !== 412");
    expect(SRC).toContain("managed.setReadyToSave()");
    expect(SRC).toContain("finalizeAudioUploadAction");
  });

  it("rejects files over the decimal 100 MB maximum in the browser", () => {
    expect(SRC).toContain("AUDIO_UPLOAD_MAX_BYTES");
    expect(SRC).toMatch(/nextFile\.size > AUDIO_UPLOAD_MAX_BYTES/);
    expect(SRC).toContain("Audio files can be up to 100 MB.");
  });

  it("disables a projected over-limit upload with deletion guidance", () => {
    expect(SRC).toContain("projectedStorageBytes");
    expect(SRC).toContain("storageLimitExceeded");
    expect(SRC).toContain("AUDIO_STORAGE_FULL_MESSAGE");
    expect(SRC).toMatch(/const submitDisabled =[\s\S]{0,220}?storageLimitExceeded/);
  });

  it("warns at the shared 800 MB threshold without blocking the upload", () => {
    expect(SRC).toContain("storageUsage.warningBytes");
    expect(SRC).toContain("storageWarningReached");
    expect(SRC).toContain("You're close to the 1 GB beta limit.");
  });

  // M1 — drag-and-drop scenarios (Finder, certain browsers) can hand
  // us a File with empty `type`. Fall back to an extension whitelist
  // so a correctly-named .wav / .flac / .m4a file isn't refused just
  // because the MIME hint is missing.
  it("accepts files with empty MIME via the audio-extension whitelist (M1)", () => {
    expect(SRC).toContain("AUDIO_EXTENSIONS");
    expect(SRC).toMatch(/\.wav/);
    expect(SRC).toMatch(/\.mp3/);
    expect(SRC).toMatch(/\.flac/);
    expect(SRC).toMatch(/\.m4a/);
    expect(SRC).toContain("isAudioFile");
  });

  it("renders an upload progress bar with role=progressbar", () => {
    expect(SRC).toMatch(/role=["']progressbar["']/);
    expect(SRC).toMatch(/aria-valuenow=\{progress\}/);
  });

  it("renders 'Upload' primary CTA + 'Cancel' secondary action", () => {
    expect(SRC).toContain("Upload");
    expect(SRC).toContain("Cancel");
  });

  // I2 — Cancel button used to be disabled mid-upload, but X and Escape
  // both fire handleClose (which aborts R2). Inconsistent. The button
  // now fires handleClose directly and re-labels to "Stop uploading"
  // during pending so the destructive action is honest.
  it("keeps the close action available during transfer and labels it honestly", () => {
    expect(SRC).not.toMatch(
      /onClick=\{handleClose\}[\s\S]{0,200}?disabled=\{transferStatus === "uploading"\}/,
    );
    expect(SRC).toContain('"Stop upload"');
  });

  it("uses one staged action contract for every upload destination", () => {
    expect(SRC).toContain("stageAudioUploadAction");
    expect(SRC).toContain("finalizeAudioUploadAction");
    expect(SRC).toContain("cancelStagedAudioUploadAction");
    expect(SRC).not.toContain("prepareFirstVersionUploadAction");
    expect(SRC).not.toContain("completeFirstVersionUploadAction");
    expect(SRC).not.toContain("cancelFirstVersionUploadAction");
    expect(SRC).not.toContain("addTrackAction");
    expect(SRC).not.toContain("addVersionAction");
    expect(SRC).not.toContain("initMultipartAction");
    expect(SRC).toContain("setTrackStageAction");
  });

  it("keeps purchase selection off the form and lets the server bind commercial access", () => {
    const submit = SRC.slice(SRC.indexOf("const handleSubmit"), SRC.indexOf("// Display label"));
    expect(submit).not.toContain("purchaseId");
    expect(SRC).toMatch(
      /finalizeAudioUploadAction\(\{[\s\S]*?kind: "new-song",[\s\S]*?projectId: submittedProjectId,[\s\S]*?title: submittedTitle/,
    );
    expect(SRC).not.toContain("No active purchase has an available song space");
  });

  it("retains the exact staged intent as cancellation authority until cleanup succeeds", () => {
    expect(SRC).toContain("activeStagedUploadRef");
    expect(SRC).toContain("operationKey: crypto.randomUUID()");
    expect(SRC).toContain("attempt.intentId = prepared.data.intentId");
    expect(SRC).toContain("cancelStagedAudioUploadAction({ intentId })");
    expect(SRC).toContain("if (!result.ok) return { ok: false, error: result.error }");
    expect(SRC).toContain("cancellationSucceeded = true");
    expect(SRC).toContain("managed.setTerminalDispose");
    expect(SRC).toContain("cancellationInFlight = null");
  });

  it("blocks offline submit and retry before allocating upload work", () => {
    expect(SRC).toContain("useOnlineStatus");
    expect(SRC).toContain("const online = useOnlineStatus()");
    expect(SRC).toMatch(/const submitDisabled =[\s\S]{0,220}?!online/);
    expect(SRC).toMatch(
      /async function startStagedAudioTransfer[\s\S]*?if \(blockOfflineUpload\(\)\)[\s\S]*?beginManagedUpload/,
    );
    expect(SRC).toContain("if (finalizing || blockOfflineUpload()) return");
    expect(SRC).toContain("if (blockOfflineUpload()) throw new Error(OFFLINE_UPLOAD_MESSAGE)");
    expect(SRC).toContain("if (blockOfflineUpload() || submitDisabled) return");
    expect(SRC).toContain(
      "Reconnect to upload. This attempt has not started; your file and form details remain here.",
    );
    expect(SRC).toMatch(
      /visibleUploadError = !online[\s\S]{0,80}?OFFLINE_UPLOAD_MESSAGE[\s\S]{0,220}?: uploadError/,
    );
    expect(SRC).toMatch(/role="alert"[\s\S]{0,180}?\{visibleUploadError\}/);
    expect(SRC).toContain('"Reconnect to upload"');
  });

  it("retires the exact staged intent before accepting a replacement file", () => {
    const filePick = SRC.slice(
      SRC.indexOf("const handleFilePick"),
      SRC.indexOf("const handleFileInputChange"),
    );
    expect(filePick).toMatch(
      /const previous = activeStagedUploadRef\.current[\s\S]*?await retireStagedUpload\(previous\)[\s\S]*?setFile\(nextFile\)/,
    );
    expect(SRC).toMatch(
      /async function retireStagedUpload[\s\S]*?await attempt\.cancel\(\)[\s\S]*?if \(!result\.ok\)[\s\S]*?return false/,
    );
  });

  it("binds cancellation to the staged file, intent, and transfer controller", () => {
    const activeUploadType = SRC.slice(
      SRC.indexOf("type ActiveStagedUpload"),
      SRC.indexOf("export function UploadTrackModal"),
    );
    expect(activeUploadType).toMatch(/file:\s*File/);
    expect(activeUploadType).toMatch(/operationKey:\s*string/);
    expect(activeUploadType).toMatch(/intentId:\s*string \| null/);
    expect(activeUploadType).toMatch(/putAbort:\s*AbortController/);
    expect(activeUploadType).toMatch(/cancel:\s*\(\) => Promise<StagedUploadCancellationResult>/);
  });

  it("keeps cancellation owned by the upload dock after the modal closes", () => {
    expect(SRC).toContain("managed.setCancel");
    expect(SRC).toContain("managed.setTerminalDispose");
    expect(SRC).toMatch(
      /const handleClose[\s\S]*?active\.abandonRequested = true[\s\S]*?cancelManagedUpload\(active\.managed\.id\)/,
    );
    expect(SRC).toMatch(
      /if \(managedCanceled\) return;[\s\S]*?await active\.cancel\(\)[\s\S]*?active\.managed\.dismiss\(\)/,
    );
  });

  it("creates no durable Song or Version before explicit finalization", () => {
    const transfer = SRC.slice(
      SRC.indexOf("async function startStagedAudioTransfer"),
      SRC.indexOf("// ─── File handlers"),
    );
    expect(transfer).toContain("stageAudioUploadAction");
    expect(transfer).not.toContain("finalizeAudioUploadAction");
    expect(transfer).not.toContain("addTrackAction");
    expect(transfer).not.toContain("addVersionAction");
    expect(SRC).toMatch(
      /const handleSubmit[\s\S]*?finalizeAudioUploadAction\(\{[\s\S]*?intentId: submittedIntentId/,
    );
  });

  it("checks cancellation before and after the direct R2 transfer", () => {
    const transfer = SRC.slice(
      SRC.indexOf("async function startStagedAudioTransfer"),
      SRC.indexOf("// ─── File handlers"),
    );
    const put = transfer.indexOf("putResponse = await fetch");
    const checks = [...transfer.matchAll(/uploadCancellationRequested\(cancellation\)/g)].map(
      (match) => match.index,
    );
    expect(checks.some((index) => index < put)).toBe(true);
    expect(checks.some((index) => index > put)).toBe(true);
    expect(transfer).toContain("putAbort.abort()");
  });

  it("imports Server Actions from the clients-projects upload-actions module", () => {
    expect(SRC).toMatch(/~\/app\/\(producer\)\/dashboard\/clients-projects\/upload-actions/);
  });

  it("does NOT use direct tRPC client mutations (Server Actions only)", () => {
    expect(SRC).not.toMatch(/useMutation/);
    expect(SRC).not.toMatch(/trpc\.\w+\.\w+\.\bmutate\b/);
  });

  it("uses fetch() for the presigned R2 PUT so the file stays in the browser", () => {
    expect(SRC).toMatch(/fetch\(/);
    expect(SRC).toMatch(/method:\s*["']PUT["']/);
    expect(SRC).toContain("body: stagedFile");
    expect(SRC).toContain("headers: prepared.data.headers");
  });

  it("does not create legacy client multipart placeholders", () => {
    expect(SRC).not.toContain("AUDIO_MULTIPART_PART_SIZE_BYTES");
    expect(SRC).not.toContain("initMultipartAction");
    expect(SRC).not.toContain("signPartAction");
    expect(SRC).not.toContain("completeMultipartAction");
  });

  it("leaves upload verification to staged finalization instead of browser ETags", () => {
    expect(SRC).not.toMatch(/headers\.get\(["']ETag["']\)/);
    expect(SRC).toContain("finalizeAudioUploadAction");
  });

  it("uses useTransition for the submit handler (pending state)", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("uses useToast for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']success["']\)/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']error["']\)/);
    expect(SRC).not.toMatch(
      /const message = error instanceof Error[\s\S]{0,180}?toast\(message, "error"\)[\s\S]{0,120}?setUploadError\(message\)/,
    );
    expect(SRC).not.toMatch(
      /const msg = err instanceof Error[\s\S]{0,180}?toast\(msg, "error"\)[\s\S]{0,120}?setUploadError\(msg\)/,
    );
  });

  it("calls router.refresh after a successful upload", () => {
    expect(SRC).toMatch(/router\.refresh/);
  });

  it("calls onCreated callback after a successful upload", () => {
    expect(SRC).toMatch(/onCreated\?\.\(\)/);
  });

  it("aborts mid-flight uploads on modal close (reclaims R2 storage)", () => {
    expect(SRC).toContain("active.putAbort.abort()");
    expect(SRC).toContain("cancelManagedUpload(active.managed.id)");
    expect(SRC).toContain("await active.cancel()");
  });

  it("keeps the close button usable when the focused field blurs", () => {
    expect(SRC).toMatch(/aria-label="Close"[\s\S]*?onPointerDown/);
    expect(SRC).toMatch(/event\.preventDefault\(\)[\s\S]*?handleClose\(\)/);
  });

  it("guards getDurationMs with a 3s timeout race so a malformed file can't hang the upload", () => {
    expect(SRC).toMatch(/Promise\.race/);
    expect(SRC).toMatch(/3000/);
  });

  it("auto-bumps the default label to uppercase V{versionCount+1} when picking an existing track", () => {
    expect(SRC).toMatch(/deriveNextLabel/);
    expect(SRC).toMatch(/versionCount/);
    expect(SRC).toContain('return "V1"');
    expect(SRC).toMatch(/return `V\$\{String\(next\)\}`/);
    expect(SRC).toContain('defaultLabel ?? "V1"');
  });

  it("uses backdrop-blur on the scrim (matches NewClientModal precedent)", () => {
    expect(SRC).toMatch(/backdrop-blur/);
  });

  it("applies centering translations only from the desktop breakpoint", () => {
    expect(SRC).toMatch(/sk-sheet-mobile[^"]*md:-translate-x-1\/2[^"]*md:-translate-y-1\/2/);
    expect(SRC).not.toMatch(/\s-translate-[xy]-1\/2(?:\s|")/);
  });

  it("keeps the actions outside the independently scrollable form body", () => {
    expect(SRC).toMatch(
      /DialogPrimitive\.Content[\s\S]*?className="[^"]*flex[^"]*flex-col[^"]*overflow-hidden[^"]*p-0/,
    );
    expect(SRC).toMatch(/<form[^>]*className="[^"]*min-h-0[^"]*flex-1[^"]*flex-col/);
    expect(SRC).toMatch(
      /className="[^"]*min-h-0[^"]*flex-1[^"]*overflow-y-auto[^"]*overscroll-contain/,
    );
    expect(SRC).toMatch(/className="[^"]*shrink-0[^"]*border-t/);
    expect(SRC).not.toContain("sticky bottom-0");
  });

  it("shows the upload choice only when more than one destination is available", () => {
    expect(SRC).toContain('id="upload-track-project-empty"');
    expect(SRC).toContain("No Projects available for audio upload");
    expect(SRC).toContain("shouldShowLibraryUploadDestination");
    expect(SRC).toContain("Upload as");
    expect(SRC).not.toContain('id="upload-track-destination-locked"');
  });

  it("forbids --surface-card", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids --text-muted", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids --text-strong", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids --surface-hover", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids --brand-primary-on", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
