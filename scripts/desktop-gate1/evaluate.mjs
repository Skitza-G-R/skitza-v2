import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM_IDS = ["macos-apple-silicon", "windows-11-x64"];
const PLACEHOLDER_METADATA = new Set(["test", "unknown", "unconfigured"]);
const PLATFORM_METADATA = {
  "macos-apple-silicon": {
    architecture: "arm64",
    osPattern: /^macOS(?:\s|$)/i,
  },
  "windows-11-x64": {
    architecture: "x64",
    osPattern: /^Windows 11(?:\s|$)/i,
  },
};
const JOURNEY_RULES = {
  "reopen-today": {
    absoluteLimitMs: 1_000,
    desktopSources: ["resume", "safe-view", "server"],
    webSources: ["server"],
    requireNoMediaDownload: false,
  },
  "safe-clients-projects": {
    absoluteLimitMs: 500,
    desktopSources: ["safe-view"],
    webSources: ["server"],
    requireNoMediaDownload: false,
  },
  "cached-recent-audio": {
    absoluteLimitMs: 500,
    desktopSources: ["recent-cache"],
    webSources: ["recent-cache"],
    requireNoMediaDownload: true,
  },
};

function invariant(condition, message) {
  if (!condition) throw new Error("Invalid Gate 1 record: " + message);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function samplePlatform(platformId) {
  return platformId === "macos-apple-silicon" ? "macos" : "windows";
}

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function isRealMetadata(value) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    !PLACEHOLDER_METADATA.has(value.toLowerCase())
  );
}

function validateRun(run, label, expected) {
  invariant(run && typeof run === "object", label + " must be an object");
  invariant(
    typeof run.durationMs === "number" && Number.isFinite(run.durationMs) && run.durationMs >= 0,
    label + ".durationMs must be a non-negative finite number",
  );
  invariant(typeof run.meaningful === "boolean", label + ".meaningful must be boolean");
  invariant(
    typeof run.blankOrFullscreenSpinner === "boolean",
    label + ".blankOrFullscreenSpinner must be boolean",
  );
  invariant(
    Number.isInteger(run.mediaDownloadRequests) && run.mediaDownloadRequests >= 0,
    label + ".mediaDownloadRequests must be a non-negative integer",
  );
  invariant(
    ["network", "recent-cache", "resume", "safe-view", "server", null].includes(run.source),
    label + ".source must be a known proof source or null",
  );
  for (const [field, value] of Object.entries(expected)) {
    invariant(run[field] === value, label + "." + field + " must be " + JSON.stringify(value));
  }
}

function validateFiveRuns(runs, label, expected) {
  invariant(Array.isArray(runs) && runs.length === 5, label + " must contain exactly five runs");
  runs.forEach((run, index) =>
    validateRun(run, label + "[" + index + "]", {
      ...expected,
      phase: "timed",
      run: index + 1,
    }),
  );
}

