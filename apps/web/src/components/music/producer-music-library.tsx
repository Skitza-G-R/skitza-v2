"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  UploadTrackModal,
  type UploadTrackModalProject,
} from "~/components/dashboard/song/upload-track-modal";
import {
  MusicLibraryScreen,
  type MusicLibraryProjectRow,
  type MusicLibraryRow,
} from "~/components/music/library-screen";
import type {
  EditSongArtistAction,
  MarkSongReleasedAction,
  RenameSongAction,
  SetSongArchivedAction,
} from "~/components/music/song-management-controls";

export function ProducerMusicLibrary({
  tracks,
  projectRows,
  uploadProjects,
  initialUploadOpen,
  initialProjectId,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  tracks: MusicLibraryRow[];
  projectRows: MusicLibraryProjectRow[];
  uploadProjects: UploadTrackModalProject[];
  initialUploadOpen: boolean;
  initialProjectId?: string;
  renameSong: RenameSongAction;
  editArtist: EditSongArtistAction;
  setArchived: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(initialUploadOpen);

  useEffect(() => {
    setUploadOpen(initialUploadOpen);
  }, [initialUploadOpen]);

  const closeUpload = () => {
    setUploadOpen(false);
    router.replace("/dashboard/music", { scroll: false });
  };

  return (
    <>
      <MusicLibraryScreen
        tracks={tracks}
        projectRows={projectRows}
        onUploadAudio={() => {
          setUploadOpen(true);
        }}
        renameSong={renameSong}
        editArtist={editArtist}
        setArchived={setArchived}
        {...(markReleased ? { markReleased } : {})}
      />
      <UploadTrackModal
        open={uploadOpen}
        onClose={closeUpload}
        mode="library"
        projects={uploadProjects}
        {...(initialProjectId ? { projectId: initialProjectId } : {})}
      />
    </>
  );
}
