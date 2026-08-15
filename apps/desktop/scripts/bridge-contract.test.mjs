import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("../assets/bridge.js", import.meta.url), "utf8");
const startupHtml = await readFile(new URL("../assets/index.html", import.meta.url), "utf8");
const startupCss = await readFile(new URL("../assets/startup-v2.css", import.meta.url), "utf8");
const startupSource = await readFile(new URL("../assets/startup-v2.js", import.meta.url), "utf8");

function loadBridge(origin) {
  const calls = [];
  const tauriInternals = {
    invoke(command, args) {
      assert.equal(this, tauriInternals);
      calls.push({ args, command });
      return Promise.resolve();
    },
  };
  const window = {
    __SKITZA_DESKTOP_TRUSTED_ORIGIN__: "https://proof.example",
    __TAURI_INTERNALS__: tauriInternals,
    location: { origin },
  };
  vm.runInNewContext(bridgeSource, { window });
  return { calls, window };
}

test("local startup receives retry only and no remote bridge", async () => {
  const { calls, window } = loadBridge("http://tauri.localhost");
  assert.equal(window.__SKITZA_DESKTOP__, undefined);
  assert.deepEqual(Object.keys(window.__SKITZA_DESKTOP_LOCAL__), ["retryLaunch"]);
  assert.equal(Object.isFrozen(window.__SKITZA_DESKTOP_LOCAL__), true);
  await window.__SKITZA_DESKTOP_LOCAL__.retryLaunch();
  assert.deepEqual(
    calls.map((call) => ({ args: { ...call.args }, command: call.command })),
    [{ args: {}, command: "retry_launch" }],
  );
});

test("the secure local-protocol variant receives the same local-only bridge", () => {
  const { window } = loadBridge("https://tauri.localhost");
  assert.equal(window.__SKITZA_DESKTOP__, undefined);
  assert.deepEqual(Object.keys(window.__SKITZA_DESKTOP_LOCAL__), ["retryLaunch"]);
});

test("only the exact remote origin receives the versioned shared bridge", async () => {
  assert.equal(loadBridge("https://other.example").window.__SKITZA_DESKTOP__, undefined);

  const { calls, window } = loadBridge("https://proof.example");
  const bridge = window.__SKITZA_DESKTOP__;
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.protocolVersion, 1);
  assert.deepEqual(Array.from(bridge.capabilities), [
    "social-auth-v1",
    "performance-proof-v1",
    "saved-screen-preview-v1",
    "session-validation-v1",
  ]);
  assert.deepEqual(
    Object.keys(bridge).sort(),
    [
      "capabilities",
      "consumeRevealElapsedMs",
      "exportGate1Samples",
      "listen",
      "protocolVersion",
      "recordGate1Sample",
      "reportSessionValidation",
      "startSocialSignIn",
    ].sort(),
  );

  await bridge.startSocialSignIn("google");
  assert.deepEqual({
    args: { ...calls.at(-1).args },
    command: calls.at(-1).command,
  }, {
    args: { provider: "google" },
    command: "begin_social_sign_in",
  });
});

test("buffered bridge events are validated, ordered, and delivered once", () => {
  const { window } = loadBridge("https://proof.example");
  const deliver = window.__SKITZA_DESKTOP_DELIVER__;
  deliver({ type: "session-validation-requested" });
  deliver({ type: "window-revealed" });
  deliver({ ticket: "one-use-ticket", type: "social-sign-in-ticket" });
  deliver({ code: "exchange-failed", type: "social-sign-in-error" });
  deliver({ code: "made-up-code", type: "social-sign-in-error" });
  deliver({ ticket: "x".repeat(4097), type: "social-sign-in-ticket" });
  deliver({ type: "not-a-shared-event" });

  const received = [];
  const unsubscribe = window.__SKITZA_DESKTOP__.listen((event) => received.push(event));
  assert.deepEqual(
    received.map((event) => ({ ...event })),
    [
      { type: "session-validation-requested" },
      { type: "window-revealed" },
      { ticket: "one-use-ticket", type: "social-sign-in-ticket" },
      { code: "exchange-failed", type: "social-sign-in-error" },
    ],
  );
  unsubscribe();
  deliver({ type: "runtime-suspended" });
  assert.equal(received.length, 4);

  const replayed = [];
  window.__SKITZA_DESKTOP__.listen((event) => replayed.push(event));
  assert.deepEqual(replayed.map((event) => ({ ...event })), [{ type: "runtime-suspended" }]);
});

