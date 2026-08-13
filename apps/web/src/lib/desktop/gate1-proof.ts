import {
  DESKTOP_CAPABILITIES,
  desktopBridgeHasCapability,
  detectDesktopBridge,
  type DesktopGate1Sample,
} from "./bridge";

export type Gate1Journey = DesktopGate1Sample["journey"];
export type Gate1Phase = DesktopGate1Sample["phase"];

export interface Gate1ProofArm {
  journey: Gate1Journey;
  phase: Gate1Phase;
  run: number;
}

export interface Gate1ProofSnapshot {
  armed: Gate1ProofArm | null;
  samples: readonly DesktopGate1Sample[];
  version: 1;
}

export interface Gate1ProofController {
  arm(input: Gate1ProofArm): boolean;
  beginReopen(): void;
  reset(): void;
  snapshot(): Gate1ProofSnapshot;
}

interface ActiveGate1Run extends Gate1ProofArm {
  audioSource: "recent-cache" | "network" | null;
  explicitMediaNetworkRequests: number;
  startedAt: number;
}

interface Gate1Timing {
  clearMarks(name: string): void;
  clearMeasures(name: string): void;
  getEntriesByType(type: string): PerformanceEntry[];
  mark(name: string): void;
  measure(name: string, startMark: string, endMark: string): void;
  now(): number;
}

interface Gate1ProofRecorderOptions {
  buildId: string;
  enabled: boolean;
  origin: string;
  platform: "macos" | "windows" | "unknown";
  report?: (sample: DesktopGate1Sample) => void;
  runtime: "chrome" | "desktop";
  screenFailureEvidence?: (journey: Gate1Journey) => boolean;
  timing: Gate1Timing;
}

interface Gate1ProofRecorder extends Gate1ProofController {
  audioNetworkRequest(): void;
  audioPlaying(): void;
  audioSource(source: "recent-cache" | "network"): void;
  meaningfulScreen(input: {
    href: string;
    meaningful: boolean;
    source: "cache" | "resume" | "server";
  }): void;
  start(journey: Gate1Journey, startedAt?: number): void;
}

const JOURNEY_HREF: Partial<Record<Gate1Journey, string>> = {
  "reopen-today": "/dashboard",
  "safe-clients-projects": "/dashboard/clients-projects",
};

const GATE1_RUN_TIMEOUT_MS = 10_000;

const PROOF_ENABLED =
  process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SKITZA_GATE1_PROOF === "1";
const PROOF_BUILD_ID = process.env.NEXT_PUBLIC_SKITZA_BUILD_ID?.trim() || "unconfigured";

declare global {
  interface Window {
    __SKITZA_GATE1_PROOF__?: Gate1ProofController;
  }
}

function validArm(input: Gate1ProofArm): boolean {
  if (!["reopen-today", "safe-clients-projects", "cached-recent-audio"].includes(input.journey)) {
    return false;
  }
  return input.phase === "warmup"
    ? input.run === 0
    : Number.isSafeInteger(input.run) &&
        input.run >= 1 &&
        input.run <= 5;
}

function markName(journey: Gate1Journey, edge: "start" | "end"): string {
  return `skitza:gate1:${journey}:${edge}`;
}

function measureName(journey: Gate1Journey): string {
  return `skitza:gate1:${journey}:duration`;
}

