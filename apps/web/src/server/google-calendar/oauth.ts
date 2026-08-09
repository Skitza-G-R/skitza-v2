import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { GOOGLE_CALENDAR_SCOPES, type GoogleCalendarServerConfig } from "./config";

const STATE_VERSION = 1 as const;
const DEFAULT_STATE_LIFETIME_SECONDS = 10 * 60;
const MAX_STATE_LIFETIME_SECONDS = 10 * 60;
const MAX_STATE_TOKEN_LENGTH = 1_024;

export type GoogleCalendarOAuthIntent = "connect" | "reconnect" | "switch_account";

export type GoogleCalendarOAuthStateBinding = Readonly<{
  id: string;
  producerId: string;
  intent: GoogleCalendarOAuthIntent;
  connectionId: string | null;
  expectedAccountVersion: number | null;
  expiresAt: Date;
}>;

export type IssuedGoogleCalendarOAuthState = Readonly<{
  token: string;
  tokenDigest: string;
  binding: GoogleCalendarOAuthStateBinding;
  codeChallenge: string;
}>;

export class GoogleCalendarOAuthStateError extends Error {
  constructor() {
    super("Google Calendar authorization could not be verified");
    this.name = "GoogleCalendarOAuthStateError";
  }
}

type StatePayload = Readonly<{
  v: number;
  id: string;
  iat: number;
  exp: number;
  nonce: string;
}>;

function bindingMessage(
  encodedPayload: string,
  binding: Omit<GoogleCalendarOAuthStateBinding, "expiresAt" | "id">,
): string {
  return [
    "skitza:google-calendar:oauth-state:v1",
    encodedPayload,
    binding.producerId,
    binding.intent,
    binding.connectionId ?? "",
    binding.expectedAccountVersion === null ? "" : String(binding.expectedAccountVersion),
  ].join("\0");
}

function signState(
  encodedPayload: string,
  binding: Omit<GoogleCalendarOAuthStateBinding, "expiresAt" | "id">,
  secret: Buffer,
): string {
  return createHmac("sha256", secret)
    .update(bindingMessage(encodedPayload, binding), "utf8")
    .digest("base64url");
}

function assertBindingShape(
  binding: Omit<GoogleCalendarOAuthStateBinding, "expiresAt" | "id">,
): void {
  const connectShape =
    binding.intent === "connect" &&
    binding.connectionId === null &&
    binding.expectedAccountVersion === null;
  const existingShape =
    binding.intent !== "connect" &&
    typeof binding.connectionId === "string" &&
    binding.connectionId.length > 0 &&
    binding.connectionId.length <= 200 &&
    Number.isSafeInteger(binding.expectedAccountVersion) &&
    (binding.expectedAccountVersion ?? 0) > 0;
  if (
    (!connectShape && !existingShape) ||
    !binding.producerId ||
    binding.producerId.length > 200 ||
    binding.producerId.includes("\0") ||
    binding.connectionId?.includes("\0")
  ) {
    throw new GoogleCalendarOAuthStateError();
  }
}

export function digestGoogleCalendarOAuthStateToken(token: string): string {
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function parsePayload(encoded: string): StatePayload {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error();
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) throw new Error();
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as StatePayload).v !== STATE_VERSION ||
      typeof (value as StatePayload).id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        (value as StatePayload).id,
      ) ||
      !Number.isSafeInteger((value as StatePayload).iat) ||
      !Number.isSafeInteger((value as StatePayload).exp) ||
      typeof (value as StatePayload).nonce !== "string" ||
      !/^[A-Za-z0-9_-]{22}$/u.test((value as StatePayload).nonce)
    ) {
      throw new Error();
    }
    return value as StatePayload;
  } catch {
    throw new GoogleCalendarOAuthStateError();
  }
}

