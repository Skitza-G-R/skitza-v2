import { createDb } from "@skitza/db";

import {
  audioDeliveryErrorResponse,
  audioNotFoundResponse,
} from "~/server/domain/audio-delivery/route-errors";
import { authorizedAudioResponse } from "~/server/domain/audio-delivery/response";
import { SongPublicAudioCapabilityError } from "~/server/domain/song-publication/audio-capability";
import { songPublicationSecret } from "~/server/domain/song-publication/config";
import {
  deliverAddressSongAudio,
  deliverAddressSongDownload,
  deliverPortfolioSongAudio,
  deliverSongLinkAudio,
  deliverSongLinkDownload,
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
  const addressValues = url.searchParams.getAll("address");
  if (addressValues.length > 1) return audioNotFoundResponse();
  const addressCapability = addressValues[0] ?? null;
  const authorityCount = [token, capability, addressCapability].filter(
    (value) => value !== null,
  ).length;
  if (authorityCount !== 1) return audioNotFoundResponse();
  const downloadValues = url.searchParams.getAll("download");
  if (
    downloadValues.length > 1 ||
    (downloadValues.length === 1 && downloadValues[0] !== "1") ||
    (downloadValues.length === 1 && capability !== null)
  ) {
    return audioNotFoundResponse();
  }
  const download = downloadValues.length === 1;

  try {
    const open = (audio: Parameters<typeof authorizedAudioResponse>[1]) =>
      authorizedAudioResponse(request, audio, download ? "attachment" : "inline");
    if (addressCapability !== null) {
      return download
        ? await deliverAddressSongDownload(
            db,
            {
              secret: songPublicationSecret(),
              capability: addressCapability,
              versionId,
            },
            open,
          )
        : await deliverAddressSongAudio(
            db,
            {
              secret: songPublicationSecret(),
              capability: addressCapability,
              versionId,
            },
            open,
          );
    }
    if (token !== null) {
      return download
        ? await deliverSongLinkDownload(
            db,
            { secret: songPublicationSecret(), token, versionId },
            open,
          )
        : await deliverSongLinkAudio(
            db,
            { secret: songPublicationSecret(), token, versionId },
            open,
          );
    }
    return await deliverPortfolioSongAudio(
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
