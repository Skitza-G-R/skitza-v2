import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { authStatePath } from "../support/auth-state";
import { guardedCheckpoint, installContextGuards } from "../support/browser-guards";
import {
  readBrowserFixtureManifest,
  slotFromProjectMetadata,
  type BrowserFixtureManifest,
} from "../support/manifest";

type GuardedFixtures = {
  manifest: BrowserFixtureManifest;
  producerPage: Page;
  artistPage: Page;
};

function viewportFrom(testInfo: TestInfo): { width: number; height: number } {
  const width: unknown = Reflect.get(testInfo.project.metadata, "viewportWidth");
  const height: unknown = Reflect.get(testInfo.project.metadata, "viewportHeight");
  if (typeof width !== "number" || typeof height !== "number") {
    throw new Error("Playwright project is missing exact viewport metadata.");
  }
  return { width, height };
}

function mobileFrom(testInfo: TestInfo): boolean {
  return testInfo.project.metadata.mobile === true;
}

async function guardedPage(
  context: BrowserContext,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const page = await context.newPage();
  await use(page);
}

export const test = base.extend<GuardedFixtures>({
  manifest: async ({ baseURL: _baseURL }, use, testInfo) => {
    void _baseURL;
    const slot = slotFromProjectMetadata(testInfo.project.metadata);
    await use(readBrowserFixtureManifest(slot));
  },

  producerPage: async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error("Playwright baseURL is required.");
    const guard = installContextGuards(page.context(), baseURL);
    try {
      await use(page);
    } finally {
      await guard.assertClean("final producer context state");
    }
  },

  artistPage: async ({ browser, baseURL }, use, testInfo) => {
    if (!baseURL) throw new Error("Playwright baseURL is required.");
    const isMobile = mobileFrom(testInfo);
    const context = await browser.newContext({
      baseURL,
      storageState: authStatePath("artist"),
      viewport: viewportFrom(testInfo),
      isMobile,
      hasTouch: isMobile,
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "Asia/Jerusalem",
    });
    try {
      const guard = installContextGuards(context, baseURL);
      try {
        await guardedPage(context, use);
      } finally {
        await guard.assertClean("final artist context state");
      }
    } finally {
      await context.close();
    }
  },
});

export { expect, guardedCheckpoint };

export function expectExactViewport(page: Page, testInfo: TestInfo): void {
  expect(page.viewportSize()).toEqual(viewportFrom(testInfo));
}
