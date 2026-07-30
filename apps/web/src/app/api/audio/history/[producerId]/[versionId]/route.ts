import { auth } from "@clerk/nextjs/server";
import { createDb } from "@skitza/db";

import { loadArtistHistoricalAudioRequest } from "~/server/artist/history";
import {
  audioDeliveryErrorResponse,
  audioNotFoundResponse,
} from "~/server/domain/audio-delivery/route-errors";
import { authorizedAudioResponse } from "~/server/domain/audio-delivery/response";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ producerId: string; versionId: string }>;
  },
): Promise<Response> {
  const { producerId, versionId } = await params;
  if (!UUID.test(producerId) || !UUID.test(versionId)) return audioNotFoundResponse();

  const downloadValues = new URL(request.url).searchParams.getAll("download");
  if (
    downloadValues.length > 1 ||
    (downloadValues.length === 1 && downloadValues[0] !== "1")
  ) {
    return audioNotFoundResponse();
  }

  const { userId } = await auth();
  const databaseUrl = process.env.DATABASE_URL;
  if (!userId || !databaseUrl) return audioNotFoundResponse();

  try {
    const audio = await loadArtistHistoricalAudioRequest(createDb(databaseUrl), {
      clerkUserId: userId,
      producerId,
      versionId,
      download: downloadValues.length === 1,
    });
    if (!audio) return audioNotFoundResponse();
    return await authorizedAudioResponse(
      request,
      audio,
      downloadValues.length === 1 ? "attachment" : "inline",
    );
  } catch (error) {
    return audioDeliveryErrorResponse(error);
  }
}
