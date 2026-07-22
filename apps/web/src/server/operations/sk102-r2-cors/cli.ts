import { loadSk102EnvironmentFile } from "../sk102-environment-file";
import { SK102_REPOSITORY_ROOT } from "../sk102-fixtures/contract";

async function main(): Promise<void> {
  loadSk102EnvironmentFile(SK102_REPOSITORY_ROOT);
  if (process.argv.slice(2).length !== 0) {
    throw new Error("SK102_R2_CORS_ARGUMENT_INVALID");
  }
  const [{ approvedSk102Runtime }, { getR2 }, { applySk102R2Cors }] = await Promise.all([
    import("@skitza/db/sk102-runtime"),
    import("~/server/storage/r2"),
    import("./apply"),
  ]);
  const runtime = approvedSk102Runtime();
  if (!runtime) throw new Error("SK102_R2_CORS_RUNTIME_REQUIRED");
  await applySk102R2Cors({
    client: getR2(),
    runtime,
    mutationConfirmation: process.env.SK102_R2_CORS_MUTATION_CONFIRMATION,
    onApplied(role) {
      process.stdout.write(`SK102_R2_CORS_APPLIED role=${role}\n`);
    },
  });
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && error.message.startsWith("SK102_")
      ? error.message
      : "SK102_R2_CORS_APPLY_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
