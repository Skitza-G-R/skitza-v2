import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { protectValue, sha256Digest } from "./canonical";
import * as databaseAdapter from "./database-adapter";
import * as runner from "./runner";
import type { ApprovedResetArtifact } from "./artifact";
import type { NeonPoolClientLike } from "./database-adapter";
import type { PrivateExecutionEnvelope } from "./private-envelope";

const HMAC_KEY = "provider-state-blocker-test-key-longer-than-32-bytes";

describe("SK-90 provider evidence action binding", () => {
  it("rebinds approved provider evidence to the fresh database action challenge", () => {
    const discoveryChallenge = protectValue(HMAC_KEY, "discovery-challenge");
    const actionChallenge = protectValue(HMAC_KEY, "database-reset-action-challenge");
    const artifact = {
      digest: sha256Digest("artifact"),
      manifestDigest: sha256Digest("manifest"),
      target: { policyDigest: sha256Digest("policy") },
      discoveryEvidence: { challengeToken: discoveryChallenge },
    } as unknown as ApprovedResetArtifact;
    const envelope = {
      providerReferences: [
        {
          sourceKind: "producer_stripe_account",
          ownerId: "00000000-0000-4000-8000-000000000001",
          providerValue: "test-provider",
          provider: "stripe",
          mode: "test",
          attested: true,
          chargeEnabled: false,
          externalCharge: false,
          liveSchedule: false,
        },
      ],
    } as unknown as PrivateExecutionEnvelope;
    const bindProviderResetEvidenceToAction = (
      runner as unknown as {
        bindProviderResetEvidenceToAction: (
          envelope: PrivateExecutionEnvelope,
          artifact: ApprovedResetArtifact,
          challengeToken: string,
        ) => readonly { challengeToken: string }[];
      }
    ).bindProviderResetEvidenceToAction;

    const evidence = bindProviderResetEvidenceToAction(envelope, artifact, actionChallenge);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.challengeToken).toBe(actionChallenge);
    expect(evidence[0]?.challengeToken).not.toBe(discoveryChallenge);
  });

  it("composes the current action challenge into the transaction evidence", () => {
    const source = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const execute = source.slice(
      source.indexOf("async #executeDatabaseReset"),
      source.indexOf("async interruptForRollback"),
    );

    expect(execute).toMatch(
      /providerEvidence:\s*bindProviderResetEvidenceToAction\([\s\S]*context\.challengeToken/,
    );
    expect(source).not.toContain("challengeToken: artifact.discoveryEvidence.challengeToken");
  });
});

describe("SK-90 exact database schema-state classification", () => {
  const baselineOnly = [
    "agreement_acceptances",
    "invoices",
    "store_purchase_intents",
    "stripe_customers",
  ];
  const postResetOnly = [
    "private_offers",
    "purchases",
    "purchase_installments",
    "purchase_payments",
  ];

  function clientWithRelations(present: ReadonlySet<string>): NeonPoolClientLike {
    return {
      query: ((_statement: string, parameters?: readonly unknown[]) => {
        const names = parameters?.[0];
        if (!Array.isArray(names)) throw new Error("expected exact relation inventory");
        return Promise.resolve({
          rows: names.map((relationName) => ({
            relation_name: String(relationName),
            relation: present.has(String(relationName)) ? `public.${String(relationName)}` : null,
          })),
        });
      }) as NeonPoolClientLike["query"],
      release: () => undefined,
    };
  }

  it("distinguishes the baseline, exact post-0027, and mixed schemas", async () => {
    const classifyDatabaseSchemaState = (
      databaseAdapter as unknown as {
        classifyDatabaseSchemaState: (
          client: NeonPoolClientLike,
        ) => Promise<"baseline" | "post_reset" | "mixed">;
      }
    ).classifyDatabaseSchemaState;

    await expect(
      classifyDatabaseSchemaState(clientWithRelations(new Set(baselineOnly))),
    ).resolves.toBe("baseline");
    await expect(
      classifyDatabaseSchemaState(clientWithRelations(new Set(postResetOnly))),
    ).resolves.toBe("post_reset");
    await expect(
      classifyDatabaseSchemaState(
        clientWithRelations(new Set([...baselineOnly.slice(1), ...postResetOnly])),
      ),
    ).resolves.toBe("mixed");
  });

  it("checks the schema phase before either verifier locks phase-specific tables", () => {
    const source = readFileSync(new URL("./database-adapter.ts", import.meta.url), "utf8");
    const restored = source.slice(
      source.indexOf("async verifyRestoredBaseline"),
      source.indexOf("async executeSecondRunNoOp"),
    );
    const postReset = source.slice(source.indexOf("async verifySecondRunNoOp"));

    expect(restored).toMatch(
      /assertDatabaseSchemaState\(client, "baseline"\)[\s\S]*SK90_REQUIRED_LOCK_TABLES/,
    );
    expect(postReset).toMatch(
      /assertDatabaseSchemaState\(client, "post_reset"\)[\s\S]*SK90_POST_RESET_LOCK_TABLES/,
    );
  });
});
