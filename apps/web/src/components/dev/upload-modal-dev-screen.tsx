"use client";

import { useState } from "react";

import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";

export function UploadModalDevScreen() {
  const [open, setOpen] = useState(true);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-dvh items-center justify-center bg-[rgb(var(--bg-background))] p-6"
    >
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--bg-sidebar))]"
      >
        Open Upload audio
      </button>
      <UploadTrackModal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        mode="library"
        projects={[
          {
            id: "00000000-0000-4000-8000-000000000003",
            title: "Debut single",
            clientName: "Maya Cohen",
            canCreateNewSong: true,
            tracks: [
              {
                id: "song-existing",
                title: "Existing song",
                versionCount: 2,
                publicExposure: "link_and_portfolio",
              },
            ],
          },
          {
            id: "00000000-0000-4000-8000-000000000005",
            title: "Second project",
            clientName: "Lior Tansky",
            canCreateNewSong: true,
            tracks: [],
          },
        ]}
      />
    </main>
  );
}
