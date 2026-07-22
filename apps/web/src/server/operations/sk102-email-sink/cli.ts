import { loadSk102EnvironmentFile } from "../sk102-environment-file";
import { SK102_REPOSITORY_ROOT } from "../sk102-fixtures/contract";

function argument(name: string): string {
  const positions = process.argv.reduce<number[]>((matches, value, index) => {
    if (value === name) matches.push(index);
    return matches;
  }, []);
  if (positions.length !== 1) throw new Error("SK102_EMAIL_ASSERT_ARGUMENT_INVALID");
  const position = positions[0];
  if (position === undefined) throw new Error("SK102_EMAIL_ASSERT_ARGUMENT_INVALID");
  const result = process.argv[position + 1];
  if (!result || result.startsWith("--")) {
    throw new Error("SK102_EMAIL_ASSERT_ARGUMENT_INVALID");
  }
  return result;
}

async function main(): Promise<void> {
  loadSk102EnvironmentFile(SK102_REPOSITORY_ROOT);
  const [{ approvedSk102Runtime, isSk102EmailKind }, { getR2 }, { countSk102EmailCaptures }] =
    await Promise.all([
      import("@skitza/db/sk102-runtime"),
      import("~/server/storage/r2"),
      import("./assert"),
    ]);
  const runtime = approvedSk102Runtime();
  if (!runtime) throw new Error("SK102_EMAIL_ASSERT_RUNTIME_REQUIRED");
  if (process.argv.slice(2).length !== 4) {
    throw new Error("SK102_EMAIL_ASSERT_ARGUMENT_INVALID");
  }
  const logicalSlot = argument("--slot");
  const kind = argument("--kind");
  if (!new Set(["desktop", "phone390", "phone360"]).has(logicalSlot) || !isSk102EmailKind(kind)) {
    throw new Error("SK102_EMAIL_ASSERT_ARGUMENT_INVALID");
  }

  const count = await countSk102EmailCaptures({
    client: getR2(),
    bucket: runtime.docsBucket,
    slot: runtime.slot,
    kind,
  });
  if (count < 1) throw new Error("SK102_EMAIL_CAPTURE_NOT_FOUND");
  process.stdout.write(
    `SK102_EMAIL_CAPTURE_FOUND slot=${logicalSlot} kind=${kind} count=${String(count)}\n`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && error.message.startsWith("SK102_")
      ? error.message
      : "SK102_EMAIL_ASSERT_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
