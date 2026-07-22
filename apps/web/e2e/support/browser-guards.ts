import { expect, type BrowserContext, type Page } from "@playwright/test";

import { safeNetworkFailureCode, safeRequestLabel } from "./redaction";

type BrowserFailure = Readonly<{
  kind: "http" | "request" | "console" | "page" | "crash";
  detail: string;
}>;

export function isolatedR2Origins(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlySet<string> {
  const accountId = environment.R2_ACCOUNT_ID?.trim().toLowerCase();
  const audioBucket = environment.R2_BUCKET_AUDIO?.trim().toLowerCase();
  const docsBucket = environment.R2_BUCKET_DOCS?.trim().toLowerCase();
  if (!accountId || !/^[0-9a-f]{32}$/u.test(accountId)) {
    throw new Error("Strict browser guards require a valid isolated R2 account target.");
  }
  if (
    !audioBucket ||
    !docsBucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(audioBucket) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(docsBucket) ||
    audioBucket === docsBucket
  ) {
    throw new Error("Strict browser guards require two valid isolated R2 buckets.");
  }

  // Cloudflare R2 presigns may use the account endpoint or virtual-hosted
  // bucket endpoints. Derive every guarded origin in memory from the exact
  // runtime target; no user-supplied origin list can omit or add a host.
  const endpointHost = `${accountId}.r2.cloudflarestorage.com`;
  return new Set([
    `https://${endpointHost}`,
    `https://${audioBucket}.${endpointHost}`,
    `https://${docsBucket}.${endpointHost}`,
  ]);
}

function responseIsGuarded(
  rawUrl: string,
  baseURL: string,
  critical: ReadonlySet<string>,
): boolean {
  try {
    const origin = new URL(rawUrl).origin;
    return origin === new URL(baseURL).origin || critical.has(origin);
  } catch {
    return true;
  }
}

function diagnostic(failure: BrowserFailure): string {
  return `${failure.kind}: ${failure.detail}`;
}

export type PageGuard = Readonly<{
  assertClean: (checkpoint: string) => Promise<void>;
}>;

const GUARDS = new WeakMap<Page, PageGuard>();

export function installPageGuards(page: Page, baseURL: string): PageGuard {
  const installed = GUARDS.get(page);
  if (installed) return installed;
  const failures = new Map<string, BrowserFailure>();
  const critical = isolatedR2Origins();
  const record = (failure: BrowserFailure) => {
    failures.set(diagnostic(failure), failure);
  };

  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400 && status <= 599 && responseIsGuarded(response.url(), baseURL, critical)) {
      record({
        kind: "http",
        detail: `${response.request().method()} ${safeRequestLabel(response.url(), baseURL)} returned ${String(status)}`,
      });
    }
  });

  page.on("requestfailed", (request) => {
    record({
      kind: "request",
      detail: `${request.method()} ${safeRequestLabel(request.url(), baseURL)} ${safeNetworkFailureCode(
        request.failure()?.errorText,
      )}`,
    });
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      record({ kind: "console", detail: "browser console.error (message withheld)" });
    }
  });

  page.on("pageerror", () => {
    record({ kind: "page", detail: "uncaught page error (message withheld)" });
  });

  page.on("crash", () => {
    record({ kind: "crash", detail: "page crashed" });
  });

  const guard: PageGuard = {
    async assertClean(checkpoint) {
      if (!page.isClosed()) await expectNoHorizontalOverflow(page, checkpoint);
      if (failures.size > 0) {
        throw new Error(
          `Browser guard failed at ${checkpoint}:\n${[...failures.values()]
            .map((failure) => `- ${diagnostic(failure)}`)
            .join("\n")}`,
        );
      }
    },
  };
  GUARDS.set(page, guard);
  return guard;
}

export type ContextGuard = Readonly<{
  assertClean: (checkpoint: string) => Promise<void>;
}>;

export function installContextGuards(context: BrowserContext, baseURL: string): ContextGuard {
  const guardedPages = new Map<Page, PageGuard>();
  const attach = (page: Page) => {
    guardedPages.set(page, installPageGuards(page, baseURL));
  };
  for (const page of context.pages()) attach(page);
  context.on("page", attach);

  return {
    async assertClean(checkpoint) {
      for (const [index, guard] of [...guardedPages.values()].entries()) {
        await guard.assertClean(`${checkpoint} page ${String(index + 1)}`);
      }
    },
  };
}

export async function expectNoHorizontalOverflow(page: Page, checkpoint: string): Promise<void> {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const tolerance = 1;
    const overflow = Math.max(
      root.scrollWidth - root.clientWidth,
      body.scrollWidth - body.clientWidth,
    );
    const offenderTags = [...body.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 && (box.right > window.innerWidth + tolerance || box.left < -tolerance)
        );
      })
      .slice(0, 6)
      .map((element) => element.tagName.toLowerCase());
    return {
      overflow,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      offenderTags,
    };
  });

  expect(
    result.overflow,
    `${checkpoint} has horizontal overflow (${result.offenderTags.join(", ") || "offender unknown"}).`,
  ).toBeLessThanOrEqual(1);
}

export async function guardedCheckpoint(page: Page, checkpoint: string): Promise<void> {
  const guard = GUARDS.get(page);
  if (!guard) throw new Error("Page was used without the strict browser guard fixture.");
  await guard.assertClean(checkpoint);
}
