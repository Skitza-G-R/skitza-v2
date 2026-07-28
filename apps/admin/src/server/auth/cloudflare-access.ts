import { encode as encodeBase64url } from "jose/base64url";
import { createRemoteJWKSet } from "jose/jwks/remote";
import { jwtVerify, type JWTVerifyGetKey } from "jose/jwt/verify";
import type { JWTPayload } from "jose";

export const CLOUDFLARE_ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
export const CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV =
  "CLOUDFLARE_ACCESS_TEAM_DOMAIN";
export const CLOUDFLARE_ACCESS_AUDIENCE_ENV = "CLOUDFLARE_ACCESS_AUD";
export const CLOUDFLARE_ACCESS_FOUNDER_SUBJECT_ENV =
  "CLOUDFLARE_ACCESS_FOUNDER_SUB";
export const ADMIN_CANONICAL_HOST_ENV = "ADMIN_CANONICAL_HOST";

const CLOUDFLARE_ACCESS_DOMAIN_SUFFIX = ".cloudflareaccess.com";
const VERCEL_HOST_SUFFIX = ".vercel.app";
const CLOUDFLARE_TEAM_NAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const REQUIRED_ACCESS_CLAIMS = [
  "aud",
  "email",
  "exp",
  "iat",
  "iss",
  "nbf",
  "sub",
  "type",
] as const;

export type CloudflareAccessEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type CloudflareAccessConfiguration = Readonly<{
  audience: string;
  canonicalHost: string;
  founderSubject: string;
  issuer: string;
  jwksUrl: URL;
}>;

export type CloudflareAccessIdentity = Readonly<{
  audience: string;
  email: string;
  expiresAt: number;
  issuedAt: number;
  issuer: string;
  notBefore: number;
  subject: string;
  tokenFingerprint: string;
}>;

export type CloudflareAccessVerificationFailureReason =
  | "configuration-invalid"
  | "token-required"
  | "token-invalid";

export class CloudflareAccessVerificationError extends Error {
  readonly reason: CloudflareAccessVerificationFailureReason;

  constructor(reason: CloudflareAccessVerificationFailureReason) {
    super("Cloudflare Access verification failed.");
    this.name = "CloudflareAccessVerificationError";
    this.reason = reason;
  }
}

type CloudflareAccessClaims = JWTPayload &
  Readonly<{
    email?: unknown;
    type?: unknown;
  }>;
type CloudflareAccessClaimsIdentity = Omit<
  CloudflareAccessIdentity,
  "tokenFingerprint"
>;

type HeadersWithGet = Readonly<{
  get(name: string): string | null;
}>;

export type CloudflareAccessVerificationOptions = Readonly<{
  currentDate?: Date;
  environment?: CloudflareAccessEnvironment;
  keyResolver?: JWTVerifyGetKey;
}>;

const remoteKeyResolvers = new Map<string, JWTVerifyGetKey>();

function stop(
  reason: CloudflareAccessVerificationFailureReason,
): never {
  throw new CloudflareAccessVerificationError(reason);
}

function containsForbiddenAscii(
  value: string,
  includeSpace: boolean,
): boolean {
  const upperBound = includeSpace ? 0x20 : 0x1f;
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= upperBound || codePoint === 0x7f)
    );
  });
}

function normalizeTeamDomain(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return stop("configuration-invalid");

  let parsed: URL;
  try {
    parsed = new URL(
      candidate.includes("://") ? candidate : `https://${candidate}`,
    );
  } catch {
    return stop("configuration-invalid");
  }

  const hostname = parsed.hostname.toLowerCase();
  const teamName = hostname.slice(
    0,
    -CLOUDFLARE_ACCESS_DOMAIN_SUFFIX.length,
  );
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash ||
    !hostname.endsWith(CLOUDFLARE_ACCESS_DOMAIN_SUFFIX) ||
    !CLOUDFLARE_TEAM_NAME_PATTERN.test(teamName)
  ) {
    return stop("configuration-invalid");
  }

  return `https://${hostname}`;
}

