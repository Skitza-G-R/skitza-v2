import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  generateSecret,
  type CryptoKey,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_CANONICAL_HOST_ENV,
  CLOUDFLARE_ACCESS_AUDIENCE_ENV,
  CLOUDFLARE_ACCESS_FOUNDER_SUBJECT_ENV,
  CLOUDFLARE_ACCESS_JWT_HEADER,
  CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV,
  CloudflareAccessVerificationError,
  resolveCloudflareAccessConfiguration,
  verifyCloudflareAccessHeaders,
  verifyCloudflareAccessJwt,
  type CloudflareAccessEnvironment,
} from "./cloudflare-access";

const ACCESS_AUDIENCE = "admin-access-audience";
const ACCESS_CANONICAL_HOST = "admin.skitza.app";
const ACCESS_EMAIL = "founder@example.test";
const ACCESS_ISSUER = "https://skitza.cloudflareaccess.com";
const ACCESS_SUBJECT = "founder-access-subject";
const KEY_ID = "test-access-key";
const PREVIOUS_KEY_ID = "previous-access-key";
const NOW_SECONDS = 1_800_000_000;
const NOW = new Date(NOW_SECONDS * 1_000);

let privateKey: CryptoKey;
let previousPrivateKey: CryptoKey;
let keyResolver: JWTVerifyGetKey;

function environment(
  overrides: CloudflareAccessEnvironment = {},
): CloudflareAccessEnvironment {
  return {
    [ADMIN_CANONICAL_HOST_ENV]: ACCESS_CANONICAL_HOST,
    [CLOUDFLARE_ACCESS_AUDIENCE_ENV]: ACCESS_AUDIENCE,
    [CLOUDFLARE_ACCESS_FOUNDER_SUBJECT_ENV]: ACCESS_SUBJECT,
    [CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV]:
      "skitza.cloudflareaccess.com",
    ...overrides,
  };
}

function accessClaims(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    aud: [ACCESS_AUDIENCE],
    email: ACCESS_EMAIL,
    exp: NOW_SECONDS + 300,
    iat: NOW_SECONDS - 60,
    iss: ACCESS_ISSUER,
    nbf: NOW_SECONDS - 60,
    sub: ACCESS_SUBJECT,
    type: "app",
    ...overrides,
  };
}

async function signAccessToken(
  overrides: Readonly<Record<string, unknown>> = {},
  key: CryptoKey = privateKey,
  keyId = KEY_ID,
): Promise<string> {
  return new SignJWT(accessClaims(overrides))
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .sign(key);
}

function verificationOptions() {
  return {
    currentDate: NOW,
    environment: environment(),
    keyResolver,
  } as const;
}

beforeAll(async () => {
  const generated = await generateKeyPair("RS256");
  privateKey = generated.privateKey;
  const previous = await generateKeyPair("RS256");
  previousPrivateKey = previous.privateKey;

  const publicJwk = await exportJWK(generated.publicKey);
  const previousPublicJwk = await exportJWK(previous.publicKey);
  keyResolver = createLocalJWKSet({
    keys: [
      {
        ...publicJwk,
        alg: "RS256",
        kid: KEY_ID,
        use: "sig",
      },
      {
        ...previousPublicJwk,
        alg: "RS256",
        kid: PREVIOUS_KEY_ID,
        use: "sig",
      },
    ],
  });
});

