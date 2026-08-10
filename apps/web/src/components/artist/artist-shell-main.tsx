"use client";

import { usePathname } from "next/navigation";

import { isArtistFocusedPath } from "./artist-shell-route";

export function ArtistShellMain({ children }: { children: React.ReactNode }) {
  const focused = isArtistFocusedPath(usePathname());

  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-artist-shell-mode={focused ? "focused" : "standing"}
      className={
        focused
          ? "sk-native-scroll min-h-0 w-full min-w-0 flex-1 lg:overflow-visible"
          : "sk-native-scroll mx-auto min-h-0 w-full max-w-2xl flex-1 px-4 pt-6 pb-4 lg:max-w-none lg:overflow-visible lg:px-10 lg:pt-10 lg:pb-12"
      }
    >
      {children}
    </main>
  );
}
