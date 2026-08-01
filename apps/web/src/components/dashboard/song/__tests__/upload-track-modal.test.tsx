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

  // C2 — the description value must be threaded into addVersionAction
  // so it lands on track_versions.description. Pre-fix the textarea was
  // pure UI: the user typed notes, hit Upload, and the value evaporated.
  it("forwards the trimmed description into addVersionAction (only when non-empty)", () => {
    // We trim before forwarding so a textarea full of whitespace stays
    // NULL rather than storing "   ".
    expect(SRC).toMatch(/description\.trim\(\)/);
    // The action call must include a `description:` key under the
    // conditional spread that drops it when empty.
    expect(SRC).toMatch(/description:\s*trimmedDescription/);
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
  it("Cancel button stays clickable during pending state (fires handleClose)", () => {
    // The Cancel button must NOT carry `disabled={pending}` — the same
    // handler that X uses needs to fire mid-upload to abort R2.
    expect(SRC).not.toMatch(/onClick=\{handleClose\}[\s\S]{0,200}?disabled=\{pending\}/);
    // Label flips to "Stop uploading" during pending.
    expect(SRC).toMatch(/Stop\s+uploading/);
  });

  it("uses atomic V1 actions and preserves the hardened V2+ multipart actions", () => {
    expect(SRC).toContain("prepareFirstVersionUploadAction");
    expect(SRC).toContain("completeFirstVersionUploadAction");
    expect(SRC).toContain("cancelFirstVersionUploadAction");
    expect(SRC).not.toContain("addTrackAction");
    expect(SRC).toContain("addVersionAction");
    expect(SRC).toContain("initMultipartAction");
    expect(SRC).toContain("signPartAction");
    expect(SRC).toContain("completeMultipartAction");
    expect(SRC).toContain("abortMultipartAction");
    expect(SRC).toContain("setTrackStageAction");
    // I1 — orphan cleanup on upload failure.
    expect(SRC).toContain("deleteVersionAction");
  });

  it("keeps purchase selection off the form and lets the server bind commercial access", () => {
    expect(SRC).not.toMatch(/purchaseId,[\s\S]{0,120}prepareFirstVersionUploadAction/);
    expect(SRC).toMatch(
      /prepareFirstVersionUploadAction\(\{[\s\S]*?projectId:\s*selectedProjectId,[\s\S]*?title:\s*newSongName\.trim\(\),[\s\S]*?label:\s*["']V1["']/,
    );
    expect(SRC).not.toContain("No active purchase has an available song space");
  });

  it("reuses an intent operation key for retry and cancels the exact intent on close", () => {
    expect(SRC).toContain("firstVersionOperationKeyRef");
    expect(SRC).toContain("operationKey: firstVersionOperationKeyRef.current");
    expect(SRC).toContain("activeFirstVersionIntentRef.current = intentId");
    expect(SRC).toMatch(
      /const firstVersionIntentId = activeFirstVersionIntentRef\.current;[\s\S]*?cancelFirstVersionUploadAction\(\{ intentId: firstVersionIntentId \}\)/,
    );
    expect(SRC).toMatch(
      /completeFirstVersionUploadAction\(\{ intentId \}\)[\s\S]*?activeFirstVersionIntentRef\.current = null/,
    );
    expect(SRC).not.toContain("allocatedNewTrackIdRef");
  });

  it("blocks offline submit and retry before allocating upload work", () => {
    expect(SRC).toContain("useOnlineStatus");
    expect(SRC).toContain("const online = useOnlineStatus()");
    expect(SRC).toMatch(/const submitDisabled =[\s\S]{0,120}?!online/);

    const submitStart = SRC.indexOf("const handleSubmit");
    const uploadStart = SRC.indexOf("function startUpload", submitStart);
    const handleSubmit = SRC.slice(submitStart, uploadStart);
    expect(handleSubmit.indexOf("blockOfflineUpload()")).toBeGreaterThanOrEqual(0);
    expect(handleSubmit.indexOf("blockOfflineUpload()")).toBeLessThan(
      handleSubmit.indexOf("submitDisabled"),
    );

    const upload = SRC.slice(uploadStart, SRC.indexOf("// Display label", uploadStart));
    const firstOfflineGate = upload.indexOf("if (blockOfflineUpload()) return;");
    expect(firstOfflineGate).toBeGreaterThanOrEqual(0);
    for (const allocation of [
      "requireUploadRuntimeAccountId()",
      "beginManagedUpload(",
      "addVersionAction(",
      "initMultipartAction(",
    ]) {
      expect(firstOfflineGate).toBeLessThan(upload.indexOf(allocation));
    }

    const retryStart = upload.indexOf("managed.setRetry");
    const retryEnd = upload.indexOf("startTransition", retryStart);
    const retry = upload.slice(retryStart, retryEnd);
    expect(retry).toContain("if (blockOfflineUpload())");
    expect(retry).toContain("Promise.reject(new Error(OFFLINE_UPLOAD_MESSAGE))");
    expect(retry.indexOf("blockOfflineUpload()")).toBeLessThan(retry.indexOf("managed.dismiss()"));

    expect(SRC).toContain(
      "Reconnect to upload. This attempt has not started; your file and form details remain here.",
    );
    expect(SRC).toMatch(/visibleUploadError = !online \? OFFLINE_UPLOAD_MESSAGE : uploadError/);
    expect(SRC).toMatch(/role="alert"[\s\S]{0,180}?\{visibleUploadError\}/);
    expect(SRC).toMatch(/pending \? "Uploading…" : !online \? "Reconnect to upload" : "Upload"/);
  });

  // I1 — on upload failure, the modal must cleanup the orphan
  // track_versions row created at step 2 of the chain. R2 multipart
  // abort happens for storage cleanup, but the DB row stayed forever
  // before this fix.
  it("finishes exact multipart cancellation before deleting the ghost version", () => {
    expect(SRC).toMatch(/createdVersionId/);
    expect(SRC).toMatch(
      /await requestExactMultipartCancellation\(active, abortMultipartAction\)[\s\S]*?await requestVersionCleanup\(versionCleanup, deleteVersionAction\)/,
    );
    expect(SRC).not.toMatch(/void requestVersionCleanup/);
  });

  it("binds every abort to the exact persisted upload identity", () => {
    const activeUploadType = SRC.slice(
      SRC.indexOf("type ActiveMultipartUpload"),
      SRC.indexOf("export function UploadTrackModal"),
    );
    expect(activeUploadType).toMatch(/key:\s*string/);
    expect(activeUploadType).toMatch(/uploadId:\s*string/);
    expect(activeUploadType).toMatch(/trackVersionId:\s*string/);
    expect(activeUploadType).toMatch(/sizeBytes:\s*number/);
    expect(activeUploadType).toMatch(/completionToken:\s*string/);
    expect(SRC).toMatch(
      /const recoveryEntry[\s\S]*?key,[\s\S]*?uploadId,[\s\S]*?trackVersionId:\s*versionId,[\s\S]*?sizeBytes:\s*submittedFile\.size,[\s\S]*?completionToken/,
    );
  });

  it("durably owns exact cancellation and orphan cleanup across unmounts", () => {
    expect(SRC).toContain("startMultipartCancellationRecovery");
    expect(SRC).toMatch(/useEffect\(\(\) => startMultipartCancellationRecovery\(\), \[\]\)/);
    const initSuccess = SRC.indexOf("if (!ires.ok)");
    const persistExact = SRC.indexOf("persistResumableEntry(recoveryEntry)", initSuccess);
    const firstSign = SRC.indexOf("signPartAction", initSuccess);
    expect(persistExact).toBeGreaterThan(initSuccess);
    expect(persistExact).toBeLessThan(firstSign);
    expect(SRC).toMatch(
      /markVersionCleanupRequested\(\s*createdVersionId,\s*new Date\(\),\s*uploadAccountId,?\s*\)/,
    );
    expect(SRC).toContain("requestExactMultipartCancellation(active, abortMultipartAction)");
    expect(SRC).toContain("await requestVersionCleanup(versionCleanup, deleteVersionAction)");
  });

  it("keeps ambiguous init cleanup durable until deleteVersion confirms success", () => {
    const catchStart = SRC.indexOf("} catch (err) {");
    const catchSource = SRC.slice(catchStart, SRC.indexOf("// Display label", catchStart));
    const persistCleanup = catchSource.search(
      /markVersionCleanupRequested\(\s*createdVersionId,\s*new Date\(\),\s*uploadAccountId,?\s*\)/,
    );
    const cleanupAttempt = catchSource.indexOf("requestVersionCleanup(", persistCleanup);
    expect(persistCleanup).toBeGreaterThanOrEqual(0);
    expect(cleanupAttempt).toBeGreaterThan(persistCleanup);
    expect(catchSource).not.toContain("createdVersionId = null");
  });

  it("persists placeholder cleanup before multipart init and clears it only after attach", () => {
    const versionCreated = SRC.indexOf("if (!vres.ok)");
    const cleanupPersistedOffset = SRC.slice(versionCreated).search(
      /versionCleanup = markVersionCleanupRequested\(\s*versionId,\s*new Date\(\),\s*uploadAccountId,?\s*\)/,
    );
    const cleanupPersisted =
      cleanupPersistedOffset < 0 ? -1 : versionCreated + cleanupPersistedOffset;
    const initStarted = SRC.indexOf("await initMultipartAction", versionCreated);
    expect(cleanupPersisted).toBeGreaterThan(versionCreated);
    expect(cleanupPersisted).toBeLessThan(initStarted);

    const attachConfirmed = SRC.indexOf("if (!cres.ok)");
    const cleanupRemovedOffset = SRC.slice(attachConfirmed).search(
      /removeVersionCleanupEntry\(\s*versionId,\s*uploadAccountId\s*\)/,
    );
    const cleanupRemoved = cleanupRemovedOffset < 0 ? -1 : attachConfirmed + cleanupRemovedOffset;
    expect(cleanupRemoved).toBeGreaterThan(attachConfirmed);
  });

  it("records Stop uploading during multipart init and cancels before any part or completion", () => {
    const submitStart = SRC.indexOf("const handleSubmit");
    const submit = SRC.slice(submitStart, SRC.indexOf("// Display label", submitStart));
    const init = submit.indexOf("await initMultipartAction");
    const cancellationCheck = submit.indexOf("cancelInitializedUploadIfRequested", init);
    const firstPart = submit.indexOf("await signPartAction", init);
    const completion = submit.indexOf("await completeMultipartAction", init);
    const close = SRC.slice(SRC.indexOf("const handleClose"), submitStart);

    expect(SRC).toContain("activeCancellationRef");
    expect(close).toContain("requestUploadCancellation(cancellation)");
    expect(cancellationCheck).toBeGreaterThan(init);
    expect(cancellationCheck).toBeLessThan(firstPart);
    expect(cancellationCheck).toBeLessThan(completion);
    expect(submit.slice(cancellationCheck, firstPart)).toContain("recoveryEntry");
    expect(submit.slice(cancellationCheck, firstPart)).toContain("abortMultipartAction");
  });

  it("imports Server Actions from the clients-projects upload-actions module", () => {
    expect(SRC).toMatch(/~\/app\/\(producer\)\/dashboard\/clients-projects\/upload-actions/);
  });

  it("does NOT use direct tRPC client mutations (Server Actions only)", () => {
    expect(SRC).not.toMatch(/useMutation/);
    expect(SRC).not.toMatch(/trpc\.\w+\.\w+\.\bmutate\b/);
  });

  it("uses fetch() for chunked PUT (NOT a Server Action — body must stay in the browser)", () => {
    expect(SRC).toMatch(/fetch\(/);
    expect(SRC).toMatch(/method:\s*["']PUT["']/);
  });

  it("uses a 5MB chunk size constant", () => {
    expect(SRC).toMatch(/CHUNK_SIZE\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
  });

  it("reads the ETag header off the PUT response and strips quotes", () => {
    expect(SRC).toMatch(/headers\.get\(["']ETag["']\)/);
    expect(SRC).toMatch(/replaceAll\(["']"["'],\s*["']["']\)/);
  });

  it("uses useTransition for the submit handler (pending state)", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("uses useToast for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']success["']\)/);
    expect(SRC).toMatch(/toast\([^)]*?,\s*["']error["']\)/);
  });

  it("calls router.refresh after a successful upload", () => {
    expect(SRC).toMatch(/router\.refresh/);
  });

  it("calls onCreated callback after a successful upload", () => {
    expect(SRC).toMatch(/onCreated\?\.\(\)/);
  });

  it("aborts mid-flight uploads on modal close (reclaims R2 storage)", () => {
    expect(SRC).toContain("abortMultipartAction");
    expect(SRC).toMatch(/activeUploadRef/);
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
