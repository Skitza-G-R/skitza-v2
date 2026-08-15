import { spawn } from "node:child_process";

import {
  DEFAULT_DESKTOP_ORIGIN,
  exactHttpsOrigin,
  writeProofConfig,
} from "./origin-config.mjs";

const [command, ...args] = process.argv.slice(2);
if (command !== "dev" && command !== "build") {
  throw new Error("Usage: node scripts/run-tauri.mjs <dev|build> [...args]");
}

const origin = exactHttpsOrigin(
  process.env.SKITZA_DESKTOP_ORIGIN ?? DEFAULT_DESKTOP_ORIGIN,
);
const configPath = await writeProofConfig(origin);
const tauriCli = process.platform === "win32" ? "tauri.cmd" : "tauri";

const child = spawn(tauriCli, [command, "--config", configPath, ...args], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    SKITZA_DESKTOP_ORIGIN: origin,
  },
  stdio: "inherit",
  shell: false,
});

child.on("error", (error) => {
  throw error;
});

const exitCode = await new Promise((resolveExit) => {
  child.on("exit", (code, signal) => {
    if (signal) {
      resolveExit(1);
      return;
    }
    resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
