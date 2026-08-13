import { describe, expect, it, vi } from "vitest";

import type {
  AccountClosureAutomation,
  AccountClosureRequestRecord,
  AccountClosureStore,
} from "~/server/identity/account-closure";

import {
  createAccountClosureJsonReporter,
  readAccountClosureJsonStdin,
  runAccountClosureOperatorCli,
  type SafeAccountClosureCliEvent,
} from "./cli";
import {
  ACCOUNT_CLOSURE_MAX_STDIN_BYTES,
  type AccountClosureOperatorDependencies,
} from "./command";
import { ACCOUNT_CLOSURE_OPERATOR_ENV } from "./environment";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST: AccountClosureRequestRecord = {
  id: REQUEST_ID,
  clerkUserId: "user_private_customer",
  status: "requested",
  closureStartedAt: null,
  accessRevokedAt: null,
  dueAt: null,
  legalHoldAt: null,
  legalHoldReleasedAt: null,
};

function operatorDependencies(
  getRequest: AccountClosureStore["getRequest"] = vi.fn(() => Promise.resolve(REQUEST)),
): AccountClosureOperatorDependencies {
  const store: AccountClosureStore = {
    openRequest: vi.fn(() => Promise.resolve(REQUEST)),
    verifyAndBeginClosure: vi.fn(() => Promise.resolve(REQUEST)),
    getRequest,
    getTasks: vi.fn(() => Promise.resolve([])),
    claimTask: vi.fn(() => Promise.resolve(null)),
    succeedTask: vi.fn(() => Promise.resolve()),
    markTaskNotApplicable: vi.fn(() => Promise.resolve()),
    blockTask: vi.fn(() => Promise.resolve()),
    recoverStaleTask: vi.fn(() => Promise.resolve()),
    resolveProducerId: vi.fn(() => Promise.resolve(null)),
    hasGoogleCalendarConnection: vi.fn(() => Promise.resolve(false)),
    deleteDeviceAndArtistPreferences: vi.fn(() => Promise.resolve()),
    revokePublicAndCapabilityLinks: vi.fn(() => Promise.resolve(true)),
    applyLegalHold: vi.fn(() => Promise.resolve()),
    releaseLegalHold: vi.fn(() => Promise.resolve()),
    completeIfReady: vi.fn(() => Promise.resolve(false)),
  };
  return {
    store,
    currentClerkInstanceId: "ins_production",
    resolveProviderClerkUserId: vi.fn(({ canonicalClerkUserId }) =>
      Promise.resolve(canonicalClerkUserId),
    ),
    automation: {
      disconnectGoogleCalendar: vi.fn(() => Promise.resolve()),
    } satisfies AccountClosureAutomation,
  };
}

function environment(): Record<string, string> {
  return {
    [ACCOUNT_CLOSURE_OPERATOR_ENV.actorClerkUserId]: "user_founder_operator",
    [ACCOUNT_CLOSURE_OPERATOR_ENV.clerkInstanceId]: "ins_production",
    [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]:
      "postgresql://operator:private-password@127.0.0.1:5432/skitza_test",
    [ACCOUNT_CLOSURE_OPERATOR_ENV.targetClass]: "test",
  };
}

describe("account-closure operator CLI", () => {
  it("rejects argv before reading stdin or creating database dependencies", async () => {
    const events: SafeAccountClosureCliEvent[] = [];
    const readStdin = vi.fn(() => Promise.resolve("{}"));
    const createDependencies = vi.fn(() => operatorDependencies());

    await expect(
      runAccountClosureOperatorCli(["private@example.com"], {
        environment: environment(),
        preflightTarget: vi.fn(() => Promise.resolve()),
        readStdin,
        createDependencies,
        reporter: { emit: (event) => events.push(event) },
      }),
    ).resolves.toBe(2);

    expect(readStdin).not.toHaveBeenCalled();
    expect(createDependencies).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        ok: false,
        error: {
          code: "ACCOUNT_CLOSURE_COMMAND_INVALID",
          message: "The account-closure command is invalid.",
        },
      },
    ]);
  });

  it("validates environment and target before reading any stdin", async () => {
    const readStdin = vi.fn(() =>
      Promise.resolve(JSON.stringify({ command: "inspect", requestId: REQUEST_ID })),
    );
    const preflightTarget = vi.fn(() => Promise.resolve());
    const createDependencies = vi.fn(() => operatorDependencies());
    const events: SafeAccountClosureCliEvent[] = [];

    await expect(
      runAccountClosureOperatorCli([], {
        environment: {
          ...environment(),
          DATABASE_URL: "postgresql://ambient:secret@production.invalid/skitza",
        },
        preflightTarget,
        readStdin,
        createDependencies,
        reporter: { emit: (event) => events.push(event) },
      }),
    ).resolves.toBe(1);
    expect(preflightTarget).not.toHaveBeenCalled();
    expect(readStdin).not.toHaveBeenCalled();
    expect(createDependencies).not.toHaveBeenCalled();

    const callOrder: string[] = [];
    await runAccountClosureOperatorCli([], {
      environment: environment(),
      preflightTarget: vi.fn(() => {
        callOrder.push("preflight");
        return Promise.resolve();
      }),
      readStdin: vi.fn(() => {
        callOrder.push("stdin");
        return Promise.resolve(JSON.stringify({ command: "inspect", requestId: REQUEST_ID }));
      }),
      createDependencies: () => operatorDependencies(),
      reporter: { emit: vi.fn() },
    });
    expect(callOrder).toEqual(["preflight", "stdin"]);
  });

  it("emits one sanitized JSON snapshot for a valid stdin command", async () => {
    const lines: string[] = [];
    const exitCode = await runAccountClosureOperatorCli([], {
      environment: environment(),
      preflightTarget: vi.fn(() => Promise.resolve()),
      readStdin: () =>
        Promise.resolve(JSON.stringify({ command: "inspect", requestId: REQUEST_ID })),
      createDependencies: () => operatorDependencies(),
      reporter: createAccountClosureJsonReporter((line) => lines.push(line)),
    });

    expect(exitCode).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      ok: true,
      targetClass: "test",
      result: { command: "inspect", snapshot: { request: { id: REQUEST_ID } } },
    });
    expect(lines[0]).not.toContain("user_private_customer");
    expect(lines[0]).not.toContain("private-password");
  });

  it("maps unexpected failures to static output without leaking the cause", async () => {
    const secret = "private-provider-or-database-error";
    const events: SafeAccountClosureCliEvent[] = [];
    const exitCode = await runAccountClosureOperatorCli([], {
      environment: environment(),
      preflightTarget: vi.fn(() => Promise.resolve()),
      readStdin: () =>
        Promise.resolve(JSON.stringify({ command: "inspect", requestId: REQUEST_ID })),
      createDependencies: () =>
        operatorDependencies(vi.fn(() => Promise.reject(new Error(secret)))),
      reporter: { emit: (event) => events.push(event) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(events).toEqual([
      {
        ok: false,
        error: {
          code: "ACCOUNT_CLOSURE_UNEXPECTED_FAILURE",
          message: "The account-closure command failed safely.",
        },
      },
    ]);
  });

  it("bounds streamed stdin before parsing", async () => {
    async function* oversizedInput() {
      await Promise.resolve();
      yield "x".repeat(ACCOUNT_CLOSURE_MAX_STDIN_BYTES);
      yield "x";
    }

    await expect(readAccountClosureJsonStdin(oversizedInput())).rejects.toMatchObject({
      code: "ACCOUNT_CLOSURE_INPUT_TOO_LARGE",
    });
  });
});
