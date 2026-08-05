import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WEB_SRC = join(process.cwd(), "src");

function readSource(...parts: string[]) {
  return readFileSync(join(WEB_SRC, ...parts), "utf8");
}

const focusedScreens = [
  "choose-plan-screen.tsx",
  "payment-instructions-screen.tsx",
  "proof-record-screen.tsx",
  "purchase-request-screen.tsx",
  "request-sent-screen.tsx",
  "review-agree-screen.tsx",
  "upload-proof-screen.tsx",
] as const;

const focusedLoadingStates = [
  "agree/loading.tsx",
  "pay/loading.tsx",
  "pay/instructions/loading.tsx",
  "pay/proof/loading.tsx",
  "sent/loading.tsx",
] as const;

describe("artist purchase and payment viewport contract", () => {
  it.each(focusedScreens)("keeps %s inside the measured visual viewport", (fileName) => {
    const source = readSource("components", "artist", "purchase", fileName);

    expect(source).toContain("sk-native-screen");
    expect(source).toContain("top-[var(--sk-viewport-offset-top,0px)]");
    expect(source).toContain("sk-native-scroll");
    expect(source).not.toContain("fixed inset-0");
    expect(source).not.toContain("min-h-dvh");
    expect(source).not.toContain("sticky bottom-0");
  });

  it.each(focusedLoadingStates)(
    "keeps the %s skeleton inside the measured visual viewport",
    (relativePath) => {
      const source = readSource(
        "app",
        "(artist)",
        "artist",
        "purchase",
        "[productId]",
        ...relativePath.split("/"),
      );

      expect(source).toContain("sk-native-screen");
      expect(source).toContain("top-[var(--sk-viewport-offset-top,0px)]");
      expect(source).not.toContain("fixed inset-0");
    },
  );
});