function normalizeCanonicalHost(value: string | undefined): string {
  const candidate = value?.trim().toLowerCase();
  if (
    !candidate ||
    candidate.includes("://") ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.includes(",") ||
    /\s/.test(candidate)
  ) {
    return stop("configuration-invalid");
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${candidate}`);
  } catch {
    return stop("configuration-invalid");
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.host !== candidate ||
    parsed.hostname === "vercel.app" ||
    parsed.hostname.endsWith(VERCEL_HOST_SUFFIX)
  ) {
    return stop("configuration-invalid");
  }

  return candidate;
}

function normalizeFounderSubject(value: string | undefined): string {
  const subject = value?.trim();
  if (
    !subject ||
    subject.length > 512 ||
    containsForbiddenAscii(subject, false)
  ) {
    return stop("configuration-invalid");
  }
  return subject;
}

export function resolveCloudflareAccessConfiguration(
  environment: CloudflareAccessEnvironment = process.env,
): CloudflareAccessConfiguration {
  const issuer = normalizeTeamDomain(
    environment[CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV],
  );
  const audience =
    environment[CLOUDFLARE_ACCESS_AUDIENCE_ENV]?.trim();
  if (
    !audience ||
    audience.length > 512 ||
    containsForbiddenAscii(audience, true)
  ) {
    return stop("configuration-invalid");
  }

  return {
    audience,
    canonicalHost: normalizeCanonicalHost(
      environment[ADMIN_CANONICAL_HOST_ENV],
    ),
    founderSubject: normalizeFounderSubject(
      environment[CLOUDFLARE_ACCESS_FOUNDER_SUBJECT_ENV],
    ),
    issuer,
    jwksUrl: new URL("/cdn-cgi/access/certs", issuer),
  };
}

function getRemoteKeyResolver(
  configuration: CloudflareAccessConfiguration,
): JWTVerifyGetKey {
  const cacheKey = configuration.jwksUrl.href;
  const cached = remoteKeyResolvers.get(cacheKey);
  if (cached) return cached;

  const resolver = createRemoteJWKSet(configuration.jwksUrl);
  remoteKeyResolvers.set(cacheKey, resolver);
  return resolver;
}

function isExactAudience(
  actual: JWTPayload["aud"],
  expected: string,
): boolean {
  if (typeof actual === "string") return actual === expected;
  return (
    Array.isArray(actual) &&
    actual.length === 1 &&
    actual[0] === expected
  );
}

function isValidNumericDate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function readIdentity(
  payload: CloudflareAccessClaims,
  configuration: CloudflareAccessConfiguration,
  currentDate: Date,
): CloudflareAccessClaimsIdentity {
  const subject =
    typeof payload.sub === "string" ? payload.sub.trim() : "";
  const email =
    typeof payload.email === "string" ? payload.email.trim() : "";
  const now = Math.floor(currentDate.getTime() / 1_000);

  if (
    subject !== configuration.founderSubject ||
    !email ||
    payload.type !== "app" ||
    payload.iss !== configuration.issuer ||
    !isExactAudience(payload.aud, configuration.audience) ||
    !isValidNumericDate(payload.exp) ||
    !isValidNumericDate(payload.iat) ||
    !isValidNumericDate(payload.nbf) ||
    !Number.isFinite(now) ||
    payload.iat > now ||
    payload.iat >= payload.exp ||
    payload.nbf >= payload.exp
  ) {
    return stop("token-invalid");
  }

  return {
    audience: configuration.audience,
    email: email.toLowerCase(),
    expiresAt: payload.exp,
    issuedAt: payload.iat,
    issuer: configuration.issuer,
    notBefore: payload.nbf,
    subject,
  };
}

async function fingerprintToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return encodeBase64url(new Uint8Array(digest));
}

function requireCanonicalRequestHost(
  headerValue: string | null,
  canonicalHost: string,
): void {
  const candidate = headerValue?.trim().toLowerCase();
  if (
    !candidate ||
    candidate.includes("://") ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.includes(",") ||
    /\s/.test(candidate)
  ) {
    return stop("token-invalid");
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${candidate}`);
  } catch {
    return stop("token-invalid");
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.host !== candidate ||
    parsed.host !== canonicalHost
  ) {
    return stop("token-invalid");
  }
}

/**
 * Verifies the Cloudflare Access application token at the admin origin.
 *
 * The default key resolver uses Cloudflare's rotating JWKS. Tests can inject a
 * local resolver so token verification never needs the network.
 */
export async function verifyCloudflareAccessJwt(
  tokenValue: string | null | undefined,
  options: CloudflareAccessVerificationOptions = {},
): Promise<CloudflareAccessIdentity> {
  const token = tokenValue?.trim();
  if (!token) return stop("token-required");

  const configuration = resolveCloudflareAccessConfiguration(
    options.environment,
  );
  const currentDate = options.currentDate ?? new Date();
  if (Number.isNaN(currentDate.getTime())) {
    return stop("configuration-invalid");
  }

  let payload: CloudflareAccessClaims;
  try {
    const result = await jwtVerify<CloudflareAccessClaims>(
      token,
      options.keyResolver ?? getRemoteKeyResolver(configuration),
      {
        algorithms: ["RS256"],
        audience: configuration.audience,
        currentDate,
        issuer: configuration.issuer,
        requiredClaims: [...REQUIRED_ACCESS_CLAIMS],
      },
    );
    payload = result.payload;
  } catch {
    return stop("token-invalid");
  }

  return {
    ...readIdentity(payload, configuration, currentDate),
    tokenFingerprint: await fingerprintToken(token),
  };
}

export async function verifyCloudflareAccessHeaders(
  headers: HeadersWithGet,
  options: CloudflareAccessVerificationOptions = {},
): Promise<CloudflareAccessIdentity> {
  const identity = await verifyCloudflareAccessJwt(
    headers.get(CLOUDFLARE_ACCESS_JWT_HEADER),
    options,
  );
  const configuration = resolveCloudflareAccessConfiguration(
    options.environment,
  );
  requireCanonicalRequestHost(
    headers.get("host"),
    configuration.canonicalHost,
  );
  return identity;
}