describe("Cloudflare Access configuration", () => {
  it("normalizes the exact HTTPS team issuer and JWKS URL", () => {
    expect(
      resolveCloudflareAccessConfiguration(
        environment({
          [CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV]:
            " HTTPS://SKITZA.CLOUDFLAREACCESS.COM/ ",
        }),
      ),
    ).toEqual({
      audience: ACCESS_AUDIENCE,
      canonicalHost: ACCESS_CANONICAL_HOST,
      founderSubject: ACCESS_SUBJECT,
      issuer: ACCESS_ISSUER,
      jwksUrl: new URL(
        "https://skitza.cloudflareaccess.com/cdn-cgi/access/certs",
      ),
    });
  });

  it("fails closed when required configuration is missing", () => {
    expect(() => resolveCloudflareAccessConfiguration({})).toThrow(
      expect.objectContaining<Partial<CloudflareAccessVerificationError>>({
        reason: "configuration-invalid",
      }),
    );
  });

  it.each([
    { [ADMIN_CANONICAL_HOST_ENV]: " " },
    { [ADMIN_CANONICAL_HOST_ENV]: "admin-preview.vercel.app" },
    { [CLOUDFLARE_ACCESS_AUDIENCE_ENV]: " " },
    { [CLOUDFLARE_ACCESS_FOUNDER_SUBJECT_ENV]: " " },
    { [CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV]: " " },
    {
      [CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV]:
        "http://skitza.cloudflareaccess.com",
    },
    {
      [CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV]:
        "https://skitza.cloudflareaccess.com/other",
    },
    {
      [CLOUDFLARE_ACCESS_TEAM_DOMAIN_ENV]:
        "https://skitza.cloudflareaccess.com.example.test",
    },
  ])("fails closed for missing or unsafe configuration", (overrides) => {
    expect(() =>
      resolveCloudflareAccessConfiguration(environment(overrides)),
    ).toThrow(
      expect.objectContaining<Partial<CloudflareAccessVerificationError>>({
        reason: "configuration-invalid",
      }),
    );
  });
});

