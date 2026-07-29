import { auth } from "@clerk/nextjs/server";
import { createDb } from "@skitza/db";

import { audioDeliveryRepository } from "~/server/domain/audio-delivery/db";
import {
  audioDeliveryErrorResponse,
  audioNotFoundResponse,
} from "~/server/domain/audio-delivery/route-errors";
import { authorizedAudioResponse } from "~/server/domain/audio-delivery/response";
import { deliverArtistDownload } from "~/server/domain/audio-delivery/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ purchaseId: string; versionId: string }> },
): Promise<Response> {
  const { purchaseId, versionId } = await params;
  if (!UUID.test(purchaseId) || !UUID.test(versionId)) return audioNotFoundResponse();
  const { userId } = await auth();
  if (!userId) return audioNotFoundResponse();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  const db = createDb(databaseUrl);
  try {
    return await deliverArtistDownload(
      audioDeliveryRepository(db),
      { viewerClerkUserId: userId, purchaseId, versionId },
      (audio) => authorizedAudioResponse(request, audio, "attachment"),
    );
  } catch (error) {
    return audioDeliveryErrorResponse(error);
  }
}
