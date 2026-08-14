import { pathToFileURL } from "node:url";

import {
  createClerkIdentityBindingRepository,
  createDb,
  resolveActiveProviderClerkUserId,
} from "@skitza/db";

import { AccountClosureError, type AccountClosureStore } from "~/server/identity/account-closure";
import { createAccountClosureAutomation } from "~/server/identity/account-closure-automation";
import { createAccountClosureStore } from "~/server/identity/account-closure-repository";

import {
  ACCOUNT_CLOSURE_MAX_STDIN_BYTES,
  executeAccountClosureOperatorCommand,
  parseAccountClosureOperatorCommand,
  type AccountClosureOperatorDependencies,
  type SafeAccountClosureCommandResult,
} from "./command";
import {
  AccountClosureOperatorSafetyError,
  readAccountClosureOperatorEnvironment,
  type AccountClosureOperatorEnvironment,
  type AccountClosureOperatorErrorCode,
  type AccountClosureTargetClass,
} from "./environment";
import { preflightAccountClosureTarget } from "./target";

type AccountClosureDomainErrorCode = AccountClosureError["code"];

export type SafeAccountClosureCliError = Readonly<{
  code: AccountClosureOperatorErrorCode | AccountClosureDomainErrorCode;
  message: string;
}>;

export type SafeAccountClosureCliEvent =
  | Readonly<{
      ok: true;
      targetClass: AccountClosureTargetClass;
      result: SafeAccountClosureCommandResult;
    }>
  | Readonly<{ ok: false; error: SafeAccountClosureCliError }>;

export interface AccountClosureCliReporter {
  emit(event: SafeAccountClosureCliEvent): void;
}

type EnvironmentMap = Readonly<Record<string, string | undefined>>;

export type AccountClosureCliDependencies = Readonly<{
  environment: EnvironmentMap;
  readStdin(): Promise<string>;
  preflightTarget(environment: AccountClosureOperatorEnvironment): Promise<void>;
  createDependencies(
    environment: AccountClosureOperatorEnvironment,
  ): Promise<AccountClosureOperatorDependencies> | AccountClosureOperatorDependencies;
  reporter: AccountClosureCliReporter;
}>;

const SAFE_DOMAIN_MESSAGES: Readonly<Record<AccountClosureDomainErrorCode, string>> = {
  account_closure_conflict: "The closure request conflicts with its recorded state.",
  account_closure_invalid_input: "The closure request input is invalid.",
  account_closure_legal_hold: "The closure request is under legal hold.",
  account_closure_not_found: "The closure request was not found.",
  account_closure_not_verified: "The closure request has not been verified.",
  account_closure_task_state: "The closure task is not in the required state.",
};

function safeError(error: unknown): SafeAccountClosureCliError {
  if (error instanceof AccountClosureOperatorSafetyError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof AccountClosureError) {
    return { code: error.code, message: SAFE_DOMAIN_MESSAGES[error.code] };
  }
  return {
    code: "ACCOUNT_CLOSURE_UNEXPECTED_FAILURE",
    message: "The account-closure command failed safely.",
  };
}

export function createAccountClosureJsonReporter(
  write: (line: string) => void,
): AccountClosureCliReporter {
  return {
    emit(event) {
      write(JSON.stringify(event));
    },
  };
}

/** No CLI argument is accepted: identity and email may enter only through JSON stdin. */
export async function runAccountClosureOperatorCli(
  arguments_: readonly string[],
  dependencies: AccountClosureCliDependencies,
): Promise<number> {
  if (arguments_.length !== 0) {
    dependencies.reporter.emit({
      ok: false,
      error: safeError(new AccountClosureOperatorSafetyError("ACCOUNT_CLOSURE_COMMAND_INVALID")),
    });
    return 2;
  }

  try {
    const environment = readAccountClosureOperatorEnvironment(dependencies.environment);
    await dependencies.preflightTarget(environment);
    const serializedCommand = await dependencies.readStdin();
    const command = parseAccountClosureOperatorCommand(serializedCommand);
    const operatorDependencies = await dependencies.createDependencies(environment);
    const result = await executeAccountClosureOperatorCommand(
      command,
      environment.actorClerkUserId,
      operatorDependencies,
    );
    dependencies.reporter.emit({ ok: true, targetClass: environment.targetClass, result });
    return 0;
  } catch (error) {
    dependencies.reporter.emit({ ok: false, error: safeError(error) });
    return 1;
  }
}

export async function readAccountClosureJsonStdin(
  input: AsyncIterable<string | Uint8Array>,
): Promise<string> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of input) {
    const value = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    byteLength += value.byteLength;
    if (byteLength > ACCOUNT_CLOSURE_MAX_STDIN_BYTES) {
      throw new AccountClosureOperatorSafetyError("ACCOUNT_CLOSURE_INPUT_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

function defaultDependencies(
  environment: AccountClosureOperatorEnvironment,
): AccountClosureOperatorDependencies {
  const db = createDb(environment.databaseUrl);
  return {
    store: createAccountClosureStore(db),
    automation: createAccountClosureAutomation(db),
    currentClerkInstanceId: environment.clerkInstanceId,
    resolveProviderClerkUserId: (input) =>
      resolveActiveProviderClerkUserId(createClerkIdentityBindingRepository(db), input),
  };
}

export function runDefaultAccountClosureOperatorCli(
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<number> {
  return runAccountClosureOperatorCli(arguments_, {
    environment: process.env,
    preflightTarget: preflightAccountClosureTarget,
    readStdin: () => readAccountClosureJsonStdin(process.stdin),
    createDependencies: defaultDependencies,
    reporter: createAccountClosureJsonReporter((line) => {
      process.stdout.write(`${line}\n`);
    }),
  });
}

const isMain =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  runDefaultAccountClosureOperatorCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          error: safeError(undefined),
        } satisfies SafeAccountClosureCliEvent)}\n`,
      );
      process.exitCode = 1;
    });
}

export type { AccountClosureStore };
