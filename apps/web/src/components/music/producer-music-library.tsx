"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AddSongDialog,
  type AddSongProjectOption,
} from "~/components/dashboard/song/add-song-dialog";
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
  addSongProjects,
  initialAddSongOpen,
  initialProjectId,
  initialPurchaseId,
  lockInitialProject,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
}: {
  tracks: MusicLibraryRow[];
  projectRows: MusicLibraryProjectRow[];
  addSongProjects: AddSongProjectOption[];
  initialAddSongOpen: boolean;
  initialProjectId?: string;
  initialPurchaseId?: string;
  lockInitialProject?: boolean;
  renameSong: RenameSongAction;
  editArtist: EditSongArtistAction;
  setArchived: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
}) {
  const router = useRouter();
  const [addSongOpen, setAddSongOpen] = useState(initialAddSongOpen);

  useEffect(() => {
    setAddSongOpen(initialAddSongOpen);
  }, [initialAddSongOpen]);

  const closeAddSong = () => {
    setAddSongOpen(false);
    router.replace("/dashboard/music", { scroll: false });
  };

  return (
    <>
      <MusicLibraryScreen
        tracks={tracks}
        projectRows={projectRows}
        addSongHref="/dashboard/music?addSong=1"
        renameSong={renameSong}
        editArtist={editArtist}
        setArchived={setArchived}
        {...(markReleased ? { markReleased } : {})}
      />
      <AddSongDialog
        open={addSongOpen}
        onClose={closeAddSong}
        projects={addSongProjects}
        {...(lockInitialProject === undefined ? {} : { lockInitialProject })}
        {...(initialProjectId ? { initialProjectId } : {})}
        {...(initialPurchaseId ? { initialPurchaseId } : {})}
      />
    </>
  );
}
