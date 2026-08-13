import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DESKTOP_ORIGIN = "https://skitza.app";

export function exactHttpsOrigin(rawValue = DEFAULT_DESKTOP_ORIGIN) {
  const raw = rawValue.trim();
  if (raw.includes("*")) {
    throw new Error("SKITZA_DESKTOP_ORIGIN must not contain a wildcard");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SKITZA_DESKTOP_ORIGIN must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("SKITZA_DESKTOP_ORIGIN must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("SKITZA_DESKTOP_ORIGIN must not include credentials");
  }
  if ((parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error("SKITZA_DESKTOP_ORIGIN must be an origin without a path, query, or fragment");
  }

  return parsed.origin;
}

export function proofConfig(origin) {
  const trustedOrigin = exactHttpsOrigin(origin);
  return {
    app: {
      security: {
        capabilities: [
          {
            identifier: "gate1-local",
            description: "Local startup surface with narrow Gate 1 commands",
            windows: ["main"],
            permissions: ["allow-retry-launch"],
          },
          {
            identifier: "gate1-trusted-remote",
            description: "Exact trusted Skitza proof origin with narrow Gate 1 commands",
            windows: ["main"],
            local: false,
            remote: {
              urls: [`${trustedOrigin}/*`],
            },
            permissions: [
              "allow-begin-social-sign-in",
              "allow-record-gate1-sample",
              "allow-consume-reveal-elapsed-ms",
              "allow-export-gate1-samples",
              "allow-report-session-validation",
            ],
          },
        ],
      },
    },
  };
}

export async function writeProofConfig(origin) {
  const here = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(here, "../src-tauri/gen/gate1-origin.conf.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proofConfig(origin), null, 2)}\n`, {
    mode: 0o600,
  });
  return outputPath;
}
