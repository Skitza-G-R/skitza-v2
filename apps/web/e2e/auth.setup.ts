import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";
import { approvedSk102Runtime } from "@skitza/db/sk102-runtime";
import { chmod, rename, writeFile } from "node:fs/promises";

import {
  SK102_REPOSITORY_ROOT,
  validateSk102FixtureIdentity,
} from "../src/server/operations/sk102-fixtures/contract";
import {
  assertSk102ConfinedLocalPath,
  prepareSk102ConfinedDirectory,
  removeSk102AuthState,
} from "../src/server/operations/sk102-fixtures/local-state";
import { AUTH_DIRECTORY, authStatePath } from "./support/auth-state";
import { installContextGuards } from "./support/browser-guards";
import { isolatedClerkSetupOptions } from "./support/clerk-setup";

setup.describe.configure({ mode: "serial" });

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required isolated browser auth setting: ${name}.`);
  return value;
}

setup("create secret producer and artist auth states", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("Playwright baseURL is required for authenticated setup.");
  const runtime = approvedSk102Runtime();
  if (!runtime) throw new Error("SK102_RUNTIME_REQUIRED");
  const fixtureIdentity = validateSk102FixtureIdentity({
    producerClerkUserId: requiredSetting("SKITZA_E2E_PRODUCER_CLERK_USER_ID"),
    artistClerkUserId: requiredSetting("SKITZA_E2E_ARTIST_CLERK_USER_ID"),
    producerEmail: requiredSetting("SKITZA_E2E_PRODUCER_EMAIL"),
    artistEmail: requiredSetting("SKITZA_E2E_ARTIST_EMAIL"),
    sinkEmailDomain: runtime.emailAllowedRecipientDomain,
  });
  await clerkSetup(isolatedClerkSetupOptions(runtime));
  await removeSk102AuthState(SK102_REPOSITORY_ROOT);
  await prepareSk102ConfinedDirectory(SK102_REPOSITORY_ROOT, AUTH_DIRECTORY);
  await chmod(AUTH_DIRECTORY, 0o700);

  const identities = [
    {
      role: "producer" as const,
      email: fixtureIdentity.producerEmail,
      clerkUserId: fixtureIdentity.producerClerkUserId,
    },
    {
      role: "artist" as const,
      email: fixtureIdentity.artistEmail,
      clerkUserId: fixtureIdentity.artistClerkUserId,
    },
  ];

  for (const identity of identities) {
    const context = await browser.newContext({ baseURL });
    try {
      const guard = installContextGuards(context, baseURL);
      const page = await context.newPage();
      await page.goto("/");
      await clerk.loaded({ page });
      await clerk.signIn({ page, emailAddress: identity.email });
      await expect
        .poll(async () => page.evaluate(() => window.Clerk.user?.id ?? null), {
          message: `Expected the exact isolated ${identity.role} Clerk fixture.`,
        })
        .toBe(identity.clerkUserId);
      await guard.assertClean(`authenticated ${identity.role} setup`);
      const statePath = authStatePath(identity.role);
      const temporaryStatePath = `${statePath}.tmp`;
      await Promise.all([
        assertSk102ConfinedLocalPath(SK102_REPOSITORY_ROOT, statePath),
        assertSk102ConfinedLocalPath(SK102_REPOSITORY_ROOT, temporaryStatePath),
      ]);
      const state = await context.storageState();
      await writeFile(temporaryStatePath, `${JSON.stringify(state)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await assertSk102ConfinedLocalPath(SK102_REPOSITORY_ROOT, temporaryStatePath);
      await rename(temporaryStatePath, statePath);
      await assertSk102ConfinedLocalPath(SK102_REPOSITORY_ROOT, statePath);
      await chmod(statePath, 0o600);
    } finally {
      await context.close();
    }
  }
});
