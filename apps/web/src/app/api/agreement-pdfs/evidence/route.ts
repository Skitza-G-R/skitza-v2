import { auth } from "@clerk/nextjs/server";
import { createDb } from "@skitza/db";
import { type NextRequest, NextResponse } from "next/server";

import {
  authorizeAcceptedAgreementPdf,
  authorizeCurrentRequestAgreementPdf,
} from "~/server/domain/agreement-pdfs/evidence";
import { readPrivateAgreementPdf } from "~/server/domain/agreement-pdfs/storage";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "agreement.pdf";
  return `inline; filename="${fallback.replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  const databaseUrl = process.env.DATABASE_URL;
  if (!userId || !databaseUrl) return unavailable();

  const purchaseRequestId = request.nextUrl.searchParams.get("purchaseRequestId");
  const purchaseId = request.nextUrl.searchParams.get("purchaseId");
  const documentId = request.nextUrl.searchParams.get("documentId");
  if ((purchaseRequestId === null) === (purchaseId === null)) return unavailable();
  if (purchaseRequestId !== null && !UUID_PATTERN.test(purchaseRequestId)) return unavailable();
  if (purchaseId !== null && !UUID_PATTERN.test(purchaseId)) return unavailable();
  if (purchaseRequestId !== null && (documentId === null || !UUID_PATTERN.test(documentId))) {
    return unavailable();
  }
  if (purchaseId !== null && documentId !== null) return unavailable();

  try {
    const db = createDb(databaseUrl);
    const document = purchaseRequestId
      ? await authorizeCurrentRequestAgreementPdf(db, {
          clerkUserId: userId,
          purchaseRequestId,
          expectedDocumentId: documentId ?? "",
        })
      : await authorizeAcceptedAgreementPdf(db, {
          clerkUserId: userId,
          purchaseId: purchaseId ?? "",
        });
    const bytes = await readPrivateAgreementPdf(document);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": contentDisposition(document.originalFileName),
        "Content-Length": String(bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": "application/pdf",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}
