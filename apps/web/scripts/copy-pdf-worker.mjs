// Copy the pdfjs-dist worker file into apps/web/public so it's served
// at /pdf.worker.min.mjs — which is what `pdf-worker.ts` points
// `pdfjs.GlobalWorkerOptions.workerSrc` at.
//
// Why this script exists: react-pdf pins pdfjs-dist to an exact
// version (e.g. 5.4.296 for react-pdf@10.4.1). The pdfjs API that
// loads at runtime MUST match the worker file byte-for-byte, or pdfjs
// throws "API version X does not match Worker version Y" and the PDF
// never renders.
//
// Strategy: resolve react-pdf's OWN copy of pdfjs-dist via Node's
// module resolution — not the project's direct `pdfjs-dist` dep,
// which can drift — and copy that worker file verbatim. Runs on every
// `pnpm build` via the prebuild script in package.json.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

// createRequire lets us use `require.resolve` to find react-pdf's
// package.json, whose directory is the base for its nested pdfjs-dist.
const require = createRequire(import.meta.url);
const reactPdfPkg = require.resolve("react-pdf/package.json");
const reactPdfDir = dirname(reactPdfPkg);

// react-pdf depends on pdfjs-dist. Resolve from react-pdf's own dir so
// we get its transitive copy, not the top-level one.
const pdfjsPkg = require.resolve("pdfjs-dist/package.json", {
  paths: [reactPdfDir],
});
const pdfjsDir = dirname(pdfjsPkg);
const workerSrc = resolve(pdfjsDir, "build", "pdf.worker.min.mjs");
const workerDest = resolve(webRoot, "public", "pdf.worker.min.mjs");

mkdirSync(dirname(workerDest), { recursive: true });
copyFileSync(workerSrc, workerDest);

// Surface the resolved version so build logs show exactly which
// worker shipped with this deploy.
const pdfjsVersion = require(pdfjsPkg).version;
console.log(`[copy-pdf-worker] pdfjs-dist ${pdfjsVersion} → public/pdf.worker.min.mjs`);
