import { parseSk102FixtureArguments } from "./cli-contract";
import { SK102_REPOSITORY_ROOT } from "./contract";
import { loadSk102EnvironmentFile } from "../sk102-environment-file";

async function main(): Promise<void> {
  loadSk102EnvironmentFile(SK102_REPOSITORY_ROOT);
  const input = parseSk102FixtureArguments(process.argv.slice(2));
  const { seedSk102FixtureWorkflow } = await import("./workflow");
  await seedSk102FixtureWorkflow(input.slot, input.manifestPath);
}

main().catch(() => {
  console.error("SK102_FIXTURE_SEED_FAILED");
  process.exitCode = 1;
});
