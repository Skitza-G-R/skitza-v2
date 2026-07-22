import { lstatSync, realpathSync } from "node:fs";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const AUTH_RELATIVE_DIRECTORY = join("apps", "web", "playwright", ".auth");
const EVIDENCE_RELATIVE_DIRECTORY = join("apps", "web", "browser-evidence");
const TEST_RESULTS_RELATIVE_DIRECTORY = join("apps", "web", "test-results");

function unsafe(): never {
  throw new Error("SK102_LOCAL_PATH_UNSAFE");
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function confinedChild(
  repositoryRoot: string,
  candidate: string,
): {
  root: string;
  target: string;
  child: string;
} {
  const root = resolve(repositoryRoot);
  const target = resolve(candidate);
  const child = relative(root, target);
  if (!child || child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child)) unsafe();
  return { root, target, child };
}

/**
 * Proves every existing path component is a real directory/file below the
 * supplied repository root. Missing tail components are allowed so callers
 * can safely create them after this check, then recheck before use.
 */
export async function assertSk102ConfinedLocalPath(
  repositoryRoot: string,
  candidate: string,
): Promise<string> {
  const { root, target, child } = confinedChild(repositoryRoot, candidate);
  let rootStats: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStats = await lstat(root);
  } catch {
    unsafe();
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) unsafe();

  const physicalRoot = await realpath(root).catch(unsafe);
  let current = root;
  const components = child.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) unsafe();
    current = join(current, component);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (isMissing(error)) return target;
      unsafe();
    }
    if (stats.isSymbolicLink()) unsafe();
    if (index < components.length - 1 && !stats.isDirectory()) unsafe();
    const physicalCurrent = await realpath(current).catch(unsafe);
    const physicalChild = relative(physicalRoot, physicalCurrent);
    if (
      physicalChild === ".." ||
      physicalChild.startsWith(`..${sep}`) ||
      isAbsolute(physicalChild)
    ) {
      unsafe();
    }
  }
  return target;
}

export function assertSk102ConfinedLocalPathSync(
  repositoryRoot: string,
  candidate: string,
): string {
  const { root, target, child } = confinedChild(repositoryRoot, candidate);
  let rootStats: ReturnType<typeof lstatSync>;
  try {
    rootStats = lstatSync(root);
  } catch {
    unsafe();
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) unsafe();

  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(root);
  } catch {
    unsafe();
  }
  let current = root;
  const components = child.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) unsafe();
    current = join(current, component);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (isMissing(error)) return target;
      unsafe();
    }
    if (stats.isSymbolicLink()) unsafe();
    if (index < components.length - 1 && !stats.isDirectory()) unsafe();
    let physicalCurrent: string;
    try {
      physicalCurrent = realpathSync(current);
    } catch {
      unsafe();
    }
    const physicalChild = relative(physicalRoot, physicalCurrent);
    if (
      physicalChild === ".." ||
      physicalChild.startsWith(`..${sep}`) ||
      isAbsolute(physicalChild)
    ) {
      unsafe();
    }
  }
  return target;
}

export async function prepareSk102ConfinedDirectory(
  repositoryRoot: string,
  candidate: string,
): Promise<string> {
  const target = await assertSk102ConfinedLocalPath(repositoryRoot, candidate);
  await mkdir(target, { recursive: true, mode: 0o700 });
  return assertSk102ConfinedLocalPath(repositoryRoot, target);
}

export function sk102AuthStateDirectory(repositoryRoot: string): string {
  const root = resolve(repositoryRoot);
  const target = resolve(root, AUTH_RELATIVE_DIRECTORY);
  if (relative(root, target) !== AUTH_RELATIVE_DIRECTORY) {
    throw new Error("SK102_AUTH_STATE_PATH_INVALID");
  }
  return target;
}

export function sk102BrowserEvidenceDirectory(repositoryRoot: string): string {
  const root = resolve(repositoryRoot);
  const target = resolve(root, EVIDENCE_RELATIVE_DIRECTORY);
  if (relative(root, target) !== EVIDENCE_RELATIVE_DIRECTORY) unsafe();
  return target;
}

export function sk102BrowserTestResultsDirectory(repositoryRoot: string): string {
  const root = resolve(repositoryRoot);
  const target = resolve(root, TEST_RESULTS_RELATIVE_DIRECTORY);
  if (relative(root, target) !== TEST_RESULTS_RELATIVE_DIRECTORY) unsafe();
  return target;
}

export async function removeSk102AuthState(repositoryRoot: string): Promise<void> {
  const target = sk102AuthStateDirectory(repositoryRoot);
  await assertSk102ConfinedLocalPath(repositoryRoot, target);
  await rm(target, { recursive: true, force: true });
}

export async function removeSk102BrowserEvidence(repositoryRoot: string): Promise<void> {
  const target = sk102BrowserEvidenceDirectory(repositoryRoot);
  await assertSk102ConfinedLocalPath(repositoryRoot, target);
  await rm(target, { recursive: true, force: true });
}

export async function removeSk102BrowserTestResults(repositoryRoot: string): Promise<void> {
  const target = sk102BrowserTestResultsDirectory(repositoryRoot);
  await assertSk102ConfinedLocalPath(repositoryRoot, target);
  await rm(target, { recursive: true, force: true });
}
