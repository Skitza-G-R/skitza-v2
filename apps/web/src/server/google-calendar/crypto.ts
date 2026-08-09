import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import type { GoogleCalendarEncryptionKeyring } from "./config";

const ENVELOPE_VERSION = 1 as const;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_PROTECTED_VALUE_BYTES = 4 * 1024;
const MAX_BINDING_LENGTH = 200;

export type GoogleCalendarProtectedValuePurpose =
  | "access_token"
  | "refresh_token"
  | "provider_calendar_id";

export type EncryptedGoogleCalendarValue = Readonly<{
  version: number;
  keyVersion: number;
  ciphertext: string;
  iv: string;
  authTag: string;
}>;

export class GoogleCalendarCryptoError extends Error {
  constructor() {
    super("Unable to open protected Google Calendar data");
    this.name = "GoogleCalendarCryptoError";
  }
}

type CredentialValueContext = Readonly<{
  producerId: string;
  connectionId: string;
  googleSubject: string;
  accountVersion: number;
  purpose: "access_token" | "refresh_token";
}>;

type CalendarIdValueContext = Readonly<{
  producerId: string;
  connectionId: string;
  selectionId: string;
  accountVersion: number;
  purpose: "provider_calendar_id";
}>;

export type GoogleCalendarProtectedValueContext = CredentialValueContext | CalendarIdValueContext;

function assertContext(context: GoogleCalendarProtectedValueContext): void {
  if (
    !context.producerId ||
    context.producerId.length > MAX_BINDING_LENGTH ||
    !context.connectionId ||
    context.connectionId.length > MAX_BINDING_LENGTH ||
    !Number.isSafeInteger(context.accountVersion) ||
    context.accountVersion < 1 ||
    context.producerId.includes("\0") ||
    context.connectionId.includes("\0")
  ) {
    throw new GoogleCalendarCryptoError();
  }
  if (context.purpose === "provider_calendar_id") {
    if (
      !context.selectionId ||
      context.selectionId.length > MAX_BINDING_LENGTH ||
      context.selectionId.includes("\0")
    ) {
      throw new GoogleCalendarCryptoError();
    }
    return;
  }
  if (
    !context.googleSubject ||
    context.googleSubject.length > MAX_BINDING_LENGTH ||
    context.googleSubject.includes("\0")
  ) {
    throw new GoogleCalendarCryptoError();
  }
}

function authenticatedContext(
  context: GoogleCalendarProtectedValueContext,
  keyVersion: number,
): Buffer {
  assertContext(context);
  const binding =
    context.purpose === "provider_calendar_id" ? [context.selectionId] : [context.googleSubject];
  return Buffer.from(
    [
      "skitza:google-calendar:protected-value:v1",
      context.purpose,
      context.producerId,
      context.connectionId,
      String(context.accountVersion),
      ...binding,
      String(keyVersion),
    ].join("\0"),
    "utf8",
  );
}

function decodeCanonicalBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new GoogleCalendarCryptoError();
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new GoogleCalendarCryptoError();
  }
  return decoded;
}

export function encryptGoogleCalendarValue(
  plaintext: string,
  context: GoogleCalendarProtectedValueContext,
  keyring: GoogleCalendarEncryptionKeyring,
): EncryptedGoogleCalendarValue {
  const value = Buffer.from(plaintext, "utf8");
  if (value.length < 1 || value.length > MAX_PROTECTED_VALUE_BYTES) {
    throw new GoogleCalendarCryptoError();
  }
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key || key.length !== 32) throw new GoogleCalendarCryptoError();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(authenticatedContext(context, keyring.activeVersion));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    version: ENVELOPE_VERSION,
    keyVersion: keyring.activeVersion,
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
  };
}

export function decryptGoogleCalendarValue(
  envelope: EncryptedGoogleCalendarValue,
  context: GoogleCalendarProtectedValueContext,
  keyring: GoogleCalendarEncryptionKeyring,
): string {
  try {
    if (envelope.version !== ENVELOPE_VERSION) throw new GoogleCalendarCryptoError();
    const key = keyring.keys.get(envelope.keyVersion);
    if (!key || key.length !== 32) throw new GoogleCalendarCryptoError();
    const iv = decodeCanonicalBase64Url(envelope.iv, IV_BYTES);
    const authTag = decodeCanonicalBase64Url(envelope.authTag, AUTH_TAG_BYTES);
    const ciphertext = decodeCanonicalBase64Url(envelope.ciphertext);
    if (ciphertext.length < 1 || ciphertext.length > MAX_PROTECTED_VALUE_BYTES) {
      throw new GoogleCalendarCryptoError();
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(authenticatedContext(context, envelope.keyVersion));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof GoogleCalendarCryptoError) throw error;
    throw new GoogleCalendarCryptoError();
  }
}

export function fingerprintGoogleCalendarId(
  input: Readonly<{
    calendarId: string;
    producerId: string;
    connectionId: string;
    accountVersion: number;
    secret: Buffer;
  }>,
): string {
  if (
    input.secret.length !== 32 ||
    !input.calendarId ||
    !input.producerId ||
    input.producerId.length > MAX_BINDING_LENGTH ||
    input.producerId.includes("\0") ||
    !input.connectionId ||
    input.connectionId.length > MAX_BINDING_LENGTH ||
    input.connectionId.includes("\0") ||
    !Number.isSafeInteger(input.accountVersion) ||
    input.accountVersion < 1 ||
    Buffer.byteLength(input.calendarId, "utf8") > MAX_PROTECTED_VALUE_BYTES
  ) {
    throw new GoogleCalendarCryptoError();
  }
  return createHmac("sha256", input.secret)
    .update("skitza:google-calendar:calendar-id-fingerprint:v1\0", "utf8")
    .update(input.producerId, "utf8")
    .update("\0", "utf8")
    .update(input.connectionId, "utf8")
    .update("\0", "utf8")
    .update(String(input.accountVersion), "utf8")
    .update("\0", "utf8")
    .update(input.calendarId, "utf8")
    .digest("hex")
    .replace(/^/u, "hmac-sha256:");
}

export function deriveGoogleCalendarSelectionId(
  input: Readonly<{
    fingerprint: string;
    secret: Buffer;
  }>,
): string {
  if (input.secret.length !== 32 || !/^hmac-sha256:[0-9a-f]{64}$/u.test(input.fingerprint)) {
    throw new GoogleCalendarCryptoError();
  }
  const bytes = createHmac("sha256", input.secret)
    .update("skitza:google-calendar:selection-id:v1\0", "utf8")
    .update(input.fingerprint, "ascii")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
