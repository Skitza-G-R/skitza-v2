"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

// Thin Server Action wrappers for the AppShell notification bell.
// Mirrors palette-actions: no client-side tRPC/react-query pipeline,
// so the bell bundle stays tiny. The bell component calls these
// directly and revalidates the dashboard shell so the server-side
// unread count + items list refresh on the next render.

export type NotificationActionResult =
  | { ok: true }
  | { ok: false; error: string };

function toMessage(err: unknown): string {
  if (err instanceof TRPCError) {
    if (err.code === "UNAUTHORIZED") return "Please sign in to continue.";
    if (err.code === "FORBIDDEN") return "You don't have access to that notification.";
    if (err.code === "NOT_FOUND") return "Notification not found.";
    return err.message || "Notification update failed.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function markNotificationRead(
  id: string,
): Promise<NotificationActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    await caller.inbox.markRead({ id });
    // Revalidate the dashboard shell so the sidebar badge + bell
    // re-fetch on the next render. /dashboard is the shell's root.
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    await caller.inbox.markAllRead();
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
