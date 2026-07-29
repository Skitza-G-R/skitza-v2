import { auth } from "@clerk/nextjs/server";
import { createDb } from "@skitza/db";

import { fetchUserRole } from "~/server/auth/role";
import {
  authorizeSongArtworkRead,
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
    const role = await fetchUserRole({ dbUrl: databaseUrl, userId });
    let viewer: SongArtworkViewer;
    if (role.kind === "producer-complete" || role.kind === "producer-incomplete") {
      viewer = { role: "producer", producerId: role.producer.id };
    } else if (role.kind === "artist") {
      viewer = { role: "artist", clerkUserId: userId };
    } else {
      return unavailable();
    }

    const artwork = await authorizeSongArtworkRead(createDb(databaseUrl), {
      viewer,
      trackId,
    });
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
