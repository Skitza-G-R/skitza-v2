import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next sets jsx: "preserve" in tsconfig so Next's SWC owns the JSX
  // transform at build time. Vitest reads that same tsconfig but runs
  // oxc, which honours "preserve" unless we override it here.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
