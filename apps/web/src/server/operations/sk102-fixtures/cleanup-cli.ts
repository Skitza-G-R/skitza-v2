import { parseSk102FixtureArguments } from "./cli-contract";
import { SK102_REPOSITORY_ROOT } from "./contract";
import { removeSk102AuthState } from "./local-state";
import { loadSk102EnvironmentFile } from "../sk102-environment-file";

async function main(): Promise<void> {
  loadSk102EnvironmentFile(SK102_REPOSITORY_ROOT);
  const input = parseSk102FixtureArguments(process.argv.slice(2));
  const { cleanupSk102FixtureWorkflow } = await import("./workflow");
  await cleanupSk102FixtureWorkflow(input.slot, input.manifestPath);
  await removeSk102AuthState(SK102_REPOSITORY_ROOT);
}

main().catch(() => {
  console.error("SK102_FIXTURE_CLEANUP_FAILED");
  process.exitCode = 1;
});
