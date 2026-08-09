export const AGREEMENT_PDF_CONTENT_TYPE = "application/pdf" as const;
export const MAX_AGREEMENT_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_AGREEMENT_PDF_FILE_NAME_LENGTH = 200;

export type AgreementPdfClientSnapshot = Readonly<{
  documentId: string;
  originalFileName: string;
  contentType: typeof AGREEMENT_PDF_CONTENT_TYPE;
  sizeBytes: number;
  objectEtag: string;
  sha256: string;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function agreementPdfFileError(input: {
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
}): string | null {
  const name = input.originalFileName.trim();
  if (
    name.length === 0 ||
    name.length > MAX_AGREEMENT_PDF_FILE_NAME_LENGTH ||
    name.includes("/") ||
    name.includes("\\") ||
    Array.from(name).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    return "Choose a PDF with a valid file name.";
  }
  if (!name.toLowerCase().endsWith(".pdf") || input.contentType !== AGREEMENT_PDF_CONTENT_TYPE) {
    return "Choose a PDF file.";
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_AGREEMENT_PDF_BYTES
  ) {
    return "Agreement PDFs must be between 1 byte and 15 MB.";
  }
  return null;
}

export function parseAgreementPdfClientSnapshot(value: unknown): AgreementPdfClientSnapshot | null {
  if (!isPlainRecord(value)) return null;
  if (
    !hasExactKeys(value, [
      "documentId",
      "originalFileName",
      "contentType",
      "sizeBytes",
      "objectEtag",
      "sha256",
    ]) ||
    typeof value.documentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.documentId,
    ) ||
    typeof value.originalFileName !== "string" ||
    typeof value.contentType !== "string" ||
    typeof value.sizeBytes !== "number" ||
    agreementPdfFileError({
      originalFileName: value.originalFileName,
      contentType: value.contentType,
      sizeBytes: value.sizeBytes,
    }) !== null ||
    typeof value.objectEtag !== "string" ||
    value.objectEtag.length === 0 ||
    value.objectEtag.length > 200 ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.sha256)
  ) {
    return null;
  }
  return Object.freeze({
    documentId: value.documentId,
    originalFileName: value.originalFileName.trim(),
    contentType: AGREEMENT_PDF_CONTENT_TYPE,
    sizeBytes: value.sizeBytes,
    objectEtag: value.objectEtag,
    sha256: value.sha256,
  });
}

export function agreementPdfFromCommercialSnapshot(
  snapshot: unknown,
): AgreementPdfClientSnapshot | null {
  if (!isPlainRecord(snapshot) || !Object.prototype.hasOwnProperty.call(snapshot, "agreementPdf")) {
    return null;
  }
  return parseAgreementPdfClientSnapshot(snapshot.agreementPdf);
}
