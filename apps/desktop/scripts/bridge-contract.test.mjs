import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("../assets/bridge.js", import.meta.url), "utf8");
const sessionCoverSource = await readFile(
  new URL("../assets/session-cover.js", import.meta.url),
  "utf8",
);
const mainSource = await readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
const startupHtml = await readFile(new URL("../assets/index.html", import.meta.url), "utf8");
const startupCss = await readFile(new URL("../assets/startup-v2.css", import.meta.url), "utf8");
const startupSource = await readFile(new URL("../assets/startup-v2.js", import.meta.url), "utf8");

function loadBridge(origin, sessionCover) {
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
  if (sessionCover) window.__SKITZA_DESKTOP_SESSION_COVER__ = sessionCover;
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

test("session validation controls the desktop cover without weakening the bridge", async () => {
  const coverCalls = [];
  const sessionCover = {
    reportSessionValidation(report) {
      coverCalls.push({ report: { ...report }, type: "report" });
    },
    show() {
      coverCalls.push({ type: "show" });
    },
  };
  const { calls, window } = loadBridge("https://proof.example", sessionCover);
  const received = [];
  window.__SKITZA_DESKTOP__.listen((event) => {
    received.push(event.type);
    coverCalls.push({ type: "listener" });
  });

  window.__SKITZA_DESKTOP_DELIVER__({ type: "runtime-suspended" });
  assert.deepEqual(coverCalls.map((call) => call.type), ["show", "listener"]);

  const report = {
    accountMatches: true,
    status: "valid",
    validatedAt: 1,
  };
  await window.__SKITZA_DESKTOP__.reportSessionValidation(report);
  assert.equal(calls.at(-1).command, "report_session_validation");
  assert.deepEqual({ ...calls.at(-1).args.report }, report);
  assert.deepEqual(coverCalls.at(-1), { report, type: "report" });
  assert.deepEqual(received, ["runtime-suspended"]);
});

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.id = "";
    this.innerHTML = "";
    this.textContent = "";
    this.attributes = new Map();
  }

  append(...children) {
    for (const child of children) this.ownerDocument.elements.set(child.id, child);
  }

  remove() {
    this.ownerDocument.elements.delete(this.id);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

function sessionCoverHarness(
  pathname,
  origin = "https://proof.example",
  sessionValues = new Map(),
) {
  const elements = new Map();
  const forbidden = new Set();
  const frames = [];
  const nativeCalls = [];
  const observers = [];
  const document = {
    elements,
    documentElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelector(selector) {
      return forbidden.has(selector) ? {} : null;
    },
    addEventListener() {},
  };
  document.documentElement = new FakeElement("html", document);
  const window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        nativeCalls.push(command);
        return Promise.resolve();
      },
    },
    __SKITZA_DESKTOP_TRUSTED_ORIGIN__: "https://proof.example",
    location: { origin, pathname },
    sessionStorage: {
      getItem(key) {
        return sessionValues.get(key) ?? null;
      },
      removeItem(key) {
        sessionValues.delete(key);
      },
      setItem(key, value) {
        sessionValues.set(key, String(value));
      },
    },
    addEventListener() {},
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  };
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    disconnect() {}
    observe() {}
  }
  vm.runInNewContext(sessionCoverSource, {
    MutationObserver: FakeMutationObserver,
    Number,
    URL,
    document,
    window,
  });
  const runFrames = () => {
    while (frames.length > 0) frames.shift()();
  };
  return {
    document,
    forbidden,
    nativeCalls,
    observers,
    runFrames,
    sessionValues,
    window,
  };
}

test("protected pages keep the animated cover until a clean validated screen paints", () => {
  const harness = sessionCoverHarness("/dashboard");
  assert.ok(harness.document.getElementById("skitza-desktop-session-cover"));
  assert.match(
    harness.document.getElementById("skitza-desktop-session-cover").innerHTML,
    /skitza-192\.png/,
  );

  harness.forbidden.add('[aria-label="Checking connection"]');
  harness.forbidden.add('[data-runtime-screen-source="cache"]');
  harness.window.__SKITZA_DESKTOP_SESSION_COVER__.reportSessionValidation({
    accountMatches: true,
    status: "valid",
    validatedAt: 1,
  });
  harness.runFrames();
  assert.ok(harness.document.getElementById("skitza-desktop-session-cover"));

  harness.forbidden.delete('[aria-label="Checking connection"]');
  harness.observers.at(-1).callback();
  harness.runFrames();
  assert.ok(harness.document.getElementById("skitza-desktop-session-cover"));

  harness.forbidden.clear();
  harness.observers.at(-1).callback();
  harness.runFrames();
  assert.equal(harness.document.getElementById("skitza-desktop-session-cover"), null);

  harness.forbidden.add('[data-runtime-screen-source="resume"]');
  harness.observers.at(-1).callback();
  assert.equal(harness.document.getElementById("skitza-desktop-session-cover"), null);

  harness.window.__SKITZA_DESKTOP_SESSION_COVER__.show();
  assert.ok(harness.document.getElementById("skitza-desktop-session-cover"));
});

