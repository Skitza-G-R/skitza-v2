import { createHmac, timingSafeEqual } from "node:crypto";

export const JOIN_INTENT_COOKIE = "skitza-join-intent";
export const JOIN_INTENT_MAX_AGE_SECONDS = 10 * 60;
export type JoinIntentAction = "book" | "unlock" | "home";

const JOIN_SLUG_PATTERN = /^[a-z0-9-]{3,48}$/;

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueJoinIntentToken(input: {
  slug: string;
  action: JoinIntentAction;
  secret: string;
  nowMs?: number;
}): string | null {
  if (!JOIN_SLUG_PATTERN.test(input.slug) || !input.secret) return null;
  const expiresAt =
    Math.floor((input.nowMs ?? Date.now()) / 1000) +
    JOIN_INTENT_MAX_AGE_SECONDS;
  const payload = `${String(expiresAt)}.${input.slug}.${input.action}`;
  return `${payload}.${signature(payload, input.secret)}`;
}

export function verifiedJoinIntentAction(input: {
  token: string | null | undefined;
  expectedSlug: string;
  secret: string;
  nowMs?: number;
}): JoinIntentAction | null {
  if (
    !input.token ||
    !input.secret ||
    !JOIN_SLUG_PATTERN.test(input.expectedSlug)
  ) {
    return null;
  }
  const match =
    /^(\d+)\.([a-z0-9-]+)\.(book|unlock|home)\.([A-Za-z0-9_-]{43})$/.exec(
      input.token,
    );
  if (!match) return null;
  const expiresAt = Number(match[1]);
  const slug = match[2];
  const action = match[3] as JoinIntentAction | undefined;
  const suppliedSignature = match[4];
  if (!slug || !action || !suppliedSignature) return null;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < nowSeconds ||
    expiresAt > nowSeconds + JOIN_INTENT_MAX_AGE_SECONDS ||
    slug !== input.expectedSlug
  ) {
    return null;
  }
  const payload = `${String(expiresAt)}.${slug}.${action}`;
  const expectedSignature = signature(payload, input.secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
    ? action
    : null;
}

export function verifyJoinIntentToken(input: {
  token: string | null | undefined;
  expectedSlug: string;
  expectedAction: JoinIntentAction;
  secret: string;
  nowMs?: number;
}): boolean {
  return verifiedJoinIntentAction(input) === input.expectedAction;
}

export function joinIntentCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    maxAge: JOIN_INTENT_MAX_AGE_SECONDS,
    path: "/join",
    sameSite: "lax" as const,
    secure: isProduction,
  };
}

export function clearedJoinIntentCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    expires: new Date(0),
    maxAge: 0,
    path: "/join",
    sameSite: "lax" as const,
    secure: isProduction,
  };
}

export function clearJoinIntentCookie(
  cookieStore: {
    set: (
      name: string,
      value: string,
      options: ReturnType<typeof clearedJoinIntentCookieOptions>,
    ) => unknown;
  },
  isProduction: boolean,
): void {
  cookieStore.set(
    JOIN_INTENT_COOKIE,
    "",
    clearedJoinIntentCookieOptions(isProduction),
  );
}

export function joinIntentSecret(): string {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("missing Clerk secret for join intent");
  return secret;
}
