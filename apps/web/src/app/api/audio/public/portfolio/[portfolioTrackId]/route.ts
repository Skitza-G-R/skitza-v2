import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";

import { publicAudioDeliveryRepository } from "~/server/domain/audio-delivery/db";
import {
  audioDeliveryErrorResponse,
  audioNotFoundResponse,
} from "~/server/domain/audio-delivery/route-errors";
import { authorizedAudioResponse } from "~/server/domain/audio-delivery/response";
import { deliverPublicPortfolioStream } from "~/server/domain/audio-delivery/service";
import { verifyPublicAudioStreamToken } from "~/server/domain/audio-delivery/tokens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ portfolioTrackId: string }> },
): Promise<Response> {
  const { portfolioTrackId } = await params;
  if (!UUID.test(portfolioTrackId)) return audioNotFoundResponse();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL");
  const db = createDb(databaseUrl);
  try {
    let producerId: string | null = null;
    const token = new URL(request.url).searchParams.get("token");
    if (token) {
      const secret = process.env.CLERK_SECRET_KEY;
      if (!secret) throw new Error("Missing CLERK_SECRET_KEY");
      const payload = verifyPublicAudioStreamToken(secret, token);
      if (payload.publicSampleId !== portfolioTrackId) return audioNotFoundResponse();
      producerId = payload.producerId;
    } else {
      const { userId } = await auth();
      if (!userId) return audioNotFoundResponse();
      const [producer] = await db
        .select({ id: producers.id })
        .from(producers)
        .where(eq(producers.clerkUserId, userId))
        .limit(1);
      producerId = producer?.id ?? null;
    }
    if (!producerId) return audioNotFoundResponse();
    return await deliverPublicPortfolioStream(
      publicAudioDeliveryRepository(db),
      { portfolioTrackId, producerId },
      (audio) => authorizedAudioResponse(request, audio, "inline"),
    );
  } catch (error) {
    return audioDeliveryErrorResponse(error);
  }
}
