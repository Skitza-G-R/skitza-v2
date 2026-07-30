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
          ? "min-w-0 w-full flex-1"
          : "mx-auto w-full max-w-2xl px-4 pt-6 pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] lg:max-w-none lg:px-10 lg:pt-10 lg:pb-12"
      }
    >
      {children}
    </main>
  );
}
