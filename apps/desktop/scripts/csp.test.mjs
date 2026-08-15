import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

function cspDirectives(value) {
  return new Map(
    value
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/u);
        return [name, sources];
      }),
  );
}

test("bundled startup allows only Tauri IPC connections", () => {
  const directives = cspDirectives(config.app.security.csp);

  assert.deepEqual(directives.get("connect-src"), ["ipc:", "http://ipc.localhost"]);
  assert.equal(directives.get("connect-src").some((source) => source.startsWith("https:")), false);
  assert.equal(directives.get("connect-src").some((source) => source.startsWith("wss:")), false);
});
