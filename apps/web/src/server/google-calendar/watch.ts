import { createHash, randomBytes, randomUUID } from "node:crypto";

const CHANNEL_TOKEN_BYTES = 32;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_NUMBER_PATTERN = /^[1-9][0-9]{0,38}$/u;
const CHANNEL_TOKEN_MAX_BYTES = 256;
const RESOURCE_ID_MAX_BYTES = 2_048;

export const GOOGLE_CALENDAR_WATCH_RENEW_BEFORE_MS = 24 * 60 * 60 * 1_000;

export type GoogleCalendarWebhookResourceState = "sync" | "exists" | "not_exists";

export type GoogleCalendarWebhookNotification = Readonly<{
  channelId: string;
  resourceId: string;
  channelTokenDigest: string;
  messageNumber: string;
  resourceState: GoogleCalendarWebhookResourceState;
}>;

export function createGoogleCalendarWatchCredentials(): Readonly<{
  channelId: string;
  channelToken: string;
  channelTokenDigest: string;
}> {
  const channelToken = randomBytes(CHANNEL_TOKEN_BYTES).toString("base64url");
  return {
    channelId: randomUUID(),
    channelToken,
    channelTokenDigest: digestGoogleCalendarWatchToken(channelToken),
  };
}

export function digestGoogleCalendarWatchToken(channelToken: string): string {
  return `sha256:${createHash("sha256").update(channelToken, "utf8").digest("hex")}`;
}

function opaqueHeader(headers: Headers, name: string, maxBytes: number): string | null {
  const value = headers.get(name);
  let hasControl = false;
  if (value !== null) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 31 || code === 127) {
        hasControl = true;
        break;
      }
    }
  }
  if (
    value === null ||
    !value ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    hasControl
  ) {
    return null;
  }
  return value;
}

/**
 * Google push notifications have no useful body. Only the documented trust
 * headers cross this boundary, and the raw channel token is immediately
 * reduced to its digest.
 */
export function parseGoogleCalendarWebhookHeaders(
  headers: Headers,
): GoogleCalendarWebhookNotification | null {
  const channelId = opaqueHeader(headers, "x-goog-channel-id", 64);
  const resourceId = opaqueHeader(headers, "x-goog-resource-id", RESOURCE_ID_MAX_BYTES);
  const channelToken = opaqueHeader(headers, "x-goog-channel-token", CHANNEL_TOKEN_MAX_BYTES);
  const messageNumber = opaqueHeader(headers, "x-goog-message-number", 39);
  const resourceState = opaqueHeader(headers, "x-goog-resource-state", 16);
  if (
    !channelId ||
    !CHANNEL_ID_PATTERN.test(channelId) ||
    !resourceId ||
    !channelToken ||
    !messageNumber ||
    !MESSAGE_NUMBER_PATTERN.test(messageNumber) ||
    (resourceState !== "sync" && resourceState !== "exists" && resourceState !== "not_exists")
  ) {
    return null;
  }
  return {
    channelId,
    resourceId,
    channelTokenDigest: digestGoogleCalendarWatchToken(channelToken),
    messageNumber,
    resourceState,
  };
}
