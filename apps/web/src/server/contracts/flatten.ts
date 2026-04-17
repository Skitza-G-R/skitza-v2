// Server-side flatten+seal pipeline.
//
// Takes a signed-but-not-yet-flattened contract and produces the final
// PDF: the original with every field's signed value drawn onto it,
// followed by an appended audit certificate page. The merged PDF is
// uploaded to R2 under a new `final.pdf` key and the contract row is
// advanced to "completed".
//
// PKCS#7 sealing (the legal nice-to-have that embeds a signed envelope
// into the PDF) is deferred to B.5.1 — the `@signpdf/signer-p12` plugin
// isn't in our dep tree yet, and the pem→p12 conversion plumbing needs
// a real certificate to test against. The flattened PDF is still a
// valid signed artifact without the PKCS#7 layer; downstream viewers
// just won't see a "digitally signed" badge.
//
// Called from contract.ts#publicSign when the final recipient signs.
// Errors are caught at the call-site and logged; they don't fail the
// sign mutation (the DB still records everyone signed — we can re-run
// flatten on demand).
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  contractEvents,
  contractFields,
  contractRecipients,
  contracts,
  createDb,
  eq,
  type Db,
} from "@skitza/db";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { percentToPdfLib } from "~/lib/contracts/coords";
import { BUCKETS, getR2 } from "~/server/storage/r2";
// audit-cert is imported dynamically inside flattenAndSeal — static
// import would pull the .tsx file through vitest's vite transform,
// which can't handle Next's jsx: "preserve" tsconfig. Keeping the
// drawing path import-clean lets flatten.test.ts run in plain Node.

// ─── drawFieldsOntoPdf ───────────────────────────────────────────────
// Pure-ish transform over the PDF bytes. Exported standalone so it can
// be unit-tested without R2 / DB. Takes the original PDF + a flat list
// of fields (already merged with their signed or prefilled values) and
// returns new bytes with the fields rasterised onto the page content
// stream. No AcroForm widgets are produced — the output is truly
// flattened.

type FieldType =
  | "signature"
  | "initial"
  | "date"
  | "text"
  | "checkbox"
  | "dropdown"
  | "number";

type DrawField = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: FieldType;
  signedValue: string | null;
  prefilledValue: string | null;
};

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; kind: "png" | "jpeg" } | null {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const kind = match[1] as "png" | "jpeg";
  const b64 = match[2];
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  return { bytes: new Uint8Array(buf), kind };
}

function isChecked(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "checked" || v === "on" || v === "yes" || v === "1";
}

