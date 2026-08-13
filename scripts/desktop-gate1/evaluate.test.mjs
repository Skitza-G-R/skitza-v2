import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGate1 } from "./evaluate.mjs";

function timedRun(durationMs, overrides = {}) {
  return {
    bridgeProtocolVersion: null,
    buildId: "test-build",
    durationMs,
    journey: "reopen-today",
    meaningful: true,
    blankOrFullscreenSpinner: false,
    mediaDownloadRequests: 0,
    origin: "https://proof.example.test",
    phase: "timed",
    platform: "macos",
    run: 1,
    runtime: "chrome",
    source: "server",
    ...overrides,
  };
}

function journey(id, desktopMs, webMs, platformId = "macos-apple-silicon") {
  const desktopSource =
    id === "safe-clients-projects"
      ? "safe-view"
      : id === "cached-recent-audio"
        ? "recent-cache"
        : "resume";
  const webSource = id === "cached-recent-audio" ? "recent-cache" : "server";
  const platform = platformId === "macos-apple-silicon" ? "macos" : "windows";
  const sample = (durationMs, runtime, phase, run, source) =>
    timedRun(durationMs, {
      bridgeProtocolVersion: runtime === "desktop" ? 1 : null,
      journey: id,
      phase,
      platform,
      run,
      runtime,
      source,
    });
  return {
    id,
    warmup: {
      desktop: sample(desktopMs[0], "desktop", "warmup", 0, desktopSource),
      web: sample(webMs[0], "chrome", "warmup", 0, webSource),
    },
    desktopRuns: desktopMs.map((value, index) =>
      sample(value, "desktop", "timed", index + 1, desktopSource),
    ),
    webRuns: webMs.map((value, index) => sample(value, "chrome", "timed", index + 1, webSource)),
  };
}

function platform(platformId) {
  return {
    platform: platformId,
    machine: platformId === "macos-apple-silicon" ? "Apple Silicon Mac" : "Windows x64 PC",
    os: platformId === "macos-apple-silicon" ? "macOS" : "Windows 11",
    architecture: platformId === "macos-apple-silicon" ? "arm64" : "x64",
    chromeVersion: "151.0.7922.137",
    desktopVersion: "0.1.0-gate1",
    webBuild: "test-build",
    webOrigin: "https://proof.example.test",
    accountFixture: "non-sensitive-producer-fixture",
    network: "same machine and network",
    clerk: {
      emailPassword: true,
      social: true,
      socialProvider: "configured-provider",
      correctProducer: true,
      secureHandoff: true,
    },
    visualContinuity: {
      liveMatchesWeb: true,
      previewUsesSameShell: true,
    },
    journeys: [
      journey(
        "reopen-today",
        [620, 650, 680, 700, 730],
        [1_200, 1_250, 1_300, 1_350, 1_400],
        platformId,
      ),
      journey(
        "safe-clients-projects",
        [210, 230, 250, 270, 290],
        [700, 720, 740, 760, 780],
        platformId,
      ),
      journey(
        "cached-recent-audio",
        [180, 200, 220, 240, 260],
        [500, 520, 540, 560, 580],
        platformId,
      ),
    ],
  };
}

function passingRecord() {
  return {
    schemaVersion: 1,
    platforms: [platform("macos-apple-silicon"), platform("windows-11-x64")],
  };
}

test("passes only when both exact platforms meet every Gate 1 row", () => {
  const result = evaluateGate1(passingRecord());

  assert.equal(result.passed, true);
  assert.deepEqual(
    result.platforms.map((entry) => [entry.platform, entry.passed]),
    [
      ["macos-apple-silicon", true],
      ["windows-11-x64", true],
    ],
  );
});

test("fails an absolute row unless at least four qualifying desktop runs pass", () => {
  const record = passingRecord();
  [480, 510, 520, 530, 490].forEach((value, index) => {
    record.platforms[0].journeys[1].desktopRuns[index].durationMs = value;
  });

  const result = evaluateGate1(record);
  const safeScreen = result.platforms[0].journeys.find(
    (entry) => entry.id === "safe-clients-projects",
  );

  assert.equal(result.passed, false);
  assert.equal(safeScreen.absolutePassed, false);
  assert.equal(safeScreen.qualifyingDesktopRuns, 2);
});

