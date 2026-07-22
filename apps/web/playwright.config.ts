import { defineConfig } from "@playwright/test";

import {
  SK102_BROWSER_RUN_ADMITTED_ENV,
  SK102_BROWSER_RUN_LEASE_ENV,
  SK102_REPOSITORY_ROOT,
  validateSk102BrowserRunLeaseToken,
} from "./src/server/operations/sk102-fixtures/contract";
import {
  assertSk102ConfinedLocalPathSync,
  sk102BrowserEvidenceDirectory,
  sk102BrowserTestResultsDirectory,
} from "./src/server/operations/sk102-fixtures/local-state";
import { AUTH_DIRECTORY, authStatePath } from "./e2e/support/auth-state";
import type { E2ESlot } from "./e2e/support/manifest";

const listOnly = process.env.SKITZA_E2E_LIST_ONLY === "1";
if (process.env[SK102_BROWSER_RUN_ADMITTED_ENV] !== undefined) {
  throw new Error("SK102_BROWSER_RUN_ADMISSION_AMBIENT_FORBIDDEN");
}
if (listOnly) {
  if (process.env[SK102_BROWSER_RUN_LEASE_ENV] !== undefined) {
    throw new Error("SK102_BROWSER_RUN_LEASE_AMBIENT_FORBIDDEN");
  }
} else {
  validateSk102BrowserRunLeaseToken(process.env[SK102_BROWSER_RUN_LEASE_ENV]);
}

const testResultsDirectory = sk102BrowserTestResultsDirectory(SK102_REPOSITORY_ROOT);
for (const target of [
  AUTH_DIRECTORY,
  authStatePath("producer"),
  authStatePath("artist"),
  sk102BrowserEvidenceDirectory(SK102_REPOSITORY_ROOT),
  testResultsDirectory,
]) {
  assertSk102ConfinedLocalPathSync(SK102_REPOSITORY_ROOT, target);
}

const LOCAL_BASE_URL = "http://127.0.0.1:3102";
const baseURL = LOCAL_BASE_URL;

if (process.env.SKITZA_E2E_BASE_URL?.trim()) {
  throw new Error("SKITZA_E2E_BASE_URL is forbidden; the harness owns its loopback server.");
}
if (process.env.SKITZA_E2E_MANAGE_FIXTURES !== undefined) {
  throw new Error("SKITZA_E2E_MANAGE_FIXTURES is forbidden; the harness always owns fixtures.");
}

function approvedURL(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
}

const configuredURL = approvedURL(baseURL, "Browser base URL");
if (
  configuredURL.origin !== LOCAL_BASE_URL ||
  configuredURL.username !== "" ||
  configuredURL.password !== "" ||
  (configuredURL.pathname !== "/" && configuredURL.pathname !== "") ||
  configuredURL.search !== "" ||
  configuredURL.hash !== ""
) {
  throw new Error("Authenticated browser tests run only on the fixed SK-102 loopback origin.");
}

type BrowserProject = Readonly<{
  name: string;
  slot: E2ESlot;
  viewport: { width: number; height: number };
  mobile: boolean;
}>;

const browsers: readonly BrowserProject[] = [
  {
    name: "chromium-desktop",
    slot: "desktop",
    viewport: { width: 1440, height: 900 },
    mobile: false,
  },
  {
    name: "chromium-390",
    slot: "phone390",
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
  {
    name: "chromium-360",
    slot: "phone360",
    viewport: { width: 360, height: 800 },
    mobile: true,
  },
] as const;

const selectedSlot = process.env.SKITZA_E2E_SLOT;
const selectedBrowser = browsers.find((project) => project.slot === selectedSlot);
if (!selectedBrowser) {
  throw new Error(
    "SKITZA_E2E_SLOT must be one of desktop, phone390, or phone360. Use the test:browser script to run all slots safely.",
  );
}

const fixtureProjects = [
  {
    name: `cleanup-${selectedBrowser.slot}`,
    testMatch: /environment\.teardown\.ts/u,
    metadata: { e2eSlot: selectedBrowser.slot },
  },
  {
    name: `seed-${selectedBrowser.slot}`,
    testMatch: /environment\.setup\.ts/u,
    teardown: `cleanup-${selectedBrowser.slot}`,
    metadata: { e2eSlot: selectedBrowser.slot },
  },
];

const browserProjects = [
  {
    name: selectedBrowser.name,
    testMatch: /specs\/.*\.spec\.ts/u,
    dependencies: ["auth", `seed-${selectedBrowser.slot}`],
    metadata: {
      e2eSlot: selectedBrowser.slot,
      viewportWidth: selectedBrowser.viewport.width,
      viewportHeight: selectedBrowser.viewport.height,
      mobile: selectedBrowser.mobile,
    },
    use: {
      browserName: "chromium" as const,
      storageState: authStatePath("producer"),
      viewport: selectedBrowser.viewport,
      isMobile: selectedBrowser.mobile,
      hasTouch: selectedBrowser.mobile,
      deviceScaleFactor: 1,
    },
  },
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/u,
  outputDir: testResultsDirectory,
  globalSetup: "./e2e/global.setup.ts",
  globalTeardown: "./e2e/global.teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60 * 1000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [["./e2e/support/safe-reporter.ts"]],
  use: {
    baseURL,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "Asia/Jerusalem",
    contextOptions: { reducedMotion: "reduce" },
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    command: process.env.CI
      ? "corepack pnpm start --hostname 127.0.0.1 --port 3102"
      : "corepack pnpm dev --hostname 127.0.0.1 --port 3102",
    url: LOCAL_BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "ignore",
  },
  projects: [
    {
      name: "auth",
      testMatch: /auth\.setup\.ts/u,
      use: { screenshot: "off", trace: "off", video: "off" },
    },
    ...fixtureProjects,
    ...browserProjects,
  ],
});