export function createGoogleCalendarOAuthState(
  input: Readonly<{
    producerId: string;
    intent: GoogleCalendarOAuthIntent;
    connectionId: string | null;
    expectedAccountVersion: number | null;
    stateSecret: Buffer;
    now?: Date;
    lifetimeSeconds?: number;
  }>,
): IssuedGoogleCalendarOAuthState {
  const bindingInput = {
    producerId: input.producerId,
    intent: input.intent,
    connectionId: input.connectionId,
    expectedAccountVersion: input.expectedAccountVersion,
  } as const;
  assertBindingShape(bindingInput);
  if (input.stateSecret.length !== 32) throw new GoogleCalendarOAuthStateError();

  const lifetime = input.lifetimeSeconds ?? DEFAULT_STATE_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > MAX_STATE_LIFETIME_SECONDS) {
    throw new GoogleCalendarOAuthStateError();
  }
  const now = input.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const payload: StatePayload = {
    v: STATE_VERSION,
    id: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + lifetime,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const token = `${encodedPayload}.${signState(encodedPayload, bindingInput, input.stateSecret)}`;
  const binding: GoogleCalendarOAuthStateBinding = {
    id: payload.id,
    ...bindingInput,
    expiresAt: new Date(payload.exp * 1_000),
  };
  return {
    token,
    tokenDigest: digestGoogleCalendarOAuthStateToken(token),
    binding,
    codeChallenge: deriveGoogleCalendarPkce(token, input.producerId, input.stateSecret)
      .codeChallenge,
  };
}

export function verifyGoogleCalendarOAuthState(
  input: Readonly<{
    token: string;
    tokenDigest: string;
    binding: GoogleCalendarOAuthStateBinding;
    stateSecret: Buffer;
    now?: Date;
  }>,
): void {
  try {
    if (!input.token || input.token.length > MAX_STATE_TOKEN_LENGTH) throw new Error();
    if (input.stateSecret.length !== 32) throw new Error();
    assertBindingShape(input.binding);
    const parts = input.token.split(".");
    if (parts.length !== 2) throw new Error();
    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature || !/^[A-Za-z0-9_-]{43}$/u.test(signature)) {
      throw new Error();
    }
    const payload = parsePayload(encodedPayload);
    const expectedSignature = signState(encodedPayload, input.binding, input.stateSecret);
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    const persistedExpiry = Math.floor(input.binding.expiresAt.getTime() / 1_000);
    if (
      !safeEqual(signature, expectedSignature) ||
      !safeEqual(digestGoogleCalendarOAuthStateToken(input.token), input.tokenDigest) ||
      payload.id !== input.binding.id ||
      payload.exp !== persistedExpiry ||
      payload.exp <= nowSeconds ||
      payload.iat > nowSeconds + 60 ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > MAX_STATE_LIFETIME_SECONDS
    ) {
      throw new Error();
    }
  } catch (error) {
    if (error instanceof GoogleCalendarOAuthStateError) throw error;
    throw new GoogleCalendarOAuthStateError();
  }
}

export function deriveGoogleCalendarPkce(
  stateToken: string,
  producerId: string,
  stateSecret: Buffer,
): Readonly<{ codeVerifier: string; codeChallenge: string }> {
  if (
    !stateToken ||
    stateToken.length > MAX_STATE_TOKEN_LENGTH ||
    !producerId ||
    producerId.length > 200 ||
    producerId.includes("\0") ||
    stateSecret.length !== 32
  ) {
    throw new GoogleCalendarOAuthStateError();
  }
  const codeVerifier = createHmac("sha256", stateSecret)
    .update("skitza:google-calendar:pkce:v1\0", "utf8")
    .update(producerId, "utf8")
    .update("\0", "utf8")
    .update(stateToken, "utf8")
    .digest("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildGoogleCalendarAuthorizationUrl(
  input: Readonly<{
    config: GoogleCalendarServerConfig;
    stateToken: string;
    codeChallenge: string;
  }>,
): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", input.stateToken);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