test("the bounded FIFO never evicts a pending one-use ticket for status events", () => {
  const { window } = loadBridge("https://proof.example");
  const deliver = window.__SKITZA_DESKTOP_DELIVER__;
  deliver({ ticket: "one-use-ticket", type: "social-sign-in-ticket" });
  for (let index = 0; index < 24; index += 1) {
    deliver({ type: "session-validation-requested" });
  }

  const received = [];
  window.__SKITZA_DESKTOP__.listen((event) => received.push(event));
  assert.equal(received.length, 16);
  assert.equal(
    received.filter((event) => event.type === "social-sign-in-ticket").length,
    1,
  );
});

function startupHarness(retryLaunch, { useBridge = true } = {}) {
  const status = { textContent: "" };
  const retry = {
    hidden: false,
    listener: null,
    addEventListener(_type, listener) {
      this.listener = listener;
    },
  };
  const document = {
    querySelector(selector) {
      return selector === "#status" ? status : retry;
    },
  };
  const window = {
    location: {},
  };
  if (useBridge) {
    window.__SKITZA_DESKTOP_LOCAL__ = { retryLaunch };
  } else {
    window.__TAURI_INTERNALS__ = { invoke: retryLaunch };
  }
  vm.runInNewContext(startupSource, { document, window });
  return { retry, status, window };
}

test("startup asset invokes only local retry and exposes a recoverable error", async () => {
  let calls = 0;
  const success = startupHarness(async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
  await success.retry.listener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(success.retry.hidden, true);

  const failure = startupHarness(async () => {
    throw new Error("offline");
  });
  await failure.retry.listener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failure.retry.hidden, false);
  assert.match(failure.status.textContent, /could not connect/i);
  assert.equal(typeof failure.retry.listener, "function");

  const nativeFailure = startupHarness(async () => undefined);
  nativeFailure.window.__SKITZA_DESKTOP_STARTUP_FAILED__();
  assert.equal(nativeFailure.retry.hidden, false);
  assert.match(nativeFailure.status.textContent, /could not connect/i);

  const fallback = startupHarness(
    async (command) => {
      assert.equal(command, "retry_launch");
    },
    { useBridge: false },
  );
  await fallback.retry.listener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fallback.retry.hidden, true);
});

test("desktop startup mirrors the animated mobile Skitza launch cover", () => {
  assert.match(startupHtml, /href="\.\/startup-v2\.css"/);
  assert.match(startupHtml, /src="\.\/startup-v2\.js"/);
  assert.match(startupHtml, /class="sk-pwa-startup__pulse"/);
  assert.match(startupHtml, /src="\.\/skitza-192\.png"/);
  assert.match(startupHtml, /class="sk-pwa-startup__wordmark"/);
  assert.match(startupHtml, /Opening Skitza…/);
  assert.doesNotMatch(startupHtml, /Opening your studio/);

  assert.match(startupCss, /@keyframes skitza-pwa-startup-float/);
  assert.match(startupCss, /@keyframes skitza-pwa-startup-pulse/);
  assert.match(startupCss, /prefers-reduced-motion: no-preference/);
  assert.match(startupCss, /animation: skitza-pwa-startup-float/);
  assert.match(startupCss, /animation: skitza-pwa-startup-pulse/);
});
