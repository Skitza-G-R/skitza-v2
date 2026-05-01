"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Server actions for the design-test Settings tab. Wires the
// Account-section "Save changes" button to producer.update.
//
// Pattern mirrors song-actions.ts (and the older quick-note-actions.ts):
// - resolve auth via auth()
// - dispatch through producerProcedure via createCaller
// - revalidate the page on success so the RSC refetch re-renders with
//   the persisted values (no client React Query cache to invalidate)
//
// Tagline is stored inside producers.brand JSONB. The router's
// BrandInput now allows a `tagline` field; the update mutation merges
// it over the existing brand blob so other brand fields (logoUrl,
// primary color, accent, font) are preserved.

export type UpdateSettingsInput = {
  displayName: string;
  slug: string;
  tagline: string;
};

export type UpdateSettingsResult =
  | { ok: true }
  | { ok: false; error: string; field?: "displayName" | "slug" | "tagline" };

export async function updateProducerSettings(
  input: UpdateSettingsInput,
): Promise<UpdateSettingsResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  const displayName = input.displayName.trim();
  const slug = input.slug.trim();
  const tagline = input.tagline.trim();

  if (!displayName) {
    return { ok: false, error: "Display name can't be empty.", field: "displayName" };
  }
  if (!slug) {
    return { ok: false, error: "Public link can't be empty.", field: "slug" };
  }

  try {
    const caller = appRouter.createCaller({ userId });
    await caller.producer.update({
      displayName,
      slug,
      brand: { tagline },
    });
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (err) {
    if (err instanceof TRPCError) {
      // Slug uniqueness collision is mapped to BAD_REQUEST upstream
      // with a friendly message — surface it directly.
      const isSlugCollision =
        err.code === "BAD_REQUEST" && /slug/i.test(err.message);
      return {
        ok: false,
        error: err.message,
        ...(isSlugCollision ? { field: "slug" as const } : {}),
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't save changes.",
    };
  }
}