export async function drawFieldsOntoPdf(
  originalBytes: Uint8Array,
  fields: DrawField[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes);
  const pages = doc.getPages();
  // Embed Helvetica lazily — only if we actually draw text. Keeps the
  // no-op path (every field has no value) from rewriting the font table.
  let helveticaCache: Awaited<ReturnType<typeof doc.embedFont>> | null = null;
  const helvetica = async () => {
    if (helveticaCache) return helveticaCache;
    helveticaCache = await doc.embedFont(StandardFonts.Helvetica);
    return helveticaCache;
  };

  for (const f of fields) {
    const value = f.signedValue ?? f.prefilledValue;
    if (value === null || value === "") continue;

    // Schema is 1-indexed; pdf-lib is 0-indexed. Silently skip if out
    // of range — draws should never crash on a mal-pointed field.
    const pageIdx = f.page - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    if (!page) continue;
    const { width: pageW, height: pageH } = page.getSize();
    const rect = percentToPdfLib({ x: f.x, y: f.y, w: f.w, h: f.h }, pageW, pageH);

    if (f.type === "signature" || f.type === "initial") {
      const decoded = dataUrlToBytes(value);
      if (!decoded) continue;
      const img =
        decoded.kind === "png"
          ? await doc.embedPng(decoded.bytes)
          : await doc.embedJpg(decoded.bytes);
      page.drawImage(img, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      continue;
    }

    if (f.type === "checkbox") {
      const font = await helvetica();
      page.drawRectangle({
        x: rect.x + 2,
        y: rect.y + 2,
        width: Math.max(0, rect.width - 4),
        height: Math.max(0, rect.height - 4),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
      if (isChecked(value)) {
        // Inner tick — a centred "X" scaled to the box interior.
        const size = Math.max(8, rect.height * 0.6);
        const text = "X";
        const tw = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: rect.x + (rect.width - tw) / 2,
          y: rect.y + rect.height * 0.2,
          size,
          font,
          color: rgb(0, 0, 0),
        });
      }
      continue;
    }

    // text / date / number / dropdown → plain text
    const font = await helvetica();
    const size = Math.max(10, rect.height * 0.6);
    page.drawText(value, {
      x: rect.x,
      y: rect.y + rect.height * 0.2,
      size,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return await doc.save();
}

// ─── flattenAndSeal ─────────────────────────────────────────────────
// Full pipeline. Loads everything from R2 + DB, flattens, merges an
// audit cert, uploads, updates the contract row. Meant to be awaited
// synchronously inline with publicSign for now — for ~50KB PDFs this
// is fine. Phase 2+ moves this to a queued job.

let _sealWarned = false;
function warnSealSkipped(reason: string): void {
  if (_sealWarned) return;
  _sealWarned = true;
  console.warn(`[flatten] Skipping PKCS#7 seal: ${reason}. See TODO(B.5.1).`);
}

async function r2GetBytes(key: string): Promise<Uint8Array> {
  const res = await getR2().send(
    new GetObjectCommand({ Bucket: BUCKETS.docs, Key: key }),
  );
  if (!res.Body) {
    throw new Error(`R2 object has no body: ${key}`);
  }
  // The AWS SDK Body is a ReadableStream-like; transformToByteArray is
  // the canonical way to drain it in Node.
  const body = res.Body as { transformToByteArray: () => Promise<Uint8Array> };
  return await body.transformToByteArray();
}

async function r2PutBytes(key: string, bytes: Uint8Array): Promise<void> {
  await getR2().send(
    new PutObjectCommand({
      Bucket: BUCKETS.docs,
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
    }),
  );
}

function dbOrThrow(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("missing DATABASE_URL");
  return createDb(url);
}

export async function flattenAndSeal(contractId: string): Promise<{
  finalKey: string;
  sealed: boolean;
}> {
  const db = dbOrThrow();

  const [contract] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract) throw new Error(`contract not found: ${contractId}`);

  const [fields, recipients, events] = await Promise.all([
    db.select().from(contractFields).where(eq(contractFields.contractId, contractId)),
    db.select().from(contractRecipients).where(eq(contractRecipients.contractId, contractId)),
    db.select().from(contractEvents).where(eq(contractEvents.contractId, contractId)),
  ]);

  // 1. Flatten original with drawn fields.
  const originalBytes = await r2GetBytes(contract.pdfR2Key);
  const drawFields: DrawField[] = fields.map((f) => ({
    page: f.page,
    x: Number(f.x),
    y: Number(f.y),
    w: Number(f.w),
    h: Number(f.h),
    type: f.type,
    signedValue: f.signedValue,
    prefilledValue: f.prefilledValue,
  }));
  const flattenedBytes = await drawFieldsOntoPdf(originalBytes, drawFields);

  // 2. Audit cert. Dynamic import — see comment on the module-level
  //    import block above.
  const { buildAuditCert } = await import("./audit-cert");
  const auditBuffer = await buildAuditCert({ contract, recipients, events });
  const auditBytes = new Uint8Array(auditBuffer);

  // 3. Merge: copyPages from audit into flattened.
  const mergedDoc = await PDFDocument.load(flattenedBytes);
  const auditDoc = await PDFDocument.load(auditBytes);
  const auditPages = await mergedDoc.copyPages(auditDoc, auditDoc.getPageIndices());
  for (const p of auditPages) mergedDoc.addPage(p);
  const mergedBytes = await mergedDoc.save();

  // 4. Optional PKCS#7 seal. Deferred to B.5.1 — we lack the
  //    signer-p12 package + a real cert to plumb through. The merged
  //    PDF is still valid and useful without it; viewers just won't
  //    show a "digitally signed" badge. The env vars are inspected
  //    purely so ops can tell from the warning whether they set them
  //    up in anticipation of the (not-yet-live) sealing path.
  const sealed = false;
  const pem = process.env.SIGNPDF_PEM_BASE64;
  const passphrase = process.env.SIGNPDF_PASSPHRASE;
  if (pem && passphrase) {
    warnSealSkipped("sealing path not yet implemented (TODO B.5.1)");
  } else {
    warnSealSkipped("SIGNPDF_PEM_BASE64/SIGNPDF_PASSPHRASE not set");
  }

  // 5. Upload final.
  const finalKey = `producers/${contract.producerId}/contracts/${contract.id}/final.pdf`;
  await r2PutBytes(finalKey, mergedBytes);

  // 6. Advance contract. Use a single updatedAt for both columns.
  const now = new Date();
  await db
    .update(contracts)
    .set({ finalPdfR2Key: finalKey, status: "completed", updatedAt: now })
    .where(eq(contracts.id, contractId));
  await db.insert(contractEvents).values({
    contractId,
    event: "completed",
    metadata: { finalKey, sealed },
  });

  return { finalKey, sealed };
}
