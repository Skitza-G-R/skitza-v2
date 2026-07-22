import { describe, expect, it } from "vitest";

import { assertSk102EdgeRuntime } from "./sk102-edge-runtime";

function safeEdgeEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    SK102_E2E_MODE: "isolated_nonproduction",
    SK102_DISPOSABLE_CONFIRMATION: "isolated-disposable",
    SK102_SLOT: "sk102-browser",
    SK102_PAYMENT_MODE: "off_app_test",
    NEXT_TELEMETRY_DISABLED: "1",
    SK102_BROWSER_ORIGIN: "http://127.0.0.1:3102",
    SITE_URL: "http://127.0.0.1:3102",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${"a".repeat(32)}`,
    ...overrides,
  };
}

describe("assertSk102EdgeRuntime", () => {
  it("allows a normal runtime with no SK-102 variables and the valid isolated subset", () => {
    expect(() => {
      assertSk102EdgeRuntime({});
    }).not.toThrow();
    expect(() => {
      assertSk102EdgeRuntime(safeEdgeEnvironment());
    }).not.toThrow();
  });

  it("rejects production, a live Clerk key, and any external provider or telemetry", () => {
    expect(() => {
      assertSk102EdgeRuntime(safeEdgeEnvironment({ VERCEL_ENV: "production" }));
    }).toThrow("SK102_PRODUCTION_DEPLOYMENT_FORBIDDEN");
    expect(() => {
      assertSk102EdgeRuntime(
        safeEdgeEnvironment({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${"a".repeat(32)}` }),
      );
    }).toThrow("SK102_CLERK_CONFIG_INVALID");
    expect(() => {
      assertSk102EdgeRuntime(safeEdgeEnvironment({ STRIPE_SECRET_KEY: "present" }));
    }).toThrow("SK102_EXTERNAL_SERVICE_ENV_FORBIDDEN");
    expect(() => {
      assertSk102EdgeRuntime(safeEdgeEnvironment({ SENTRY_AUTH_TOKEN: "present" }));
    }).toThrow("SK102_EXTERNAL_SERVICE_ENV_FORBIDDEN");
    expect(() => {
      assertSk102EdgeRuntime(safeEdgeEnvironment({ ACCESS_TOKEN: "present" }));
    }).toThrow("SK102_EXTERNAL_SERVICE_ENV_FORBIDDEN");
    expect(() => {
      assertSk102EdgeRuntime(safeEdgeEnvironment({ NEXT_TELEMETRY_DISABLED: "0" }));
    }).toThrow("SK102_TELEMETRY_INVALID");
    for (const name of [
      "CLERK_API_URL",
      "CLERK_TESTING_TOKEN",
      "CLERK_FAPI",
      "CLERK_TESTING_DEBUG",
      "NEXT_PUBLIC_CLERK_PROXY_URL",
      "NEXT_PUBLIC_CLERK_JS_URL",
      "NEXT_PUBLIC_CLERK_DOMAIN",
    ]) {
      expect(() => {
        assertSk102EdgeRuntime(safeEdgeEnvironment({ [name]: "present" }));
      }, name).toThrow("SK102_CLERK_AMBIENT_ENV_FORBIDDEN");
    }
  });

  it("rejects ambient TLS, CA, Node-loader, and proxy routing overrides", () => {
    for (const name of [
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "NODE_EXTRA_CA_CERTS",
      "NODE_USE_ENV_PROXY",
      "NODE_OPTIONS",
      "SSL_CERT_FILE",
      "OPENSSL_CONF",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "npm_config_https_proxy",
    ]) {
      expect(() => {
        assertSk102EdgeRuntime(safeEdgeEnvironment({ [name]: "present" }));
      }, name).toThrow("SK102_NETWORK_ENV_FORBIDDEN");
    }
  });
});