function evaluateJourney(journey, platform) {
  invariant(journey && typeof journey === "object", "journey must be an object");
  const rule = JOURNEY_RULES[journey.id];
  invariant(rule, "unknown journey " + String(journey.id));
  invariant(journey.warmup && typeof journey.warmup === "object", journey.id + " needs warmup");
  const common = {
    buildId: platform.webBuild,
    journey: journey.id,
    origin: platform.webOrigin,
    platform: samplePlatform(platform.platform),
  };
  const desktop = { ...common, bridgeProtocolVersion: 1, runtime: "desktop" };
  const web = { ...common, bridgeProtocolVersion: null, runtime: "chrome" };
  validateRun(journey.warmup.desktop, journey.id + ".warmup.desktop", {
    ...desktop,
    phase: "warmup",
    run: 0,
  });
  validateRun(journey.warmup.web, journey.id + ".warmup.web", {
    ...web,
    phase: "warmup",
    run: 0,
  });
  validateFiveRuns(journey.desktopRuns, journey.id + ".desktopRuns", desktop);
  validateFiveRuns(journey.webRuns, journey.id + ".webRuns", web);

  const qualifyingDesktopRuns = journey.desktopRuns.filter(
    (run) =>
      run.durationMs <= rule.absoluteLimitMs &&
      run.meaningful &&
      !run.blankOrFullscreenSpinner &&
      rule.desktopSources.includes(run.source) &&
      (!rule.requireNoMediaDownload || run.mediaDownloadRequests === 0),
  ).length;
  const desktopMedianMs = median(journey.desktopRuns.map((run) => run.durationMs));
  const webMedianMs = median(journey.webRuns.map((run) => run.durationMs));
  const savedMs = webMedianMs - desktopMedianMs;
  const improvementRatio = webMedianMs === 0 ? 0 : savedMs / webMedianMs;
  const comparisonEvidencePassed = journey.webRuns.every((run) => {
    return (
      run.meaningful &&
      !run.blankOrFullscreenSpinner &&
      rule.webSources.includes(run.source) &&
      (!rule.requireNoMediaDownload || run.mediaDownloadRequests === 0)
    );
  });
  const comparisonPassed = comparisonEvidencePassed && (improvementRatio >= 0.25 || savedMs >= 500);
  const regressed = desktopMedianMs > webMedianMs * 1.1 && desktopMedianMs - webMedianMs > 100;

  return {
    id: journey.id,
    absoluteLimitMs: rule.absoluteLimitMs,
    qualifyingDesktopRuns,
    absolutePassed: qualifyingDesktopRuns >= 4,
    desktopRunsMs: journey.desktopRuns.map((run) => run.durationMs),
    webRunsMs: journey.webRuns.map((run) => run.durationMs),
    desktopMediaDownloadRequests: journey.desktopRuns.map((run) => run.mediaDownloadRequests),
    webMediaDownloadRequests: journey.webRuns.map((run) => run.mediaDownloadRequests),
    desktopSources: journey.desktopRuns.map((run) => run.source),
    webSources: journey.webRuns.map((run) => run.source),
    desktopMedianMs,
    webMedianMs,
    savedMs,
    improvementPercent: improvementRatio * 100,
    comparisonEvidencePassed,
    comparisonPassed,
    regressed,
  };
}

function evaluatePlatform(platform) {
  const requiredMetadata = [
    "machine",
    "os",
    "architecture",
    "chromeVersion",
    "desktopVersion",
    "webBuild",
    "webOrigin",
    "accountFixture",
    "network",
  ];
  for (const field of requiredMetadata) {
    invariant(isRealMetadata(platform[field]), platform.platform + "." + field + " is required");
  }
  const expectedMetadata = PLATFORM_METADATA[platform.platform];
  invariant(expectedMetadata, "unknown target platform " + String(platform.platform));
  invariant(
    platform.architecture === expectedMetadata.architecture,
    platform.platform + ".architecture must be " + expectedMetadata.architecture,
  );
  invariant(
    expectedMetadata.osPattern.test(platform.os),
    platform.platform + ".os must identify the exact target OS",
  );
  invariant(
    exactHttpsOrigin(platform.webOrigin),
    platform.platform + ".webOrigin must be an exact HTTPS origin",
  );
  invariant(
    platform.clerk && typeof platform.clerk === "object",
    platform.platform + ".clerk is required",
  );
  invariant(
    typeof platform.clerk.socialProvider === "string" && platform.clerk.socialProvider.length > 0,
    platform.platform + ".clerk.socialProvider is required",
  );
  invariant(
    platform.visualContinuity && typeof platform.visualContinuity === "object",
    platform.platform + ".visualContinuity is required",
  );
  invariant(Array.isArray(platform.journeys), platform.platform + ".journeys must be an array");

  const journeys = Object.keys(JOURNEY_RULES).map((id) => {
    const matches = platform.journeys.filter((journey) => journey.id === id);
    invariant(matches.length === 1, platform.platform + " needs exactly one " + id + " journey");
    return evaluateJourney(matches[0], platform);
  });
  invariant(
    platform.journeys.length === Object.keys(JOURNEY_RULES).length,
    platform.platform + " contains an unexpected journey",
  );

  const clerkPassed = ["emailPassword", "social", "correctProducer", "secureHandoff"].every(
    (field) => platform.clerk[field] === true,
  );
  const visualContinuityPassed =
    platform.visualContinuity.liveMatchesWeb === true &&
    platform.visualContinuity.previewUsesSameShell === true;
  const comparisonWins = journeys.filter((journey) => journey.comparisonPassed).length;
  const measurementEvidencePassed = journeys.every((journey) => journey.comparisonEvidencePassed);
  const absolutePassed = journeys.every((journey) => journey.absolutePassed);
  const overallComparisonPassed =
    comparisonWins >= 2 && journeys.every((journey) => !journey.regressed);

  return {
    platform: platform.platform,
    clerkPassed,
    visualContinuityPassed,
    measurementEvidencePassed,
    absolutePassed,
    comparisonWins,
    overallComparisonPassed,
    journeys,
    passed:
      clerkPassed &&
      visualContinuityPassed &&
      measurementEvidencePassed &&
      absolutePassed &&
      overallComparisonPassed,
  };
}

