import { sk102DefaultManifestPath, parseSk102FixtureSlot, type Sk102FixtureSlot } from "./contract";

export type Sk102FixtureArguments = Readonly<{
  slot: Sk102FixtureSlot;
  manifestPath: string;
}>;

export function parseSk102FixtureArguments(argv: readonly string[]): Sk102FixtureArguments {
  let slotValue: string | null = null;
  let manifestPath: string | null = null;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !value.trim()) throw new Error("SK102_FIXTURE_ARGUMENT_INVALID");
    if (flag === "--slot" && slotValue === null) slotValue = value;
    else if (flag === "--manifest" && manifestPath === null) manifestPath = value;
    else throw new Error("SK102_FIXTURE_ARGUMENT_INVALID");
  }
  if (slotValue === null) throw new Error("SK102_FIXTURE_SLOT_REQUIRED");
  const slot = parseSk102FixtureSlot(slotValue);
  return { slot, manifestPath: manifestPath ?? sk102DefaultManifestPath(slot) };
}
