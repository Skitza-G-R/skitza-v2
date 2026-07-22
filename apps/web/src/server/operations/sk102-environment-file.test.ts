import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadSk102EnvironmentFile, sk102EnvironmentFilePath } from "./sk102-environment-file";

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sk102-env-file-test-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeEnvironment(root: string, source: string, mode = 0o600): Promise<string> {
  const target = sk102EnvironmentFilePath(root);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source, { mode });
  await chmod(target, mode);
  return target;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("SK-102 private environment file", () => {
  it("loads only literal approved names from the fixed ignored path", async () => {
    const root = await temporaryRoot();
    await writeEnvironment(
      root,
      [
        "# private local SK-102 values",
        "SK102_E2E_MODE=isolated_nonproduction",
        "SK102_SLOT=sk102-browser",
        "SITE_URL=http://127.0.0.1:3102",
      ].join("\n"),
    );
    const environment: Record<string, string | undefined> = {};

    expect(loadSk102EnvironmentFile(root, environment)).toBe(true);
    expect(environment).toEqual({
      SK102_E2E_MODE: "isolated_nonproduction",
      SK102_SLOT: "sk102-browser",
      SITE_URL: "http://127.0.0.1:3102",
    });
  });

  it("is optional but rejects conflicts, forbidden names, and broad permissions", async () => {
    const root = await temporaryRoot();
    expect(loadSk102EnvironmentFile(root, {})).toBe(false);

    await writeEnvironment(root, "SK102_SLOT=sk102-browser\n");
    expect(() => loadSk102EnvironmentFile(root, { SK102_SLOT: "different" })).toThrow(
      "SK102_ENV_FILE_CONFLICT",
    );

    await writeEnvironment(root, "RESEND_API_KEY=forbidden-placeholder\n");
    expect(() => loadSk102EnvironmentFile(root, {})).toThrow("SK102_ENV_FILE_INVALID");

    await writeEnvironment(root, "SK102_SLOT=sk102-browser\n", 0o644);
    expect(() => loadSk102EnvironmentFile(root, {})).toThrow("SK102_ENV_FILE_INVALID");
  });

  it("rejects duplicate, quoted, and one-shot mutation settings", async () => {
    const root = await temporaryRoot();
    for (const source of [
      "SK102_SLOT=sk102-browser\nSK102_SLOT=sk102-browser\n",
      'SK102_SLOT="sk102-browser"\n',
      "SK102_R2_CORS_MUTATION_CONFIRMATION=approved-exact-sk102-r2-cors-targets\n",
    ]) {
      await writeEnvironment(root, source);
      expect(() => loadSk102EnvironmentFile(root, {})).toThrow("SK102_ENV_FILE_INVALID");
    }
  });

  it("rejects migration-owner credentials from the browser runtime file", async () => {
    const root = await temporaryRoot();
    for (const source of [
      "SK102_DATABASE_MIGRATION_URL=postgresql://owner:secret@isolated.invalid/db\n",
      "SK102_DATABASE_APPROVED_MIGRATION_CREDENTIAL_FINGERPRINT=sha256:placeholder\n",
    ]) {
      await writeEnvironment(root, source);
      expect(() => loadSk102EnvironmentFile(root, {})).toThrow("SK102_ENV_FILE_INVALID");
    }
  });

  it("does not partially mutate the environment when a later value conflicts", async () => {
    const root = await temporaryRoot();
    await writeEnvironment(
      root,
      "SK102_E2E_MODE=isolated_nonproduction\nSK102_SLOT=sk102-browser\n",
    );
    const environment: Record<string, string | undefined> = { SK102_SLOT: "different" };

    expect(() => loadSk102EnvironmentFile(root, environment)).toThrow("SK102_ENV_FILE_CONFLICT");
    expect(environment).toEqual({ SK102_SLOT: "different" });
  });

  it("rejects a symlink instead of following secret material outside the repository", async () => {
    const root = await temporaryRoot();
    const target = sk102EnvironmentFilePath(root);
    const outside = join(root, "outside.env");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(outside, "SK102_SLOT=sk102-browser\n", { mode: 0o600 });
    await symlink(outside, target);

    expect(() => loadSk102EnvironmentFile(root, {})).toThrow("SK102_ENV_FILE_INVALID");
  });
});
