import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createDb } from "@skitza/db";

import {
  ACCOUNT_CLOSURE_FORBIDDEN_AMBIENT_DATABASE_ENV,
  ACCOUNT_CLOSURE_LIVE_CONFIRMATION,
  ACCOUNT_CLOSURE_OPERATOR_ENV,
  readAccountClosureOperatorEnvironment,
} from "../account-closure/environment";
import { preflightAccountClosureTarget } from "../account-closure/target";

import {
  executeClerkIdentityRelink,
  type ClerkIdentityRelinkMode,
  type SafeClerkIdentityRelinkResult,
} from "./command";
import { ClerkIdentityRelinkError, parseClerkIdentityRelinkManifest } from "./manifest";
import { createClerkRelinkProviderReader } from "./provider";
import { createClerkIdentityRelinkRepository } from "./repository";

const MODES = new Set<ClerkIdentityRelinkMode>([
  "inspect",
  "rehearse",
  "stage",
  "activate",
  "reject-stage",
]);
const MAX_MANIFEST_BYTES = 64 * 1024;
const RELINK_LIVE_CONFIRMATION = "approved-live-clerk-identity-relink-sk229";

type Environment = Readonly<Record<string, string | undefined>>;

export type SafeClerkIdentityRelinkCliEvent =
  | Readonly<{ ok: true; result: SafeClerkIdentityRelinkResult }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code:
          | ClerkIdentityRelinkError["code"]
          | "RELINK_CONFIGURATION_INVALID"
          | "RELINK_UNEXPECTED_FAILURE";
        message: string;
      }>;
    }>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error("RELINK_CONFIGURATION_INVALID");
  return value;
}

function safeError(error: unknown): SafeClerkIdentityRelinkCliEvent {
  if (error instanceof ClerkIdentityRelinkError) {
    return {
      ok: false,
      error: { code: error.code, message: "Clerk identity relink stopped safely." },
    };
  }
  if (error instanceof Error && error.message === "RELINK_CONFIGURATION_INVALID") {
    return {
      ok: false,
      error: {
        code: "RELINK_CONFIGURATION_INVALID",
        message: "Clerk identity relink configuration is missing or invalid.",
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "RELINK_UNEXPECTED_FAILURE",
      message: "Clerk identity relink failed safely.",
    },
  };
}

export function parseClerkIdentityRelinkMode(
  arguments_: readonly string[],
): ClerkIdentityRelinkMode | null {
  if (arguments_.length !== 1) return null;
  const value = arguments_[0];
  return typeof value === "string" && MODES.has(value as ClerkIdentityRelinkMode)
    ? (value as ClerkIdentityRelinkMode)
    : null;
}

export async function runClerkIdentityRelinkCli(
  arguments_: readonly string[],
  input: Readonly<{
    environment: Environment;
    readManifest: (path: string) => Promise<string>;
    emit: (event: SafeClerkIdentityRelinkCliEvent) => void;
  }>,
): Promise<number> {
  const mode = parseClerkIdentityRelinkMode(arguments_);
  if (!mode) {
    input.emit(safeError(new Error("RELINK_CONFIGURATION_INVALID")));
    return 2;
  }

  try {
    // Deliberately named, task-specific variables prevent accidental use of an
    // ambient app database or Clerk secret.
    const databaseUrl = required(input.environment, "SK229_RELINK_DATABASE_URL");
    const targetClass = required(input.environment, "SK229_RELINK_TARGET_CLASS");
    const liveConfirmation = input.environment.SK229_RELINK_LIVE_CONFIRMATION?.trim();
    if (
      (targetClass === "live" && liveConfirmation !== RELINK_LIVE_CONFIRMATION) ||
      (targetClass === "test" && liveConfirmation !== undefined) ||
      (targetClass !== "live" && targetClass !== "test")
    ) {
      throw new Error("RELINK_CONFIGURATION_INVALID");
    }
    const targetEnvironment = readAccountClosureOperatorEnvironment({
      ...Object.fromEntries(
        ACCOUNT_CLOSURE_FORBIDDEN_AMBIENT_DATABASE_ENV.map((name) => [
          name,
          input.environment[name],
        ]),
      ),
      [ACCOUNT_CLOSURE_OPERATOR_ENV.actorClerkUserId]: "user_sk229_relink_operator",
      [ACCOUNT_CLOSURE_OPERATOR_ENV.clerkInstanceId]: "ins_sk229_relink_target_preflight",
      [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]: databaseUrl,
      [ACCOUNT_CLOSURE_OPERATOR_ENV.targetClass]: targetClass,
      ...(targetClass === "live"
        ? {
            [ACCOUNT_CLOSURE_OPERATOR_ENV.liveConfirmation]: ACCOUNT_CLOSURE_LIVE_CONFIRMATION,
          }
        : {}),
    });
    // Same provider-owned Neon project/branch/endpoint/database fingerprint as
    // account closure and SK104. No file, Clerk, or DB mutation occurs first.
    await preflightAccountClosureTarget(targetEnvironment);
    const manifestPath = required(input.environment, "SK229_RELINK_MANIFEST_PATH");
    const sourceSecret = required(input.environment, "SK229_RELINK_SOURCE_CLERK_SECRET_KEY");
    const targetSecret = required(input.environment, "SK229_RELINK_TARGET_CLERK_SECRET_KEY");
    const cutoff = required(input.environment, "PRODUCER_INVITATION_CUTOFF");
    const serialized = await input.readManifest(manifestPath);
    if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) {
      throw new Error("RELINK_CONFIGURATION_INVALID");
    }
    const manifest = parseClerkIdentityRelinkManifest(JSON.parse(serialized) as unknown);
    const approval = input.environment.SK229_RELINK_APPROVAL;
    const result = await executeClerkIdentityRelink(mode, {
      ...(approval ? { approval } : {}),
      configuredProducerInvitationCutoff: cutoff,
      manifest,
      providers: {
        source: createClerkRelinkProviderReader(sourceSecret),
        target: createClerkRelinkProviderReader(targetSecret),
      },
      repository: createClerkIdentityRelinkRepository(createDb(targetEnvironment.databaseUrl)),
    });
    input.emit({ ok: true, result });
    return 0;
  } catch (error) {
    input.emit(safeError(error));
    return 1;
  }
}

export function runDefaultClerkIdentityRelinkCli(
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<number> {
  return runClerkIdentityRelinkCli(arguments_, {
    environment: process.env,
    readManifest: (path) => readFile(path, "utf8"),
    emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
}

const isMain =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  runDefaultClerkIdentityRelinkCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify(safeError(undefined))}\n`);
      process.exitCode = 1;
    });
}
