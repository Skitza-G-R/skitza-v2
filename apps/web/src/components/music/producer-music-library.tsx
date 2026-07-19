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

export function ProducerMusicLibrary({
  tracks,
  projectRows,
  addSongProjects,
  initialAddSongOpen,
  initialProjectId,
  initialPurchaseId,
  lockInitialProject,
}: {
  tracks: MusicLibraryRow[];
  projectRows: MusicLibraryProjectRow[];
  addSongProjects: AddSongProjectOption[];
  initialAddSongOpen: boolean;
  initialProjectId?: string;
  initialPurchaseId?: string;
  lockInitialProject?: boolean;
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
