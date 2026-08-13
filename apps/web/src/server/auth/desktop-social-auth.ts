import { createHash, randomBytes } from "node:crypto";

import {
  and,
  createDb,
  desktopAuthCodes,
  eq,
  gt,
  isNull,
  producers,
  sql,
  type Db,
} from "@skitza/db";

export const DESKTOP_AUTH_CODE_LIFETIME_SECONDS = 60 as const;
export const DESKTOP_AUTH_CALLBACK = "skitza://auth/callback" as const;
export const DESKTOP_AUTH_START_PATH = "/api/desktop/auth/start" as const;
export const DESKTOP_AUTH_EXCHANGE_PATH = "/api/desktop/auth/exchange" as const;

const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;

export type DesktopSocialAuthStore = Readonly<{
  consume(
    input: Readonly<{
      codeDigest: string;
      pkceChallenge: string;
    }>,
  ): Promise<Readonly<{ clerkUserId: string }> | null>;
  issue(
    input: Readonly<{
      codeDigest: string;
      pkceChallenge: string;
      producerId: string;
      stateDigest: string;
    }>,
  ): Promise<void>;
}>;

export function isDesktopAuthState(value: string): boolean {
  return BASE64URL_32_BYTE_PATTERN.test(value);
}

export function isDesktopAuthCode(value: string): boolean {
  return BASE64URL_32_BYTE_PATTERN.test(value);
}

export function isDesktopPkceChallenge(value: string): boolean {
  return BASE64URL_32_BYTE_PATTERN.test(value);
}

export function isDesktopPkceVerifier(value: string): boolean {
  return PKCE_VERIFIER_PATTERN.test(value);
}

export function desktopAuthCodeDigest(code: string): string {
  return `sha256:${createHash("sha256").update(code, "utf8").digest("hex")}`;
}

export function desktopAuthStateDigest(state: string): string {
  return `sha256:${createHash("sha256").update(state, "utf8").digest("hex")}`;
}

export function desktopPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function trustedDesktopAuthOrigin(
  configuredSiteUrl = process.env.SITE_URL ?? "https://skitza.app",
): string | null {
  try {
    const url = new URL(configuredSiteUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function parseDesktopAuthStartUrl(
  url: URL,
  trustedOrigin = trustedDesktopAuthOrigin(),
): Readonly<{ codeChallenge: string; state: string }> | null {
  if (
    !trustedOrigin ||
    url.origin !== trustedOrigin ||
    url.protocol !== "https:" ||
    url.pathname !== DESKTOP_AUTH_START_PATH ||
    url.hash ||
    Array.from(url.searchParams.keys()).length !== 3 ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.getAll("code_challenge").length !== 1 ||
    url.searchParams.getAll("code_challenge_method").length !== 1
  ) {
    return null;
  }
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  if (
    !isDesktopAuthState(state) ||
    !isDesktopPkceChallenge(codeChallenge) ||
    url.searchParams.get("code_challenge_method") !== "S256"
  ) {
    return null;
  }
  return { codeChallenge, state };
}

export function desktopAuthCallbackUrl(input: Readonly<{ code: string; state: string }>): string {
  if (!isDesktopAuthCode(input.code) || !isDesktopAuthState(input.state)) {
    throw new Error("Invalid desktop authorization callback");
  }
  const callback = new URL(DESKTOP_AUTH_CALLBACK);
  callback.searchParams.set("code", input.code);
  callback.searchParams.set("state", input.state);
  return callback.toString();
}

export function createDesktopSocialAuthStore(db: Db): DesktopSocialAuthStore {
  return {
    async issue(input) {
      await db.insert(desktopAuthCodes).values({
        ...input,
        createdAt: sql`now()`,
        expiresAt: sql`now() + interval '60 seconds'`,
      });
    },
    async consume(input) {
      return db.transaction(async (tx) => {
        const [consumed] = await tx
          .update(desktopAuthCodes)
          .set({ consumedAt: sql`now()` })
          .where(
            and(
              eq(desktopAuthCodes.codeDigest, input.codeDigest),
              eq(desktopAuthCodes.pkceChallenge, input.pkceChallenge),
              isNull(desktopAuthCodes.consumedAt),
              gt(desktopAuthCodes.expiresAt, sql`now()`),
            ),
          )
          .returning({ producerId: desktopAuthCodes.producerId });
        if (!consumed) return null;

        const [producer] = await tx
          .select({ clerkUserId: producers.clerkUserId })
          .from(producers)
          .where(eq(producers.id, consumed.producerId))
          .limit(1);
        return producer ?? null;
      });
    },
  };
}

export function createConfiguredDesktopSocialAuthStore(): DesktopSocialAuthStore {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("Desktop authentication is unavailable");
  return createDesktopSocialAuthStore(createDb(dbUrl));
}

export async function issueDesktopAuthorizationCode(
  input: Readonly<{
    codeChallenge: string;
    producerId: string;
    randomCode?: () => string;
    state: string;
    store: DesktopSocialAuthStore;
  }>,
): Promise<string> {
  if (!isDesktopPkceChallenge(input.codeChallenge)) {
    throw new Error("Invalid desktop PKCE challenge");
  }
  if (!isDesktopAuthState(input.state)) throw new Error("Invalid desktop authorization state");
  const code = input.randomCode?.() ?? randomBytes(32).toString("base64url");
  if (!isDesktopAuthCode(code)) throw new Error("Invalid desktop authorization code");
  await input.store.issue({
    codeDigest: desktopAuthCodeDigest(code),
    pkceChallenge: input.codeChallenge,
    producerId: input.producerId,
    stateDigest: desktopAuthStateDigest(input.state),
  });
  return code;
}

export async function consumeDesktopAuthorizationCode(
  input: Readonly<{
    code: string;
    codeVerifier: string;
    store: DesktopSocialAuthStore;
  }>,
): Promise<Readonly<{ clerkUserId: string }> | null> {
  if (!isDesktopAuthCode(input.code) || !isDesktopPkceVerifier(input.codeVerifier)) {
    return null;
  }
  return input.store.consume({
    codeDigest: desktopAuthCodeDigest(input.code),
    pkceChallenge: desktopPkceChallenge(input.codeVerifier),
  });
}
