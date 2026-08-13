import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";

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
  const { userId } = await auth();
  if (!userId) return response({ active: false }, 401);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return response({ active: false }, 503);
  const [producer] = await createDb(databaseUrl)
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);
  if (!producer) return response({ active: false }, 403);
  return response({ active: true, accountId: userId });
}
