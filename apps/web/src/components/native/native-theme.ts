import type { ThemeProviderProps } from "next-themes";

/**
 * Shared next-themes configuration for the native experience.
 *
 * System is the first-visit default. Calling `setTheme("light")` or
 * `setTheme("dark")` remains the explicit persisted manual override used by
 * the existing ThemeToggle.
 */
export const nativeThemeProviderProps = {
  attribute: "data-theme",
  value: { light: "", dark: "chrome-dark" },
  defaultTheme: "system",
  enableSystem: true,
  disableTransitionOnChange: true,
} as const satisfies Omit<ThemeProviderProps, "children">;
