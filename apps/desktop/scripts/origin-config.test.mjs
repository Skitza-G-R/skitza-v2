import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DESKTOP_ORIGIN,
  exactHttpsOrigin,
  proofConfig,
} from "./origin-config.mjs";

test("defaults to the exact production origin", () => {
  assert.equal(exactHttpsOrigin(), DEFAULT_DESKTOP_ORIGIN);
  assert.deepEqual(proofConfig(DEFAULT_DESKTOP_ORIGIN).app.security.capabilities[1].remote.urls, [
    "https://skitza.app/*",
  ]);
});

test("canonicalizes one exact HTTPS proof origin", () => {
  assert.equal(exactHttpsOrigin(" https://proof.example:8443/ "), "https://proof.example:8443");
});

test("rejects broad or non-origin inputs", () => {
  for (const value of [
    "http://proof.example",
    "https://*.example",
    "https://proof.example/path",
    "https://proof.example?token=no",
    "https://proof.example/#fragment",
    "https://user:pass@proof.example",
    "not-a-url",
  ]) {
    assert.throws(() => exactHttpsOrigin(value));
  }
});

test("generated remote capability never uses a wildcard host", () => {
  const [pattern] = proofConfig("https://proof.example").app.security.capabilities[1].remote.urls;
  const parsed = new URL(pattern.replace(/\/\*$/, "/"));
  assert.equal(parsed.hostname, "proof.example");
  assert.equal(parsed.hostname.includes("*"), false);
});

test("generated build config never embeds the runtime access token", () => {
  const sentinel = "do-not-embed-this-runtime-value";
  const previous = process.env.SKITZA_DESKTOP_ACCESS_TOKEN;
  process.env.SKITZA_DESKTOP_ACCESS_TOKEN = sentinel;
  try {
    const serialized = JSON.stringify(proofConfig(DEFAULT_DESKTOP_ORIGIN));
    assert.equal(serialized.includes("SKITZA_DESKTOP_ACCESS_TOKEN"), false);
    assert.equal(serialized.includes("skitza-access"), false);
    assert.equal(serialized.includes(sentinel), false);
  } finally {
    if (previous === undefined) {
      delete process.env.SKITZA_DESKTOP_ACCESS_TOKEN;
    } else {
      process.env.SKITZA_DESKTOP_ACCESS_TOKEN = previous;
    }
  }
});

test("local and exact-remote command grants cannot overlap", () => {
  const [local, remote] = proofConfig("https://proof.example").app.security.capabilities;
  assert.equal(local.remote, undefined);
  assert.deepEqual(local.permissions, ["allow-retry-launch"]);
  assert.equal(remote.local, false);
  assert.equal(remote.permissions.includes("allow-retry-launch"), false);
  assert.equal(local.permissions.some((permission) => remote.permissions.includes(permission)), false);
});