function isPrivateMediaResource(name: string): boolean {
  try {
    const url = new URL(name);
    return /^\/api\/audio\/stream\/[0-9a-f-]+$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function createGate1ProofRecorder({
  buildId,
  enabled,
  origin,
  platform,
  report,
  runtime,
  screenFailureEvidence,
  timing,
}: Gate1ProofRecorderOptions): Gate1ProofRecorder {
  let armed: Gate1ProofArm | null = null;
  let active: ActiveGate1Run | null = null;
  let samples: DesktopGate1Sample[] = [];
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const finish = (
    source: DesktopGate1Sample["source"],
    evidence: {
      blankOrFullscreenSpinner: boolean;
      meaningful: boolean;
    },
  ): DesktopGate1Sample | null => {
    const run = active;
    if (!enabled || !run) return null;
    const endedAt = timing.now();
    const observedMediaRequests = timing
      .getEntriesByType("resource")
      .filter(
        (entry) => entry.startTime >= run.startedAt && isPrivateMediaResource(entry.name),
      ).length;
    const mediaDownloadRequests =
      run.journey === "cached-recent-audio"
        ? Math.max(observedMediaRequests, run.explicitMediaNetworkRequests)
        : 0;
    const detection = detectDesktopBridge();
    const sample: DesktopGate1Sample = {
      blankOrFullscreenSpinner: evidence.blankOrFullscreenSpinner,
      bridgeProtocolVersion:
        detection.kind === "supported" ? detection.bridge.protocolVersion : null,
      buildId,
      durationMs: Math.max(0, endedAt - run.startedAt),
      journey: run.journey,
      meaningful: evidence.meaningful,
      mediaDownloadRequests,
      origin,
      phase: run.phase,
      platform,
      run: run.run,
      runtime,
      source,
    };
    const endMark = markName(run.journey, "end");
    try {
      timing.mark(endMark);
      timing.measure(measureName(run.journey), markName(run.journey, "start"), endMark);
    } catch {
      // In-app proof evidence must never block the measured interaction.
    }
    samples = [...samples, sample];
    if (timeout) clearTimeout(timeout);
    timeout = null;
    active = null;
    armed = null;
    report?.(sample);
    return sample;
  };

  const start = (journey: Gate1Journey, nativeStartedAt?: number) => {
    if (!enabled || active || armed?.journey !== journey) return;
    const startMark = markName(journey, "start");
    try {
      timing.clearMeasures(measureName(journey));
      timing.clearMarks(startMark);
      timing.clearMarks(markName(journey, "end"));
      timing.mark(startMark);
    } catch {
      // The monotonic clock still records the run when User Timing is absent.
    }
    active = {
      ...armed,
      audioSource: null,
      explicitMediaNetworkRequests: 0,
      startedAt:
        typeof nativeStartedAt === "number" &&
        Number.isFinite(nativeStartedAt) &&
        nativeStartedAt >= 0 &&
        nativeStartedAt <= timing.now()
          ? nativeStartedAt
          : timing.now(),
    };
    timeout = setTimeout(() => {
      finish(null, {
        blankOrFullscreenSpinner:
          journey === "reopen-today" || journey === "safe-clients-projects"
            ? (screenFailureEvidence?.(journey) ?? true)
            : false,
        meaningful: false,
      });
    }, GATE1_RUN_TIMEOUT_MS);
  };

  return {
    arm(input) {
      if (!enabled || active || !validArm(input)) return false;
      const duplicate = samples.some(
        (sample) =>
          sample.journey === input.journey &&
          sample.phase === input.phase &&
          sample.run === input.run,
      );
      if (duplicate) return false;
      armed = { ...input };
      return true;
    },
    beginReopen() {
      start("reopen-today");
      recordGate1CurrentScreenAfterReveal();
    },
    reset() {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      armed = null;
      active = null;
      samples = [];
    },
    snapshot() {
      return {
        armed: armed ? { ...armed } : null,
        samples: samples.map((sample) => ({ ...sample })),
        version: 1,
      };
    },
    start,
    meaningfulScreen({ href, meaningful, source }) {
      if (!meaningful || !active) return;
      const expectedHref = JOURNEY_HREF[active.journey];
      if (!expectedHref || href !== expectedHref) return;
      finish(source === "cache" ? "safe-view" : source, {
        blankOrFullscreenSpinner: false,
        meaningful: true,
      });
    },
    audioSource(source) {
      if (active?.journey === "cached-recent-audio") {
        active.audioSource = source;
      }
    },
    audioNetworkRequest() {
      if (active?.journey === "cached-recent-audio") {
        active.explicitMediaNetworkRequests += 1;
      }
    },
    audioPlaying() {
      if (active?.journey !== "cached-recent-audio" || !active.audioSource) {
        return;
      }
      finish(active.audioSource, {
        blankOrFullscreenSpinner: false,
        meaningful: true,
      });
    },
  };
}

let browserRecorder: Gate1ProofRecorder | null = null;

function browserPlatform(): "macos" | "windows" | "unknown" {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) {
    return "macos";
  }
  return "unknown";
}

function getBrowserRecorder(): Gate1ProofRecorder | null {
  if (typeof window === "undefined" || !PROOF_ENABLED) return null;
  if (browserRecorder) return browserRecorder;
  const detection = detectDesktopBridge();
  const runtime = detection.kind === "supported" ? "desktop" : "chrome";
  const report = desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.performanceProof)
    ? (sample: DesktopGate1Sample) => {
        try {
          void detection.bridge.recordGate1Sample?.(sample);
        } catch {
          // Native recording is optional; the in-memory snapshot remains.
        }
      }
    : undefined;
  browserRecorder = createGate1ProofRecorder({
    buildId: PROOF_BUILD_ID,
    enabled: true,
    origin: window.location.origin,
    platform: browserPlatform(),
    ...(report ? { report } : {}),
    runtime,
    screenFailureEvidence: gate1BlankOrFullscreenSpinnerEvidence,
    timing: performance,
  });
  window.__SKITZA_GATE1_PROOF__ = browserRecorder;
  return browserRecorder;
}

