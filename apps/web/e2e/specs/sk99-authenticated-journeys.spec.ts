import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, expectExactViewport, guardedCheckpoint, test } from "../fixtures/guarded-test";
import { assertSinkMessage } from "../support/email-sink";
import type { BrowserFixtureManifest } from "../support/manifest";

test.describe.configure({ mode: "serial" });

function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.metadata.mobile === true;
}

async function expectPath(page: Page, pathname: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
}

async function clickProducerNavigation(page: Page, testInfo: TestInfo): Promise<void> {
  if (isMobile(testInfo)) {
    const tabs = page.getByRole("navigation", { name: "Producer tabs" });
    for (const [label, pathname] of [
      ["Today", "/dashboard"],
      ["Clients", "/dashboard/clients-projects"],
      ["Music", "/dashboard/music"],
      ["Calendar", "/dashboard/calendar"],
      ["Payments", "/dashboard/payments"],
    ] as const) {
      await tabs.getByRole("link", { name: label, exact: true }).click();
      await expectPath(page, pathname);
      await guardedCheckpoint(page, `producer mobile ${label}`);
    }

    for (const [label, pathname] of [
      ["Store", "/dashboard/store"],
      ["Settings", "/dashboard/settings"],
    ] as const) {
      await page.getByRole("button", { name: "Open account menu" }).click();
      const accountLinks = page.getByRole("navigation", { name: "Producer account links" });
      await accountLinks.getByRole("link", { name: label, exact: true }).click();
      await expectPath(page, pathname);
      await guardedCheckpoint(page, `producer mobile ${label}`);
    }
    return;
  }

  const primary = page.getByRole("navigation", { name: "Primary" });
  for (const [label, pathname] of [
    ["Overview", "/dashboard"],
    ["Clients & Projects", "/dashboard/clients-projects"],
    ["Music", "/dashboard/music"],
    ["Calendar", "/dashboard/calendar"],
    ["Payments", "/dashboard/payments"],
    ["Store", "/dashboard/store"],
    ["Portfolio", "/dashboard/portfolio"],
    ["Settings", "/dashboard/settings"],
  ] as const) {
    await primary.getByRole("link").filter({ hasText: label }).first().click();
    await expectPath(page, pathname);
    await guardedCheckpoint(page, `producer desktop ${label}`);
  }
}

async function projectOrder(page: Page, targetNames: readonly string[]): Promise<string[]> {
  const allNames = await page
    .locator('[role="group"][aria-label^="Reorder "]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const label = row.getAttribute("aria-label") ?? "";
        return label.replace(/^Reorder /u, "").replace(/\. Use Arrow Up or Arrow Down\.$/u, "");
      }),
    );
  const targets = new Set(targetNames);
  return allNames.filter((name) => targets.has(name));
}

function projectReorderRow(page: Page, name: string): Locator {
  return page.getByRole("group", {
    name: `Reorder ${name}. Use Arrow Up or Arrow Down.`,
    exact: true,
  });
}

async function waitForSamePagePost(page: Page, action: () => Promise<void>): Promise<void> {
  const pathname = new URL(page.url()).pathname;
  const response = page.waitForResponse((candidate) => {
    return (
      candidate.request().method() === "POST" && new URL(candidate.url()).pathname === pathname
    );
  });
  await action();
  await response;
}