export function evaluateGate1(record) {
  invariant(record && typeof record === "object", "record must be an object");
  invariant(record.schemaVersion === 1, "schemaVersion must be 1");
  invariant(Array.isArray(record.platforms), "platforms must be an array");
  if (record.platforms.length === 2) {
    invariant(
      record.platforms[0].webBuild === record.platforms[1].webBuild &&
        record.platforms[0].webOrigin === record.platforms[1].webOrigin,
      "both platforms must use the same release-candidate web build and origin",
    );
  }

  const platforms = PLATFORM_IDS.map((id) => {
    const matches = record.platforms.filter((platform) => platform.platform === id);
    invariant(matches.length === 1, "need exactly one result for " + id);
    return evaluatePlatform(matches[0]);
  });
  invariant(
    record.platforms.length === PLATFORM_IDS.length,
    "record contains an unexpected platform",
  );
  return {
    schemaVersion: 1,
    passed: platforms.every((platform) => platform.passed),
    platforms,
  };
}

function markdown(result) {
  const lines = [
    "# Desktop Gate 1 — " + (result.passed ? "PASS" : "STOP"),
    "",
    "| Platform | Clerk | Evidence | Absolute speed | Comparison | Visual continuity | Result |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const platform of result.platforms) {
    lines.push(
      "| " +
        platform.platform +
        " | " +
        (platform.clerkPassed ? "Pass" : "Fail") +
        " | " +
        (platform.measurementEvidencePassed ? "Pass" : "Fail") +
        " | " +
        (platform.absolutePassed ? "Pass" : "Fail") +
        " | " +
        (platform.overallComparisonPassed ? "Pass" : "Fail") +
        " (" +
        platform.comparisonWins +
        "/3) | " +
        (platform.visualContinuityPassed ? "Pass" : "Fail") +
        " | " +
        (platform.passed ? "PASS" : "STOP") +
        " |",
      "",
      "## " + platform.platform,
      "",
      "| Journey | Desktop runs (ms) | Web runs (ms) | Desktop median | Web median | Absolute | Comparison | Regression |",
      "| --- | --- | --- | ---: | ---: | --- | --- | --- |",
    );
    for (const journey of platform.journeys) {
      lines.push(
        "| " +
          journey.id +
          " | " +
          journey.desktopRunsMs.join(", ") +
          " | " +
          journey.webRunsMs.join(", ") +
          " | " +
          journey.desktopMedianMs +
          " | " +
          journey.webMedianMs +
          " | " +
          (journey.absolutePassed ? "Pass" : "Fail") +
          " (" +
          journey.qualifyingDesktopRuns +
          "/5) | " +
          (journey.comparisonPassed ? "Pass" : "Fail") +
          " | " +
          (journey.regressed ? "Fail" : "Pass") +
          " |",
      );
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const inputPath = process.argv[2];
  invariant(inputPath, "usage: node scripts/desktop-gate1/evaluate.mjs <record.json> [report.md]");
  const record = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
  const result = evaluateGate1(record);
  const report = markdown(result);
  if (process.argv[3]) await fs.writeFile(path.resolve(process.argv[3]), report, "utf8");
  process.stdout.write(report);
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
