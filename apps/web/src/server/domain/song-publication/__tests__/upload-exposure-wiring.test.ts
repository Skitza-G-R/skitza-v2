import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const audioRouter = readFileSync(
  new URL("../../../trpc/routers/audio.ts", import.meta.url),
  "utf8",
);
const projectPage = readFileSync(
  new URL("../../../../app/(producer)/dashboard/clients-projects/[id]/page.tsx", import.meta.url),
  "utf8",
);
const projectUploadController = readFileSync(
  new URL(
    "../../../../components/dashboard/project/project-song-upload-controller.tsx",
    import.meta.url,
  ),
  "utf8",
);
const uploadModal = readFileSync(
  new URL("../../../../components/dashboard/song/upload-track-modal.tsx", import.meta.url),
  "utf8",
);
const uploadActions = readFileSync(
  new URL(
    "../../../../app/(producer)/dashboard/clients-projects/upload-actions.ts",
    import.meta.url,
  ),
  "utf8",
);
const genericUpload = readFileSync(
  new URL("../../../../lib/audio/use-multipart-upload.ts", import.meta.url),
  "utf8",
);

describe("public song upload acknowledgement wiring", () => {
  it("requires an explicit boolean in the authenticated completion mutation", () => {
    const complete = audioRouter.slice(audioRouter.indexOf("completeMultipart:"));

    expect(complete).toMatch(/acknowledgePublicExposure:\s*z\.boolean\(\)/);
    expect(complete).not.toMatch(/acknowledgePublicExposure:[^\n]*\.optional\(/);
    expect(complete).not.toMatch(/acknowledgePublicExposure:[^\n]*\.default\(/);
  });

  it("rechecks locked public state before R2 completion and before attachment", () => {
    const complete = audioRouter.slice(audioRouter.indexOf("completeMultipart:"));
    const checks = [...complete.matchAll(/requireSongUploadPublicExposureAcknowledgement\(/g)].map(
      (match) => match.index,
    );
    const remoteBoundary = complete.indexOf("const completionInput");
    const attachment = complete.indexOf("const [updatedVersion]");

    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(checks[0]).toBeLessThan(remoteBoundary);
    expect(checks.at(-1)).toBeLessThan(attachment);
    expect(complete).toMatch(
      /\.from\(songPublicLinks\)[\s\S]*?eq\(songPublicLinks\.trackId, trackId\)[\s\S]*?eq\(songPublicLinks\.purchaseId, purchaseId\)[\s\S]*?eq\(songPublicLinks\.producerId, ctx\.producerId\)[\s\S]*?\.for\("update"\)/,
    );
  });

  it("shows the exact active surfaces and forwards acknowledgement only with that warning", () => {
    expect(projectPage).toContain("classifySongUploadPublicExposure");
    expect(projectUploadController).toContain("UploadTrackModal");
    expect(projectUploadController).not.toContain("SongTabs");
    expect(projectUploadController).not.toContain("Workflow");
    expect(uploadModal).toContain("This song is public.");
    expect(uploadModal).toContain("public link and portfolio");
    expect(uploadModal).toMatch(/acknowledgePublicExposure:\s*selectedPublicExposure !== "none"/);
  });

  it("keeps the server-action contract required and unmodified", () => {
    expect(uploadActions).toMatch(/acknowledgePublicExposure:\s*boolean/);
    expect(uploadActions).toMatch(/acknowledgePublicExposure:\s*input\.acknowledgePublicExposure/);
  });

  it("fails closed for generic upload callers that did not render the warning", () => {
    expect(genericUpload).toMatch(/acknowledgePublicExposure:\s*false/);
  });
});
