"use client";

// Small runtime bridge between the web app and the Tauri shell.
//
// Everything here degrades to a no-op outside Tauri so the same React
// components can render in a plain browser build and the production
// desktop binary without branching beyond the `isTauri()` gate.
//
// Why dynamic imports? The `@tauri-apps/api` module touches
// `window.__TAURI_INTERNALS__` at import time for some paths; loading
// it statically inside `apps/web` would bloat the web bundle and also
// run during SSR. Dynamic imports keep the modules out of the initial
// chunk and only resolve them when we're actually inside Tauri.

// Internal Tauri markers live on the `window` object. We narrow with
// `in` checks; no `any`, no non-null assertions.
interface TauriWindow {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as TauriWindow;
  return w.__TAURI__ !== undefined || w.__TAURI_INTERNALS__ !== undefined;
}

export type FileDropListener = (paths: string[]) => void;

// Subscribe to Finder file drops on the current Tauri window. Returns
// an unlisten function; callers MUST invoke it on unmount so we don't
// leak listeners between renders.
export async function onTauriFileDrop(
  listener: FileDropListener,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWebviewWindow } = await import(
    "@tauri-apps/api/webviewWindow"
  );
  const win = getCurrentWebviewWindow();
  const unlisten = await win.onDragDropEvent((event) => {
    if (event.payload.type === "drop") {
      listener([...event.payload.paths]);
    }
  });
  return unlisten;
}

// Subscribe to custom events emitted from the Rust side — menu clicks
// and the global-shortcut palette open signal both arrive here.
// Payloads are plain strings (the menu id or literal "open-palette").
export type MenuActionListener = (action: string) => void;

export async function onTauriMenuAction(
  listener: MenuActionListener,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<string>("menu:action", (event) => {
    listener(event.payload);
  });
  return unlisten;
}

// Read a file from disk (by absolute path from a drop event) and wrap
// it in a real web `File` so it can feed the existing multipart
// upload pipeline unchanged. Returns null on any failure so callers
// can skip to the next path or surface a toast.
export async function readFileAsBlob(path: string): Promise<File | null> {
  if (!isTauri()) return null;
  try {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(path);
    const filename = path.split(/[\\/]/).pop() ?? "track.wav";
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      ext === "wav"
        ? "audio/wav"
        : ext === "mp3"
          ? "audio/mpeg"
          : ext === "flac"
            ? "audio/flac"
            : ext === "m4a"
              ? "audio/x-m4a"
              : ext === "aiff" || ext === "aif"
                ? "audio/aiff"
                : "application/octet-stream";
    // `readFile` returns a Uint8Array; `new File` accepts BlobPart[] and
    // Uint8Array is a valid BlobPart. Wrap in an array for the File ctor.
    return new File([new Uint8Array(bytes)], filename, { type: mime });
  } catch {
    return null;
  }
}
