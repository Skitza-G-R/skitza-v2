const MAX_RANGE_HEADER_LENGTH = 200;
const PRIVATE_CACHE_CONTROL = "private, no-store, max-age=0";
const FALLBACK_AUDIO_CONTENT_TYPE = "application/octet-stream";
const FALLBACK_DOWNLOAD_FILE_NAME = "audio-download";

export type AudioByteRange = Readonly<{
  start: number;
  end: number;
  length: number;
}>;

export class AudioRangeNotSatisfiableError extends Error {
  readonly sizeBytes: number;

  constructor(sizeBytes: number) {
    super("The requested audio range is not satisfiable");
    this.name = "AudioRangeNotSatisfiableError";
    this.sizeBytes = sizeBytes;
  }
}

function rangeError(sizeBytes: number): never {
  throw new AudioRangeNotSatisfiableError(sizeBytes);
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parseSafeInteger(value: string, sizeBytes: number): number {
  if (!/^\d+$/.test(value)) rangeError(sizeBytes);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) rangeError(sizeBytes);
  return parsed;
}

/** Parse one RFC 9110 byte range. Multipart ranges are deliberately unsupported. */
export function parseSingleByteRange(
  rangeHeader: string | null | undefined,
  sizeBytes: number,
): AudioByteRange | null {
  if (!isSafePositiveInteger(sizeBytes)) rangeError(sizeBytes);
  if (rangeHeader === null || rangeHeader === undefined) return null;

  const normalized = rangeHeader.trim();
  if (normalized.length === 0 || normalized.length > MAX_RANGE_HEADER_LENGTH) {
    rangeError(sizeBytes);
  }
  if (normalized.includes(",")) rangeError(sizeBytes);

  const match = /^bytes=(\d*)-(\d*)$/i.exec(normalized);
  if (!match) rangeError(sizeBytes);
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart.length === 0 && rawEnd.length === 0) rangeError(sizeBytes);

  if (rawStart.length === 0) {
    const suffixLength = parseSafeInteger(rawEnd, sizeBytes);
    if (suffixLength === 0) rangeError(sizeBytes);
    const start = Math.max(sizeBytes - suffixLength, 0);
    return Object.freeze({ start, end: sizeBytes - 1, length: sizeBytes - start });
  }

  const start = parseSafeInteger(rawStart, sizeBytes);
  if (start >= sizeBytes) rangeError(sizeBytes);

  const requestedEnd = rawEnd.length === 0 ? sizeBytes - 1 : parseSafeInteger(rawEnd, sizeBytes);
  if (requestedEnd < start) rangeError(sizeBytes);
  const end = Math.min(requestedEnd, sizeBytes - 1);
  return Object.freeze({ start, end, length: end - start + 1 });
}

function assertExactRange(range: AudioByteRange, sizeBytes: number): void {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    !Number.isSafeInteger(range.length) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end >= sizeBytes ||
    range.length !== range.end - range.start + 1
  ) {
    rangeError(sizeBytes);
  }
}

export function normalizeAudioContentType(contentType: string | null | undefined): string {
  const normalized = contentType?.trim().toLowerCase() ?? "";
  return /^audio\/[a-z0-9!#$&^_.+-]+$/.test(normalized) ? normalized : FALLBACK_AUDIO_CONTENT_TYPE;
}

function replaceUnsafeFileNameCodePoints(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint >= 0 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
      ? "_"
      : character;
  }).join("");
}

/** Remove path, control, bidi, header-delimiter, and platform-reserved characters. */
export function safeAudioDownloadFileName(fileName: string): string {
  if (typeof fileName !== "string") return FALLBACK_DOWNLOAD_FILE_NAME;
  const normalized = replaceUnsafeFileNameCodePoints(fileName.normalize("NFKC"))
    .replace(/[\\/:*?"<>|;]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[ .]+$/, "")
    .trim();
  const bounded = Array.from(normalized)
    .slice(0, 180)
    .join("")
    .replace(/[ .]+$/, "");
  return bounded || FALLBACK_DOWNLOAD_FILE_NAME;
}

function encodeRfc5987FileName(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function audioDownloadContentDisposition(fileName: string): string {
  const safeFileName = safeAudioDownloadFileName(fileName);
  const asciiFallback =
    safeFileName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .slice(0, 120)
      .replace(/[ .]+$/, "") || FALLBACK_DOWNLOAD_FILE_NAME;
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987FileName(safeFileName)}`;
}

export function privateAudioSecurityHeaders(): Headers {
  return new Headers({
    "Cache-Control": PRIVATE_CACHE_CONTROL,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

export function privateAudioResponseHeaders(
  input: Readonly<{
    contentType: string | null | undefined;
    sizeBytes: number;
    range?: AudioByteRange | null;
    downloadFileName?: string;
  }>,
): Headers {
  if (!isSafePositiveInteger(input.sizeBytes)) rangeError(input.sizeBytes);
  if (input.range) assertExactRange(input.range, input.sizeBytes);

  const headers = privateAudioSecurityHeaders();
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(input.range?.length ?? input.sizeBytes));
  headers.set("Content-Type", normalizeAudioContentType(input.contentType));
  headers.set(
    "Content-Disposition",
    input.downloadFileName === undefined
      ? "inline"
      : audioDownloadContentDisposition(input.downloadFileName),
  );
  if (input.range) {
    headers.set(
      "Content-Range",
      `bytes ${String(input.range.start)}-${String(input.range.end)}/${String(input.sizeBytes)}`,
    );
  }
  return headers;
}

export function privateAudioRangeNotSatisfiableHeaders(sizeBytes: number): Headers {
  if (!isSafePositiveInteger(sizeBytes)) rangeError(sizeBytes);
  const headers = privateAudioSecurityHeaders();
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Range", `bytes */${String(sizeBytes)}`);
  return headers;
}