async function exerciseProjectsAndInvite(
  page: Page,
  manifest: BrowserFixtureManifest,
): Promise<void> {
  await page.goto("/dashboard/clients-projects");
  await page.getByRole("button", { name: "Projects", exact: true }).click();

  const sort = page.getByRole("combobox", { name: "Sort" });
  for (const option of [
    "recent",
    "deadline",
    "balance",
    "progress",
    "joined",
    "name",
    "custom",
  ] as const) {
    await sort.selectOption(option);
    await expect(sort).toHaveValue(option);
    await expect
      .poll(() => projectOrder(page, manifest.producer.projectNames))
      .toEqual(manifest.producer.projectSortOrders[option]);
  }
  const [first, second, ...rest] = manifest.producer.projectNames;
  await waitForSamePagePost(page, () => projectReorderRow(page, first).press("ArrowDown"));
  await expect
    .poll(() => projectOrder(page, manifest.producer.projectNames))
    .toEqual([second, first, ...rest]);

  await page.reload();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect
    .poll(() => projectOrder(page, manifest.producer.projectNames))
    .toEqual([second, first, ...rest]);
  await waitForSamePagePost(page, () => projectReorderRow(page, first).press("ArrowUp"));
  await expect
    .poll(() => projectOrder(page, manifest.producer.projectNames))
    .toEqual([...manifest.producer.projectNames]);
  await page.reload();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect
    .poll(() => projectOrder(page, manifest.producer.projectNames))
    .toEqual([...manifest.producer.projectNames]);

  await page.getByRole("button", { name: "Clients", exact: true }).click();
  const client = page
    .getByRole("listitem")
    .filter({ hasText: manifest.producer.uninvitedClientName });
  await client.getByRole("button", { name: "Invite to app", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite to app" });
  await expect(invite).toBeVisible();
  await guardedCheckpoint(page, "client invitation dialog");
  await invite.getByRole("button", { name: "Send invite email" }).click();
  await expect(page.getByText("Invite sent", { exact: true })).toBeVisible();
  assertSinkMessage(manifest.slot, "client-invite");
  await guardedCheckpoint(page, "projects sorting, persisted reorder, and client invitation");
}

async function exerciseAvailabilitySave(page: Page): Promise<void> {
  await page.goto("/dashboard/calendar?tab=availability");
  const sunday = page
    .getByRole("listitem")
    .filter({ has: page.getByText("Sunday", { exact: true }) })
    .getByRole("switch");
  const initialSunday = await sunday.getAttribute("aria-checked");
  if (initialSunday !== "true" && initialSunday !== "false") {
    throw new Error("Sunday availability did not expose a switch state.");
  }
  await sunday.click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Weekly hours saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(sunday).toHaveAttribute("aria-checked", initialSunday === "true" ? "false" : "true");
  await sunday.click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Weekly hours saved.", { exact: true })).toBeVisible();

  const autoConfirm = page.getByRole("region", { name: "Booking preferences" }).getByRole("switch");
  const initialAutoConfirm = await autoConfirm.getAttribute("aria-checked");
  if (initialAutoConfirm !== "true" && initialAutoConfirm !== "false") {
    throw new Error("Auto-confirm did not expose a switch state.");
  }
  await waitForSamePagePost(page, () => autoConfirm.click());
  await page.reload();
  await expect(autoConfirm).toHaveAttribute(
    "aria-checked",
    initialAutoConfirm === "true" ? "false" : "true",
  );
  await waitForSamePagePost(page, () => autoConfirm.click());
  await page.reload();
  await expect(autoConfirm).toHaveAttribute("aria-checked", initialAutoConfirm);
  await guardedCheckpoint(page, "availability and booking preference persistence");
}

function productCard(page: Page, productName: string): Locator {
  return page.locator("article").filter({ hasText: productName });
}

async function exerciseProducerStore(page: Page, manifest: BrowserFixtureManifest): Promise<void> {
  await page.goto("/dashboard/store");
  const firstName = manifest.producer.storeFirstName;
  const secondName = manifest.producer.storeSecondName;
  await waitForSamePagePost(page, () =>
    productCard(page, firstName)
      .getByRole("button", { name: `Move ${firstName} down` })
      .click(),
  );
  await expect(page.locator("article").first()).toContainText(secondName);
  await page.reload();
  await expect(page.locator("article").first()).toContainText(secondName);
  await waitForSamePagePost(page, () =>
    productCard(page, firstName)
      .getByRole("button", { name: `Move ${firstName} up` })
      .click(),
  );
  await expect(page.locator("article").first()).toContainText(firstName);
  await page.reload();
  await expect(page.locator("article").first()).toContainText(firstName);

  const editable = manifest.producer.storeEditableName;
  await productCard(page, editable)
    .getByRole("button", { name: `Hide ${editable}` })
    .click();
  await expect(page.getByText(`"${editable}" hidden.`, { exact: true })).toBeVisible();
  await page.reload();
  await productCard(page, editable)
    .getByRole("button", { name: `Make ${editable} live` })
    .click();
  await expect(page.getByText(`"${editable}" is now live.`, { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    productCard(page, editable).getByRole("button", { name: `Hide ${editable}` }),
  ).toBeVisible();
  await guardedCheckpoint(page, "producer Store reorder and visibility persistence");
}

async function exerciseUploadAndReminder(
  page: Page,
  manifest: BrowserFixtureManifest,
): Promise<void> {
  await page.goto(manifest.producer.audioSongPath);
  await expect(
    page.getByText(manifest.producer.audioSongName, { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload new version" }).first().click();
  const upload = page.getByRole("dialog", { name: "Upload new version" });
  await upload.getByLabel("Version label").fill(manifest.producer.audioVersionLabel);
  await upload.locator("#upload-track-file").setInputFiles(manifest.files.audioPath);
  await guardedCheckpoint(page, "audio upload dialog with selected file");
  await upload.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Upload complete", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(manifest.producer.audioVersionLabel, { exact: true }).first(),
  ).toBeVisible();
  await guardedCheckpoint(page, "isolated R2 audio upload");

  await page.goto("/dashboard/payments");
  await page.getByRole("button", { name: manifest.payments.reminderButtonName }).click();
  await expect(
    page.getByText(/^(Payment reminder sent and logged\.|Reminder already sent\.)$/u),
  ).toBeVisible();
  assertSinkMessage(manifest.slot, "payment-reminder");
  await guardedCheckpoint(page, "payment reminder and email sink delivery");
}

async function clickArtistNavigation(page: Page, testInfo: TestInfo): Promise<void> {
  const navigation = page.getByRole("navigation", {
    name: isMobile(testInfo) ? "Artist app tabs" : "Primary",
  });
  for (const [label, pathname] of [
    ["Home", "/artist"],
    ["Music", "/artist/music"],
    ["Book", "/artist/book"],
    ["Store", "/artist/store"],
    ["Payments", "/artist/payments"],
  ] as const) {
    await navigation.getByRole("link", { name: label, exact: true }).click();
    await expectPath(page, pathname);
    await expect.poll(() => new URL(page.url()).searchParams.has("studio")).toBe(true);
    await guardedCheckpoint(page, `artist ${label}`);
  }
}

async function exerciseArtistStudioAndStore(
  page: Page,
  testInfo: TestInfo,
  manifest: BrowserFixtureManifest,
): Promise<void> {
  await page.goto("/artist");
  await clickArtistNavigation(page, testInfo);
  const studioAId = new URL(page.url()).searchParams.get("studio");
  if (!studioAId) throw new Error("Artist navigation did not preserve a studio context.");

  await page.getByRole("button", { name: manifest.artist.studioAName, exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Pick a studio" });
  await guardedCheckpoint(page, "artist studio picker");
  await picker.getByRole("button", { name: manifest.artist.studioBName, exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("studio")).not.toBe(studioAId);

  const navigation = page.getByRole("navigation", {
    name: isMobile(testInfo) ? "Artist app tabs" : "Primary",
  });
  await navigation.getByRole("link", { name: "Store", exact: true }).click();
  await expect(page.getByText(manifest.artist.studioBMarker, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: manifest.artist.studioBName, exact: true }).click();
  const secondPicker = page.getByRole("dialog", { name: "Pick a studio" });
  await guardedCheckpoint(page, "artist second studio picker");
  await secondPicker
    .getByRole("button", { name: manifest.artist.studioAName, exact: true })
    .click();
  await expect.poll(() => new URL(page.url()).searchParams.get("studio")).toBe(studioAId);

  const card = productCard(page, manifest.artist.storeProductName);
  await card.getByRole("link", { name: "View details", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send request" })).toBeVisible();
  await guardedCheckpoint(page, "artist Store product detail");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: /Request sent/u })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname.endsWith("/sent")).toBe(true);
  await guardedCheckpoint(page, "multi-studio context and artist Store request");
}

async function exerciseBooking(
  artistPage: Page,
  producerPage: Page,
  manifest: BrowserFixtureManifest,
): Promise<void> {
  await artistPage.goto(manifest.booking.artistBookPath);
  const credits = artistPage.getByRole("region", { name: "Your prepaid sessions" });
  await credits.getByRole("button").first().click();
  await expect.poll(() => new URL(artistPage.url()).searchParams.has("allowance")).toBe(true);
  await guardedCheckpoint(artistPage, "artist booking calendar");
  const availableDate = artistPage
    .locator('button[role="gridcell"][aria-disabled="false"]')
    .first();
  await availableDate.click();
  const timePicker = artistPage.getByRole("region", { name: "Pick a time" });
  await expect(timePicker).toBeVisible();
  await guardedCheckpoint(artistPage, "artist booking time picker");
  await timePicker.getByRole("button").first().click();
  const requestSlot = artistPage.getByRole("button", { name: "Request this slot", exact: true });
  await expect(requestSlot).toBeVisible();
  await guardedCheckpoint(artistPage, "artist booking confirmation action");
  await requestSlot.click();
  await expectPath(artistPage, "/artist/sessions");
  const bookingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  await expect
    .poll(() => new URL(artistPage.url()).searchParams.get("just") ?? "")
    .toMatch(bookingIdPattern);
  const createdBookingId = new URL(artistPage.url()).searchParams.get("just");
  if (!createdBookingId || !bookingIdPattern.test(createdBookingId)) {
    throw new Error("Artist booking did not expose its isolated booking ID.");
  }
  await expect(artistPage.getByText("Holding this time", { exact: true })).toBeVisible();
  await guardedCheckpoint(artistPage, "artist prepaid-session booking");

  await producerPage.goto(`/dashboard/calendar?booking=${encodeURIComponent(createdBookingId)}`);
  const pending = producerPage
    .getByRole("region", { name: "Pending requests" })
    .locator('li[data-selected="true"]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText(manifest.booking.pendingArtistName);
  await guardedCheckpoint(producerPage, "newly created producer booking request");
  await pending.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(producerPage.getByText("Booking confirmed.", { exact: true })).toBeVisible();
  await expect(pending).toHaveCount(0);
  await guardedCheckpoint(producerPage, "producer booking acceptance");

  await artistPage.reload();
  await expect(artistPage.getByText("You're booked", { exact: true })).toBeVisible();
  await guardedCheckpoint(artistPage, "artist sees accepted booking");
}

async function attachProofWithClick(page: Page, trigger: Locator, filePath: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await trigger.click();
  await (await chooser).setFiles(filePath);
}

async function exercisePaymentProofs(
  artistPage: Page,
  producerPage: Page,
  manifest: BrowserFixtureManifest,
): Promise<void> {
  await artistPage.goto(manifest.payments.artistProofUploadPath);
  await guardedCheckpoint(artistPage, "new payment-proof upload screen");
  await attachProofWithClick(
    artistPage,
    artistPage.getByRole("button", { name: /Take a photo or choose a file/u }),
    manifest.files.proofPath,
  );
  await guardedCheckpoint(artistPage, "new payment-proof file selected");
  await artistPage.getByRole("button", { name: "Send proof" }).click();
  await expect(artistPage.getByRole("heading", { name: "Proof sent" })).toBeVisible();
  await guardedCheckpoint(artistPage, "new payment-proof upload");

  await artistPage.goto(manifest.payments.rejectedProofReplacementPath);
  await attachProofWithClick(
    artistPage,
    artistPage.getByRole("button", { name: /Choose replacement/u }),
    manifest.files.replacementProofPath,
  );
  await guardedCheckpoint(artistPage, "replacement payment-proof file selected");
  await artistPage.getByRole("button", { name: "Send proof" }).click();
  await expect(artistPage.getByRole("heading", { name: "Proof sent" })).toBeVisible();
  await guardedCheckpoint(artistPage, "rejected payment-proof replacement");

  await producerPage.goto(manifest.payments.pendingProofRejectPath);
  await producerPage.getByRole("button", { name: "Reject proof" }).click();
  await expect(producerPage.getByRole("dialog")).toBeVisible();
  await guardedCheckpoint(producerPage, "payment-proof rejection dialog");
  await producerPage
    .getByLabel("Message shown to the artist")
    .fill("Please upload the complete receipt.");
  await producerPage.getByRole("button", { name: "Send note & reject" }).click();
  await expect(
    producerPage.getByText("Proof rejected. The artist can see your note and replace it."),
  ).toBeVisible();
  await guardedCheckpoint(producerPage, "producer proof rejection");

  await producerPage.goto(manifest.payments.pendingProofConfirmPath);
  await producerPage.getByRole("button", { name: /^Confirm /u }).click();
  await expect(producerPage.getByRole("dialog")).toBeVisible();
  await guardedCheckpoint(producerPage, "payment-proof confirmation dialog");
  await producerPage.getByRole("button", { name: "Confirm payment" }).click();
  await expect(
    producerPage.getByText("Payment confirmed and recorded once.", { exact: true }),
  ).toBeVisible();
  await guardedCheckpoint(producerPage, "producer proof confirmation");
}

test("producer navigation, saves, sorting, reorder, invitation, and Store", async ({
  producerPage,
  manifest,
}, testInfo) => {
  expectExactViewport(producerPage, testInfo);
  await producerPage.goto("/dashboard");
  await clickProducerNavigation(producerPage, testInfo);
  await exerciseProjectsAndInvite(producerPage, manifest);
  await exerciseAvailabilitySave(producerPage);
  await exerciseProducerStore(producerPage, manifest);
});

test("producer upload and payment reminder reach isolated sinks", async ({
  producerPage,
  manifest,
}, testInfo) => {
  expectExactViewport(producerPage, testInfo);
  await exerciseUploadAndReminder(producerPage, manifest);
});

test("artist navigation, multi-studio, booking, Store, and payment proofs", async ({
  producerPage,
  artistPage,
  manifest,
}, testInfo) => {
  expectExactViewport(producerPage, testInfo);
  expectExactViewport(artistPage, testInfo);
  await exerciseArtistStudioAndStore(artistPage, testInfo, manifest);
  await exerciseBooking(artistPage, producerPage, manifest);
  await exercisePaymentProofs(artistPage, producerPage, manifest);
});