test("unknown validation and atomic hide keep the cover while sign-in stays untouched", async () => {
  const protectedPage = sessionCoverHarness("/dashboard/music");
  protectedPage.window.__SKITZA_DESKTOP_SESSION_COVER__.reportSessionValidation({
    accountMatches: false,
    status: "unknown",
    validatedAt: null,
  });
  assert.ok(protectedPage.document.getElementById("skitza-desktop-session-cover"));
  await protectedPage.window.__SKITZA_DESKTOP_PREPARE_HIDE__();
  assert.deepEqual(protectedPage.nativeCalls, ["hide_main_window"]);
  assert.ok(protectedPage.document.getElementById("skitza-desktop-session-cover"));

  const signIn = sessionCoverHarness("/sign-in");
  assert.equal(signIn.document.getElementById("skitza-desktop-session-cover"), null);
  await signIn.window.__SKITZA_DESKTOP_PREPARE_HIDE__();
  assert.equal(signIn.document.getElementById("skitza-desktop-session-cover"), null);
  assert.deepEqual(signIn.nativeCalls, ["hide_main_window"]);
});

test("validated full-document navigation never remounts the opening cover", () => {
  const sessionValues = new Map();
  const initialPage = sessionCoverHarness(
    "/dashboard",
    "https://proof.example",
    sessionValues,
  );
  initialPage.window.__SKITZA_DESKTOP_SESSION_COVER__.reportSessionValidation({
    accountMatches: true,
    status: "valid",
    validatedAt: 1,
  });
  initialPage.runFrames();
  assert.equal(initialPage.document.getElementById("skitza-desktop-session-cover"), null);

  const nextPage = sessionCoverHarness(
    "/dashboard/music",
    "https://proof.example",
    sessionValues,
  );
  nextPage.forbidden.add('[data-runtime-screen-source="scaffold"]');
  nextPage.observers.at(-1).callback();
  assert.equal(nextPage.document.getElementById("skitza-desktop-session-cover"), null);

  nextPage.window.__SKITZA_DESKTOP_SESSION_COVER__.reportSessionValidation({
    accountMatches: false,
    status: "unknown",
    validatedAt: null,
  });
  assert.ok(nextPage.document.getElementById("skitza-desktop-session-cover"));
});

test("close and macOS Quit finish through native lifecycle paths", () => {
  assert.match(
    mainSource,
    /CloseRequested[\s\S]*?api\.prevent_close\(\)[\s\S]*?show\?\.\(\)[\s\S]*?webview\.hide\(\)/,
  );
  assert.doesNotMatch(
    mainSource,
    /CloseRequested[\s\S]*?__SKITZA_DESKTOP_PREPARE_HIDE__/,
  );
  assert.match(
    mainSource,
    /fn quit_app[\s\S]*?window\.hide\(\)[\s\S]*?app\.exit\(0\)/,
  );
  assert.match(
    mainSource,
    /APP_QUIT_MENU_ID[\s\S]*?CmdOrCtrl\+Q[\s\S]*?on_menu_event[\s\S]*?quit_app\(app\)/,
  );
  assert.match(mainSource, /"quit-skitza" => quit_app\(app\)/);
});

test("macOS activation and a second launch restore the hidden window", () => {
  assert.match(
    mainSource,
    /tauri_plugin_single_instance::init\(\|app, args, _cwd\|[\s\S]*?reveal_main_window\(app\)[\s\S]*?for argument in args/,
  );
  assert.match(
    mainSource,
    /\.build\(tauri::generate_context!\(\)\)[\s\S]*?app\.run\(\|app, event\|[\s\S]*?RunEvent::Reopen[\s\S]*?!has_visible_windows[\s\S]*?reveal_main_window\(app\)/,
  );
});

test("the Mac menu-bar icon has a stable visible tray registration", () => {
  assert.match(mainSource, /const TRAY_ICON_ID: &str = "skitza-tray"/);
  assert.match(mainSource, /include_image!\("icons\/32x32\.png"\)/);
  assert.match(
    mainSource,
    /TrayIconBuilder::with_id\(TRAY_ICON_ID\)[\s\S]*?icon\(icon\)[\s\S]*?icon_as_template\(false\)/,
  );
  assert.match(
    mainSource,
    /let tray = builder\.build\(app\)\?[\s\S]*?tray\.set_visible\(true\)\?/,
  );
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
