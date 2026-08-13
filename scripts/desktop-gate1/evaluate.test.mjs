import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGate1 } from "./evaluate.mjs";

function timedRun(durationMs, overrides = {}) {
  return {
    durationMs,
    meaningful: true,
    blankOrFullscreenSpinner: false,
    mediaDownloadRequests: 0,
    ...overrides,
  };
}

function journey(id, desktopMs, webMs) {
  return {
    id,
    warmup: {
      desktop: timedRun(desktopMs[0]),
      web: timedRun(webMs[0]),
    },
    desktopRuns: desktopMs.map((value) => timedRun(value)),
    webRuns: webMs.map((value) => timedRun(value)),
  };
}

function platform(platformId) {
  return {
    platform: platformId,
    machine: platformId === "macos-apple-silicon" ? "Apple Silicon Mac" : "Windows x64 PC",
    os: platformId === "macos-apple-silicon" ? "macOS" : "Windows 11",
    architecture: platformId === "macos-apple-silicon" ? "arm64" : "x64",
    chromeVersion: "test",
    desktopVersion: "test",
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
      journey("reopen-today", [620, 650, 680, 700, 730], [1_200, 1_250, 1_300, 1_350, 1_400]),
      journey("safe-clients-projects", [210, 230, 250, 270, 290], [700, 720, 740, 760, 780]),
      journey("cached-recent-audio", [180, 200, 220, 240, 260], [500, 520, 540, 560, 580]),
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
  record.platforms[0].journeys[1].desktopRuns = [480, 510, 520, 530, 490].map((value) =>
    timedRun(value),
  );

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
  assert.equal(windowsAudio.evidencePassed, false);
});

test("fails cached audio if any timed run downloads media again", () => {
  const record = passingRecord();
  record.platforms[0].journeys[2].desktopRuns[4].mediaDownloadRequests = 1;

  const result = evaluateGate1(record);
  const macAudio = result.platforms[0].journeys.find((entry) => entry.id === "cached-recent-audio");

  assert.equal(macAudio.qualifyingDesktopRuns, 4);
  assert.equal(macAudio.absolutePassed, false);
  assert.equal(result.passed, false);
});

test("fails a journey that regresses by both more than ten percent and more than 100 ms", () => {
  const record = passingRecord();
  record.platforms[0].journeys[0] = journey(
    "reopen-today",
    [1_250, 1_280, 1_300, 1_320, 1_350],
    [950, 980, 1_000, 1_020, 1_050],
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
