import path from "node:path";

import { REPOSITORY_ROOT } from "./manifest";

export type AuthRole = "producer" | "artist";

export const AUTH_DIRECTORY = path.resolve(REPOSITORY_ROOT, "apps/web/playwright/.auth");

export function authStatePath(role: AuthRole): string {
  return path.join(AUTH_DIRECTORY, `${role}.json`);
}
