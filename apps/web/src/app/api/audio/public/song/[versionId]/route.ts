import { createDb } from "@skitza/db";

import {
  audioDeliveryErrorResponse,
  audioNotFoundResponse,
} from "~/server/domain/audio-delivery/route-errors";
import { authorizedAudioResponse } from "~/server/domain/audio-delivery/response";
import {
  SongPublicAudioCapabilityError,
} from "~/server/domain/song-publication/audio-capability";
import { songPublicationSecret } from "~/server/domain/song-publication/config";
import {
  deliverPortfolioSongAudio,
  deliverSongLinkAudio,
  SongPublicReadError,
} from "~/server/domain/song-publication/public-read";
import { SongPublicTokenError } from "~/server/domain/song-publication/tokens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  const { versionId } = await params;
  if (!UUID.test(versionId)) return audioNotFoundResponse();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  const db = createDb(databaseUrl);
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const capability = url.searchParams.get("cap");
  if ((token === null) === (capability === null)) return audioNotFoundResponse();

  try {
    const open = (audio: Parameters<typeof authorizedAudioResponse>[1]) =>
      authorizedAudioResponse(request, audio, "inline");
    return token !== null
      ? await deliverSongLinkAudio(
          db,
          { secret: songPublicationSecret(), token, versionId },
          open,
        )
      : await deliverPortfolioSongAudio(
          db,
          {
            secret: songPublicationSecret(),
            capability: capability as string,
            versionId,
          },
          open,
        );
  } catch (error) {
    if (
      error instanceof SongPublicReadError ||
      error instanceof SongPublicTokenError ||
      error instanceof SongPublicAudioCapabilityError
    ) {
      return audioNotFoundResponse();
    }
    return audioDeliveryErrorResponse(error);
  }
}
