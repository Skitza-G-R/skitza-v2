"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import type { ArtistDisconnectBlocker } from "~/server/artist/disconnect";
import type { ResolvedArtistNotificationPreferences } from "~/server/artist/profile";
import { appRouter } from "~/server/trpc/routers/_app";

type ActionFailure = { ok: false; error: string };

async function artistCaller() {
  const { userId } = await auth();
  return userId ? appRouter.createCaller({ userId }) : null;
}

export async function saveArtistTimezoneAction(input: {
  timezone: string;
}): Promise<{ ok: true; timezone: string } | ActionFailure> {
  const caller = await artistCaller();
  if (!caller) return { ok: false, error: "Sign in to update your timezone." };

  try {
    const result = await caller.artistPlatform.profile.updateTimezone(input);
    revalidatePath("/artist/settings");
    return { ok: true, timezone: result.timezone };
  } catch (error) {
    if (error instanceof TRPCError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Timezone couldn’t be saved. Try again." };
  }
}

export async function saveArtistNotificationPreferencesAction(
  input: ResolvedArtistNotificationPreferences,
): Promise<
  | { ok: true; preferences: ResolvedArtistNotificationPreferences }
  | ActionFailure
> {
  const caller = await artistCaller();
  if (!caller) return { ok: false, error: "Sign in to update notifications." };

  try {
    const preferences =
      await caller.artistPlatform.profile.updateNotifications(input);
    revalidatePath("/artist/settings");
    return { ok: true, preferences };
  } catch (error) {
    if (error instanceof TRPCError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: "Notification preferences couldn’t be saved. Try again.",
    };
  }
}

export type ArtistDisconnectPreviewActionResult =
  | {
      ok: true;
      preview: {
        producerId: string;
        producerName: string;
        producerSlug: string;
        canDisconnect: boolean;
        blockers: ArtistDisconnectBlocker[];
      };
    }
  | ActionFailure;

export async function previewArtistDisconnectAction(input: {
  producerId: string;
}): Promise<ArtistDisconnectPreviewActionResult> {
  const caller = await artistCaller();
  if (!caller) return { ok: false, error: "Sign in to manage studios." };

  try {
    return {
      ok: true,
      preview: await caller.artistPlatform.disconnect.preview(input),
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Studio status couldn’t be checked. Try again." };
  }
}

export async function commitArtistDisconnectAction(input: {
  producerId: string;
}): Promise<
  | { ok: true }
  | { ok: false; error: string; blockers?: ArtistDisconnectBlocker[] }
> {
  const caller = await artistCaller();
  if (!caller) return { ok: false, error: "Sign in to manage studios." };

  try {
    await caller.artistPlatform.disconnect.commit(input);
    revalidatePath("/artist", "layout");
    revalidatePath("/artist/settings");
    return { ok: true };
  } catch (error) {
    if (error instanceof TRPCError) {
      if (error.code === "PRECONDITION_FAILED") {
        try {
          const refreshed = await caller.artistPlatform.disconnect.preview(input);
          return {
            ok: false,
            error: error.message,
            blockers: refreshed.blockers,
          };
        } catch {
          // Return the commit failure below if the refresh also failed.
        }
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Studio couldn’t be disconnected. Try again." };
  }
}

// Compatibility for the previous row component. The Settings page now uses
// the preview-first flow above, but this export keeps stale imports safe.
export async function disconnectProducerAction(input: {
  producerId: string;
}): Promise<{ ok: true } | ActionFailure> {
  return commitArtistDisconnectAction(input);
}
