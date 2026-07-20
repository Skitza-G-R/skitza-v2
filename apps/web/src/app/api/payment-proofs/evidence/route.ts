import { auth } from "@clerk/nextjs/server";
import { createDb } from "@skitza/db";
import { type NextRequest, NextResponse } from "next/server";

import { authorizePrivateProofEvidence } from "~/server/domain/payment-proofs/service";
import { readPrivateProofObject } from "~/server/domain/payment-proofs/storage";
import { verifyProofEvidenceToken } from "~/server/domain/payment-proofs/tokens";

export const dynamic = "force-dynamic";

function unavailable(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "payment-proof";
  return `inline; filename="${fallback.replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Same-origin private delivery. R2 bucket URLs and keys never cross this
 * boundary; every read rechecks the signed viewer identity and current role
 * ownership before fetching the immutable object with its recorded ETag.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  const token = request.nextUrl.searchParams.get("token");
  const serverSecret = process.env.CLERK_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!userId || !token || !serverSecret || !databaseUrl) return unavailable();

  try {
    const payload = verifyProofEvidenceToken(serverSecret, token);
    if (payload.viewerClerkUserId !== userId) return unavailable();
    const evidence = await authorizePrivateProofEvidence(createDb(databaseUrl), {
      role: payload.viewerRole,
      clerkUserId: userId,
      proofId: payload.proofId,
    });
    const bytes = await readPrivateProofObject(evidence);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": contentDisposition(evidence.originalFileName),
        "Content-Length": String(bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": evidence.contentType,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}
