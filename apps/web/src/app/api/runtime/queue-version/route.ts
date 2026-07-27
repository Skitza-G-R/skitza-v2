import { auth } from "@clerk/nextjs/server";
import { createDb } from "@skitza/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { loadQueueVersion, type QueueVersionInput } from "~/server/runtime/queue-version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = z.string().uuid();
const QUERY = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dashboard") }).strict(),
  z.object({ kind: z.literal("payment-proofs") }).strict(),
  z.object({ kind: z.literal("payment-proof"), proofId: UUID }).strict(),
  z.object({ kind: z.literal("purchase-requests") }).strict(),
  z
    .object({
      kind: z.literal("artist-payment-proof"),
      purchaseId: UUID,
      installmentId: UUID,
    })
    .strict(),
]);

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
} as const;

function response(body: { version?: string; error?: string }, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return response({ error: "Unauthorized" }, 401);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return response({ error: "Unavailable" }, 503);

  const url = new URL(request.url);
  const parsed = QUERY.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return response({ error: "Invalid request" }, 400);

  try {
    const version = await loadQueueVersion(
      createDb(databaseUrl),
      userId,
      parsed.data as QueueVersionInput,
    );
    return response({ version }, 200);
  } catch {
    return response({ error: "Unavailable" }, 503);
  }
}
