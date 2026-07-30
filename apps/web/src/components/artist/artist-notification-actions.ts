"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

async function caller() {
  const { userId } = await auth();
  return userId ? appRouter.createCaller({ userId }) : null;
}

export async function loadArtistNotificationFeedAction(): Promise<
  | {
      ok: true;
      unreadCount: number;
      notifications: {
        id: string;
        producerId: string;
        producerName: string;
        producerLogoUrl: string | null;
        kind: string;
        title: string;
        body: string;
        readAtIso: string | null;
        openedAtIso: string | null;
        createdAtIso: string;
      }[];
    }
  | { ok: false; error: string }
> {
  const artist = await caller();
  if (!artist) return { ok: false, error: "Sign in to view notifications." };

  try {
    const [notifications, unreadCount] = await Promise.all([
      artist.artistPlatform.notifications.list({ filter: "all", limit: 50 }),
      artist.artistPlatform.notifications.unreadCount(),
    ]);
    return {
      ok: true,
      unreadCount,
      notifications: notifications.map((notification) => ({
        ...notification,
        readAtIso: notification.readAt?.toISOString() ?? null,
        openedAtIso: notification.openedAt?.toISOString() ?? null,
        createdAtIso: notification.createdAt.toISOString(),
      })),
    };
  } catch {
    return { ok: false, error: "Notifications couldn’t be loaded. Try again." };
  }
}

export async function markArtistNotificationReadAction(input: {
  notificationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const artist = await caller();
  if (!artist) return { ok: false, error: "Sign in to update notifications." };
  try {
    await artist.artistPlatform.notifications.markRead(input);
    revalidatePath("/artist", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof TRPCError && error.code === "NOT_FOUND"
          ? "Notification not found."
          : "Notification couldn’t be updated. Try again.",
    };
  }
}

export async function markAllArtistNotificationsReadAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const artist = await caller();
  if (!artist) return { ok: false, error: "Sign in to update notifications." };
  try {
    await artist.artistPlatform.notifications.markAllRead();
    revalidatePath("/artist", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "Notifications couldn’t be updated. Try again." };
  }
}

export async function openArtistNotificationAction(input: {
  notificationId: string;
}): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const artist = await caller();
  if (!artist) return { ok: false, error: "Sign in to open notifications." };
  try {
    const result = await artist.artistPlatform.notifications.open(input);
    revalidatePath("/artist", "layout");
    return { ok: true, href: result.href };
  } catch {
    return {
      ok: false,
      error: "This notification no longer has an available destination.",
    };
  }
}

export async function acknowledgeArtistTrackVersionAction(input: {
  trackVersionId: string;
}): Promise<{ ok: true; acknowledgedCount: number } | { ok: false; error: string }> {
  const artist = await caller();
  if (!artist) return { ok: false, error: "Sign in to update notifications." };
  try {
    const result = await artist.artistPlatform.notifications.acknowledgeTrackVersion(input);
    revalidatePath("/artist", "layout");
    revalidatePath("/artist");
    return { ok: true, acknowledgedCount: result.acknowledgedCount };
  } catch {
    return { ok: false, error: "Notification couldn’t be updated." };
  }
}
