"use client";

import { isTauri } from "./bridge";

// Fire a native OS notification via the Tauri notification plugin.
// No-op outside the desktop shell so call-sites can wire this in
// unconditionally. We request permission lazily the first time we
// need to fire — on macOS this surfaces the standard system prompt.
export async function desktopNotify(
  title: string,
  body: string,
): Promise<void> {
  if (!isTauri()) return;
  const { sendNotification, isPermissionGranted, requestPermission } =
    await import("@tauri-apps/plugin-notification");
  let granted = await isPermissionGranted();
  if (!granted) {
    const status = await requestPermission();
    granted = status === "granted";
  }
  if (!granted) return;
  sendNotification({ title, body });
}
