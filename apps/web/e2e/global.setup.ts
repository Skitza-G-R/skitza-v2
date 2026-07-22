import {
  SK102_BROWSER_RUN_ADMITTED_ENV,
  SK102_BROWSER_RUN_LEASE_ENV,
  validateSk102BrowserRunLeaseToken,
} from "../src/server/operations/sk102-fixtures/contract";
import { assertSk102BrowserRunLeaseHeld } from "../src/server/operations/sk102-fixtures/workflow";

export default async function assertParentRunLease(): Promise<void> {
  if (process.env.SKITZA_E2E_LIST_ONLY === "1") return;
  const token = validateSk102BrowserRunLeaseToken(process.env[SK102_BROWSER_RUN_LEASE_ENV]);
  await assertSk102BrowserRunLeaseHeld(token);
  process.env[SK102_BROWSER_RUN_ADMITTED_ENV] = "1";
}