describe("Cloudflare Access JWT verification", () => {
  it("accepts a valid RS256 application token from the local JWKS", async () => {
    const token = await signAccessToken();

    const identity = await verifyCloudflareAccessHeaders(
      new Headers({
        host: ACCESS_CANONICAL_HOST,
        [CLOUDFLARE_ACCESS_JWT_HEADER]: token,
      }),
      verificationOptions(),
    );

    expect(identity).toMatchObject({
      audience: ACCESS_AUDIENCE,
      email: ACCESS_EMAIL,
      expiresAt: NOW_SECONDS + 300,
      issuedAt: NOW_SECONDS - 60,
      issuer: ACCESS_ISSUER,
      notBefore: NOW_SECONDS - 60,
      subject: ACCESS_SUBJECT,
    });
    expect(identity.tokenFingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("accepts both current and previous signing keys during rotation", async () => {
    const currentToken = await signAccessToken();
    const previousToken = await signAccessToken(
      {},
      previousPrivateKey,
      PREVIOUS_KEY_ID,
    );

    await expect(
      verifyCloudflareAccessJwt(currentToken, verificationOptions()),
    ).resolves.toMatchObject({ subject: ACCESS_SUBJECT });
    await expect(
      verifyCloudflareAccessJwt(previousToken, verificationOptions()),
    ).resolves.toMatchObject({ subject: ACCESS_SUBJECT });
  });

  it("rejects a missing assertion header before resolving a key", async () => {
    const unavailableKeyResolver: JWTVerifyGetKey = () =>
      Promise.reject(new Error("must not be called"));

    await expect(
      verifyCloudflareAccessHeaders(new Headers(), {
        ...verificationOptions(),
        keyResolver: unavailableKeyResolver,
      }),
    ).rejects.toMatchObject({
      reason: "token-required",
    });
  });

  it("rejects malformed, incorrectly signed, and unavailable-JWKS tokens", async () => {
    const otherPair = await generateKeyPair("RS256");
    const wrongSignature = await new SignJWT(accessClaims())
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .sign(otherPair.privateKey);
    const unavailableKeyResolver: JWTVerifyGetKey = () =>
      Promise.reject(new Error("test-only JWKS failure"));
    const validToken = await signAccessToken();

    for (const [token, resolver] of [
      ["not-a-jwt", keyResolver],
      [wrongSignature, keyResolver],
      [validToken, unavailableKeyResolver],
    ] as const) {
      await expect(
        verifyCloudflareAccessJwt(token, {
          ...verificationOptions(),
          keyResolver: resolver,
        }),
      ).rejects.toMatchObject({
        reason: "token-invalid",
      });
    }
  });

  it("rejects expired and not-yet-valid tokens", async () => {
    for (const token of [
      await signAccessToken({ exp: NOW_SECONDS }),
      await signAccessToken({ nbf: NOW_SECONDS + 1 }),
      await signAccessToken({ iat: NOW_SECONDS + 1 }),
    ]) {
      await expect(
        verifyCloudflareAccessJwt(token, verificationOptions()),
      ).rejects.toMatchObject({
        reason: "token-invalid",
      });
    }
  });

  it("requires the exact single application audience", async () => {
    for (const aud of [
      "another-application",
      ["another-application"],
      [ACCESS_AUDIENCE, "another-application"],
    ]) {
      await expect(
        verifyCloudflareAccessJwt(
          await signAccessToken({ aud }),
          verificationOptions(),
        ),
      ).rejects.toMatchObject({
        reason: "token-invalid",
      });
    }
  });

  it("requires the exact normalized issuer", async () => {
    await expect(
      verifyCloudflareAccessJwt(
        await signAccessToken({
          iss: "https://other.cloudflareaccess.com",
        }),
        verificationOptions(),
      ),
    ).rejects.toMatchObject({
      reason: "token-invalid",
    });
  });

  it("requires the exact configured founder subject", async () => {
    await expect(
      verifyCloudflareAccessJwt(
        await signAccessToken({ sub: "another-access-user" }),
        verificationOptions(),
      ),
    ).rejects.toMatchObject({
      reason: "token-invalid",
    });
  });

  it("rejects raw Vercel and malformed hosts even with a valid token", async () => {
    const token = await signAccessToken();

    for (const host of [
      "skitza-admin.vercel.app",
      "deployment-hash.vercel.app",
      "admin.skitza.app,skitza-admin.vercel.app",
      "admin.skitza.app/other",
    ]) {
      await expect(
        verifyCloudflareAccessHeaders(
          new Headers({
            host,
            [CLOUDFLARE_ACCESS_JWT_HEADER]: token,
          }),
          verificationOptions(),
        ),
      ).rejects.toMatchObject({
        reason: "token-invalid",
      });
    }
  });

  it.each([
    { type: "service-token" },
    { sub: " " },
    { email: " " },
  ])("requires an app token with a nonempty founder identity", async (claims) => {
    await expect(
      verifyCloudflareAccessJwt(
        await signAccessToken(claims),
        verificationOptions(),
      ),
    ).rejects.toMatchObject({
      reason: "token-invalid",
    });
  });

  it.each([
    "aud",
    "email",
    "exp",
    "iat",
    "iss",
    "nbf",
    "sub",
    "type",
  ] as const)(
    "requires the %s claim",
    async (claim) => {
      const claims = Object.fromEntries(
        Object.entries(accessClaims()).filter(
          ([claimName]) => claimName !== claim,
        ),
      );

      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
        .sign(privateKey);

      await expect(
        verifyCloudflareAccessJwt(token, verificationOptions()),
      ).rejects.toMatchObject({
        reason: "token-invalid",
      });
    },
  );

  it("accepts only RS256", async () => {
    const secret = await generateSecret("HS256");
    const token = await new SignJWT(accessClaims())
      .setProtectedHeader({ alg: "HS256" })
      .sign(secret);

    await expect(
      verifyCloudflareAccessJwt(token, verificationOptions()),
    ).rejects.toMatchObject({
      reason: "token-invalid",
    });
  });

  it("never includes a token or claim in verification errors", async () => {
    const token = await signAccessToken({
      email: "sensitive-founder@example.test",
    });

    const error = await verifyCloudflareAccessJwt(token, {
      ...verificationOptions(),
      environment: environment({
        [CLOUDFLARE_ACCESS_FOUNDER_SUBJECT_ENV]:
          "different-founder-subject",
      }),
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CloudflareAccessVerificationError);
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain(
      "sensitive-founder@example.test",
    );
  });
});
