import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { nativeThemeProviderProps } from "../native-theme";

const themeToggleSource = readFileSync(
  fileURLToPath(new URL("../../shell/theme-toggle.tsx", import.meta.url)),
  "utf8",
);

describe("native theme provider preset", () => {
  it("defaults to the system while preserving explicit light/dark values", () => {
    expect(nativeThemeProviderProps).toEqual({
      attribute: "data-theme",
      value: { light: "", dark: "chrome-dark" },
      defaultTheme: "system",
      enableSystem: true,
      disableTransitionOnChange: true,
    });
  });

  it("keeps the existing light/dark control as a persisted manual override", () => {
    expect(themeToggleSource).toContain('setTheme(isDark ? "light" : "dark")');
    expect(themeToggleSource).toContain("sk-press inline-flex h-11 w-11");
  });
});
