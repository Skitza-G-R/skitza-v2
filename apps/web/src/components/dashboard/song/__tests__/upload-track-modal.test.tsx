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

  it("declares the UploadTrackModalProps shape with open, onClose, projectId, mode, tracks", () => {
    expect(SRC).toMatch(/open:\s*boolean/);
    expect(SRC).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    expect(SRC).toMatch(/projectId:\s*string/);
    expect(SRC).toMatch(/mode:\s*["']new-song["']\s*\|\s*["']new-version["']/);
    expect(SRC).toMatch(/tracks:\s*UploadTrackModalTrack\[\]/);
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

  it("renders an audio-only file input with a click + drop drop zone", () => {
    expect(SRC).toMatch(/id="upload-track-file"/);
    expect(SRC).toMatch(/accept="audio\/\*"/);
    expect(SRC).toContain("onDrop");
    expect(SRC).toContain("onDragOver");
  });

  it("renders an upload progress bar with role=progressbar", () => {
    expect(SRC).toMatch(/role=["']progressbar["']/);
    expect(SRC).toMatch(/aria-valuenow=\{progress\}/);
  });

  it("renders 'Upload' primary CTA + 'Cancel' secondary action", () => {
    expect(SRC).toContain("Upload");
    expect(SRC).toContain("Cancel");
  });

  it("calls all 8 Server Actions from the upload-actions wrapper", () => {
    expect(SRC).toContain("addTrackAction");
    expect(SRC).toContain("addVersionAction");
    expect(SRC).toContain("initMultipartAction");
    expect(SRC).toContain("signPartAction");
    expect(SRC).toContain("completeMultipartAction");
    expect(SRC).toContain("abortMultipartAction");
    expect(SRC).toContain("setTrackStageAction");
    // I1 — orphan cleanup on upload failure.
    expect(SRC).toContain("deleteVersionAction");
  });

  // I1 — on upload failure, the modal must cleanup the orphan
  // track_versions row created at step 2 of the chain. R2 multipart
  // abort happens for storage cleanup, but the DB row stayed forever
  // before this fix.
  it("calls deleteVersionAction in the catch branch (best-effort fire-and-forget)", () => {
    expect(SRC).toMatch(/createdVersionId/);
    // The cleanup call is fire-and-forget (no await) so the producer
    // only sees ONE error toast.
    expect(SRC).toMatch(/void deleteVersionAction/);
  });

  it("imports Server Actions from the clients-projects upload-actions module", () => {
    expect(SRC).toMatch(
      /~\/app\/\(producer\)\/dashboard\/clients-projects\/upload-actions/,
    );
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

  it("guards getDurationMs with a 3s timeout race so a malformed file can't hang the upload", () => {
    expect(SRC).toMatch(/Promise\.race/);
    expect(SRC).toMatch(/3000/);
  });

  it("auto-bumps the default label to v{versionCount+1} when picking an existing track", () => {
    expect(SRC).toMatch(/deriveNextLabel/);
    expect(SRC).toMatch(/versionCount/);
  });

  it("uses backdrop-blur on the scrim (matches NewClientModal precedent)", () => {
    expect(SRC).toMatch(/backdrop-blur/);
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
