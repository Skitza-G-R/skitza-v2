import { auth } from "~/server/auth/clerk-identity";
import { createDb } from "@skitza/db";

import { fetchUserAccountMemberships } from "~/server/auth/role";
import {
  authorizeSongArtworkRead,
  type AuthorizedSongArtwork,
  type SongArtworkViewer,
} from "~/server/domain/song-artwork/service";
import { readPrivateSongArtworkObject } from "~/server/domain/song-artwork/storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackId: string }> },
): Promise<Response> {
  const { trackId } = await params;
  if (!UUID.test(trackId)) return unavailable();
  const { userId } = await auth();
  const databaseUrl = process.env.DATABASE_URL;
  if (!userId || !databaseUrl) return unavailable();

  try {
    const memberships = await fetchUserAccountMemberships({
      dbUrl: databaseUrl,
      userId,
    });
    const viewers: SongArtworkViewer[] = [];
    if (
      memberships.producer.status === "complete" ||
      memberships.producer.status === "incomplete"
    ) {
      viewers.push({
        role: "producer",
        producerId: memberships.producer.profile.id,
      });
    }
    if (memberships.artist.hasAccess) {
      viewers.push({ role: "artist", clerkUserId: userId });
    }

    let artwork: AuthorizedSongArtwork | null = null;
    for (const viewer of viewers) {
      try {
        artwork = await authorizeSongArtworkRead(createDb(databaseUrl), {
          viewer,
          trackId,
        });
        break;
      } catch {
        // A dual-role account may fail exact ownership as its Producer while
        // still owning the same track through an exact active Artist link.
      }
    }
    if (!artwork) return unavailable();

    const object = await readPrivateSongArtworkObject(artwork);
    return new Response(Buffer.from(object.body), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": "inline",
        "Content-Length": String(object.sizeBytes),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": object.contentType,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}