test("does not count cached-audio runs that download media again", () => {
  const record = passingRecord();
  const audio = record.platforms[1].journeys[2];
  audio.desktopRuns[0].mediaDownloadRequests = 1;
  audio.desktopRuns[1].mediaDownloadRequests = 1;

  const result = evaluateGate1(record);
  const windowsAudio = result.platforms[1].journeys.find(
    (entry) => entry.id === "cached-recent-audio",
  );

  assert.equal(result.passed, false);
  assert.equal(windowsAudio.qualifyingDesktopRuns, 3);
  assert.equal(windowsAudio.absolutePassed, false);
});

test("allows one non-qualifying cached-audio run under the exact four-of-five rule", () => {
  const record = passingRecord();
  record.platforms[0].journeys[2].desktopRuns[4].mediaDownloadRequests = 1;

  const result = evaluateGate1(record);
  const macAudio = result.platforms[0].journeys.find((entry) => entry.id === "cached-recent-audio");

  assert.equal(macAudio.qualifyingDesktopRuns, 4);
  assert.equal(macAudio.absolutePassed, true);
  assert.equal(result.passed, true);
});

test("does not count buffered network audio as a qualifying cached-audio run", () => {
  const record = passingRecord();
  record.platforms[0].journeys[2].desktopRuns[4].source = "network";

  const result = evaluateGate1(record);
  const macAudio = result.platforms[0].journeys.find((entry) => entry.id === "cached-recent-audio");

  assert.equal(macAudio.qualifyingDesktopRuns, 4);
  assert.equal(macAudio.absolutePassed, true);
  assert.equal(result.passed, true);
});

test("counts only desktop clients runs that render the saved safe view", () => {
  const record = passingRecord();
  record.platforms[1].journeys[1].desktopRuns[0].source = "server";

  const result = evaluateGate1(record);
  const windowsClients = result.platforms[1].journeys.find(
    (entry) => entry.id === "safe-clients-projects",
  );

  assert.equal(windowsClients.qualifyingDesktopRuns, 4);
  assert.equal(windowsClients.absolutePassed, true);
  assert.equal(result.passed, true);
});

test("rejects a Chrome comparison that did not reach equivalent cached evidence", () => {
  const record = passingRecord();
  record.platforms[0].journeys[2].webRuns[0].source = "network";

  const result = evaluateGate1(record);
  const macAudio = result.platforms[0].journeys.find((entry) => entry.id === "cached-recent-audio");

  assert.equal(macAudio.comparisonEvidencePassed, false);
  assert.equal(result.passed, false);
});

test("rejects reordered or substituted raw run metadata", () => {
  const record = passingRecord();
  record.platforms[1].journeys[0].desktopRuns[0].run = 2;

  assert.throws(() => evaluateGate1(record), /desktopRuns\[0\]\.run must be 1/);
});

test("fails a journey that regresses by both more than ten percent and more than 100 ms", () => {
  const record = passingRecord();
  record.platforms[0].journeys[0] = journey(
    "reopen-today",
    [1_250, 1_280, 1_300, 1_320, 1_350],
    [950, 980, 1_000, 1_020, 1_050],
    "macos-apple-silicon",
  );

  const result = evaluateGate1(record);
  const reopen = result.platforms[0].journeys.find((entry) => entry.id === "reopen-today");

  assert.equal(result.passed, false);
  assert.equal(reopen.regressed, true);
});

test("rejects missing or substituted target platforms", () => {
  const record = passingRecord();
  record.platforms = [record.platforms[0]];

  assert.throws(() => evaluateGate1(record), /exactly one result for windows-11-x64/);
});

test("requires the same release-candidate web build and origin on both platforms", () => {
  const record = passingRecord();
  record.platforms[1].webBuild = "different-build";

  assert.throws(() => evaluateGate1(record), /same release-candidate web build and origin/);
});

test("rejects placeholder build provenance and the wrong target architecture", () => {
  const placeholder = passingRecord();
  placeholder.platforms[0].webBuild = "unconfigured";
  placeholder.platforms[1].webBuild = "unconfigured";
  assert.throws(() => evaluateGate1(placeholder), /webBuild is required/);

  const wrongArchitecture = passingRecord();
  wrongArchitecture.platforms[1].architecture = "arm64";
  assert.throws(() => evaluateGate1(wrongArchitecture), /architecture must be x64/);
});

test("requires one exact HTTPS proof origin", () => {
  const record = passingRecord();
  record.platforms[0].webOrigin = "https://proof.example.test/path";
  record.platforms[1].webOrigin = "https://proof.example.test/path";

  assert.throws(() => evaluateGate1(record), /webOrigin must be an exact HTTPS origin/);
});
