import {
  SK102_BROWSER_RUN_ADMITTED_ENV,
  SK102_REPOSITORY_ROOT,
} from "../src/server/operations/sk102-fixtures/contract";
import { removeSk102AuthState } from "../src/server/operations/sk102-fixtures/local-state";

export default async function removeEphemeralAuthState(): Promise<void> {
  if (process.env[SK102_BROWSER_RUN_ADMITTED_ENV] !== "1") return;
  await removeSk102AuthState(SK102_REPOSITORY_ROOT);
}
