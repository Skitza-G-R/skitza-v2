import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");

describe("private agreement PDF security wiring", () => {
  it("keeps object identity behind a same-origin, no-store authorization route", () => {
    const route = fs.readFileSync(
      path.join(ROOT, "app/api/agreement-pdfs/evidence/route.ts"),
      "utf8",
    );
    expect(route).toContain("authorizeCurrentRequestAgreementPdf");
    expect(route).toContain("authorizeAcceptedAgreementPdf");
    expect(route).toContain('searchParams.get("documentId")');
    expect(route).toContain('"Cache-Control": "private, no-store, max-age=0"');
    expect(route).toContain('"Content-Security-Policy": "default-src \'none\'; sandbox"');
    expect(route).not.toMatch(/storageKey|R2_BUCKET|GetObjectCommand/);
  });

  it("requires the accepted snapshot identity to match an append-only ledger revision", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "server/domain/agreement-pdfs/evidence.ts"),
      "utf8",
    );
    expect(source).toContain("findAgreementPdfRevision");
    expect(source).toContain("resolved.documentId !== input.expectedDocumentId");
    expect(source).toContain("JSON.stringify(resolved) !== JSON.stringify(snapshot)");
    expect(source).toContain("eq(clientContacts.clerkUserId, input.clerkUserId)");
    expect(source).toContain("eq(producers.clerkUserId, input.clerkUserId)");
  });

  it("freezes the current revision only inside final acceptance's product lock", () => {
    const acceptance = fs.readFileSync(
      path.join(ROOT, "server/domain/purchases/store-acceptance.ts"),
      "utf8",
    );
    const finalAcceptance = acceptance.slice(
      acceptance.indexOf("export async function acceptStorePurchase"),
    );
    expect(acceptance).toContain("currentAgreementPdfRevision(context.product.contractUrl)");
    expect(finalAcceptance.indexOf('.for("update")')).toBeGreaterThan(0);
    expect(finalAcceptance.indexOf("const terms = buildTerms")).toBeGreaterThan(
      finalAcceptance.indexOf('.for("update")'),
    );
    expect(
      finalAcceptance.indexOf("terms.snapshotDigest !== input.expectedSnapshotDigest"),
    ).toBeGreaterThan(finalAcceptance.indexOf("const terms = buildTerms"));
    expect(finalAcceptance.indexOf("commercialSnapshot: terms.snapshot")).toBeGreaterThan(
      finalAcceptance.indexOf("terms.snapshotDigest !== input.expectedSnapshotDigest"),
    );

    const requestIdentity = fs.readFileSync(
      path.join(ROOT, "server/domain/purchase-requests/service.ts"),
      "utf8",
    );
    expect(requestIdentity).not.toMatch(/agreementPdf|documentId|contractUrl/);
  });
});
