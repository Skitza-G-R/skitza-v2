import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STEP_NAME,
  SERVICE_STEP_INDEX,
  SERVICE_STEP_SUBTITLE,
  SERVICE_STEP_TITLE,
  nextRouteAfterService,
  routeOnBackFromService,
} from "../page";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "page.tsx"),
  "utf8",
);

describe("first-product onboarding page contract", () => {
  it("is the third outer setup milestone", () => {
    expect(SERVICE_STEP_INDEX).toBe(3);
    expect(SERVICE_STEP_TITLE.toLowerCase()).toContain("product");
    expect(SERVICE_STEP_SUBTITLE.toLowerCase()).toContain("hidden");
    expect(ONBOARDING_STEP_NAME).toBe("service");
  });

  it("returns to public identity and sends session products to hours", () => {
    expect(routeOnBackFromService()).toBe("/onboarding/studio");
    expect(nextRouteAfterService()).toBe("/onboarding/availability");
  });

  it("hydrates the existing first product instead of creating a duplicate", () => {
    expect(source).toContain("caller.booking.packages.list()");
    expect(source).toContain("product={packages[0] ? toStoreProduct(packages[0]) : null}");
  });
});