export function startGate1Journey(journey: Gate1Journey): void {
  getBrowserRecorder()?.start(journey);
}

export function startGate1JourneyAt(journey: Gate1Journey, startedAt: number): void {
  getBrowserRecorder()?.start(journey, startedAt);
}

export function recordGate1MeaningfulScreen(input: {
  href: string;
  meaningful: boolean;
  source: "cache" | "resume" | "server";
}): void {
  getBrowserRecorder()?.meaningfulScreen(input);
}

function hasPaintedBox(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number.parseFloat(style.opacity || "1") === 0
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const pointX = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
  const pointY = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
  const paintedAtPoint = document.elementFromPoint(pointX, pointY);
  return !paintedAtPoint || element.contains(paintedAtPoint) || paintedAtPoint.contains(element);
}

function hasFullscreenBlockingSurface(root: HTMLElement): boolean {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const candidates = document.querySelectorAll<HTMLElement>(
    '[data-runtime-screen-source="scaffold"], [data-gate1-fullscreen-spinner], [aria-busy="true"], [role="progressbar"]',
  );
  return [...candidates].some((candidate) => {
    if (candidate === root || !hasPaintedBox(candidate)) return false;
    const rect = candidate.getBoundingClientRect();
    return (rect.width * rect.height) / viewportArea >= 0.7;
  });
}

function gate1ScreenRoot(journey: Gate1Journey): HTMLElement | null {
  if (journey === "reopen-today") {
    return document.querySelector<HTMLElement>(
      '[data-runtime-screen-source="cache"], [data-runtime-screen-source="resume"], [data-gate1-meaningful-screen="today"]',
    );
  }
  if (journey === "safe-clients-projects") {
    return document.querySelector<HTMLElement>(
      '[data-runtime-screen-source="cache"], [data-gate1-meaningful-screen="clients-projects"]',
    );
  }
  return null;
}

function gate1BlankOrFullscreenSpinnerEvidence(journey: Gate1Journey): boolean {
  const root = gate1ScreenRoot(journey);
  return !root || !hasPaintedBox(root) || hasFullscreenBlockingSurface(root);
}

export function hasGate1MeaningfulPaint(root: HTMLElement | null): boolean {
  const title = root?.querySelector<HTMLElement>("[data-gate1-meaningful-title], h1");
  const item = root?.querySelector<HTMLElement>(
    "[data-gate1-meaningful-item], dd, [role='listitem'], li, tbody tr",
  );
  return Boolean(
    root &&
    title?.textContent.trim() &&
    item?.textContent.trim() &&
    hasPaintedBox(root) &&
    hasPaintedBox(title) &&
    hasPaintedBox(item) &&
    !hasFullscreenBlockingSurface(root),
  );
}

export function recordGate1MeaningfulPaint(input: {
  href: string;
  root: HTMLElement | null;
  source: "cache" | "resume" | "server";
}): void {
  recordGate1MeaningfulScreen({
    href: input.href,
    meaningful: hasGate1MeaningfulPaint(input.root),
    source: input.source,
  });
}

export function recordGate1CurrentScreenAfterReveal(): void {
  if (typeof document === "undefined" || window.location.pathname !== "/dashboard") {
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const cached = document.querySelector<HTMLElement>(
        '[data-runtime-screen-source="cache"], [data-runtime-screen-source="resume"]',
      );
      const live = document.querySelector<HTMLElement>('[data-gate1-meaningful-screen="today"]');
      const root = cached ?? live;
      recordGate1MeaningfulPaint({
        href: "/dashboard",
        root,
        source:
          cached?.dataset.runtimeScreenSource === "resume" ? "resume" : cached ? "cache" : "server",
      });
    });
  });
}

export function recordGate1AudioSource(source: "recent-cache" | "network"): void {
  getBrowserRecorder()?.audioSource(source);
}

export function recordGate1AudioNetworkRequest(): void {
  getBrowserRecorder()?.audioNetworkRequest();
}

export function recordGate1AudioPlaying(): void {
  getBrowserRecorder()?.audioPlaying();
}

export function installGate1ProofController(): void {
  void getBrowserRecorder();
}
