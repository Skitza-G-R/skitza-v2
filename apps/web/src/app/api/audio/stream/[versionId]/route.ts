import { auth } from "~/server/auth/clerk-identity";
import { createDb } from "@skitza/db";

import { audioDeliveryRepository } from "~/server/domain/audio-delivery/db";
import {
  audioDeliveryErrorResponse,
  audioNotFoundResponse,
} from "~/server/domain/audio-delivery/route-errors";
import { authorizedAudioResponse } from "~/server/domain/audio-delivery/response";
import { deliverPrivateStreamForAccount } from "~/server/domain/audio-delivery/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  const { versionId } = await params;
  if (!UUID.test(versionId)) return audioNotFoundResponse();
  const { userId } = await auth();
  if (!userId) return audioNotFoundResponse();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  const db = createDb(databaseUrl);
  try {
    return await deliverPrivateStreamForAccount(
      audioDeliveryRepository(db),
      { viewerClerkUserId: userId, versionId },
      (audio) => authorizedAudioResponse(request, audio, "inline"),
    );
  } catch (error) {
    return audioDeliveryErrorResponse(error);
  }
}
