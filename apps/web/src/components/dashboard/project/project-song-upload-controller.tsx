"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ProjectActionProject } from "~/components/dashboard/projects/project-action-controls";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { canCreatePurchaseOwnedProjectWork } from "~/components/dashboard/projects/project-upload-access";
import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";

export interface ProjectSongUploadData {
  id: string;
  purchaseId: string;
  title: string;
  archivedAtIso: string | null;
  versionCount: number;
  publicExposure: "none" | "link" | "portfolio" | "link_and_portfolio";
}

interface ProjectSongUploadControllerProps {
  projectId: string;
  actionProject: ProjectActionProject;
  purchases: readonly ProjectPurchaseSummary[];
  song: ProjectSongUploadData;
  initialUploadOpen?: boolean;
}

export function ProjectSongUploadController({
  projectId,
  actionProject,
  purchases,
  song,
  initialUploadOpen = false,
}: ProjectSongUploadControllerProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);
  const handledUploadRef = useRef<string | null>(null);
  const canUpload =
    song.archivedAtIso === null &&
    canCreatePurchaseOwnedProjectWork({
      projectLifecycleStatus: actionProject.lifecycleStatus,
      purchaseId: song.purchaseId,
      purchases,
    });

  useEffect(() => {
    if (!initialUploadOpen || searchParams.get("upload") !== "1") {
      handledUploadRef.current = null;
      return;
    }
    const handoffKey = searchParams.toString();
    if (handledUploadRef.current === handoffKey) return;
    handledUploadRef.current = handoffKey;

    if (canUpload) setUploadOpen(true);
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("song");
    nextSearchParams.delete("upload");
    const nextQuery = nextSearchParams.toString();
    const canonicalHref = `${nextQuery ? `${pathname}?${nextQuery}` : pathname}${
      window.location.hash
    }`;
    window.history.replaceState(null, "", canonicalHref);
  }, [canUpload, initialUploadOpen, pathname, searchParams]);

  if (!canUpload) return null;

  return (
    <UploadTrackModal
      open={uploadOpen}
      onClose={() => {
        setUploadOpen(false);
      }}
      projectId={projectId}
      mode="new-version"
      trackId={song.id}
      tracks={[
        {
          id: song.id,
          title: song.title,
          versionCount: song.versionCount,
          publicExposure: song.publicExposure,
        },
      ]}
    />
  );
}
