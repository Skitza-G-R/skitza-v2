import { and, createDb, eq, isNull, producers } from "@skitza/db";

import { auth } from "~/server/auth/clerk-identity";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET() {
  try {
    const { providerUserId, userId } = await auth();
    if (!userId || !providerUserId) return response({ active: false }, 401);
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return response({ active: false }, 503);
    const [producer] = await createDb(databaseUrl)
      .select({ id: producers.id })
      .from(producers)
      .where(and(eq(producers.clerkUserId, userId), isNull(producers.closedAt)))
      .limit(1);
    if (!producer) return response({ active: false }, 403);
    return response({ active: true, accountId: providerUserId });
  } catch {
    return response({ active: false }, 503);
  }
}
