"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  Pause,
  Play,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { BookingClient } from "~/app/(artist)/artist/book/booking-client";
import { ConfirmationHero } from "~/components/artist/sessions/confirmation-hero";
import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { ProducerHero } from "~/components/artist/store/producer-hero";
import { OverviewScreen } from "~/components/dashboard/overview/overview-screen";
import { PaymentProofReview } from "~/components/dashboard/payments/payment-proof-review";
import { SongsGrid } from "~/components/music/library-screen";
import { SongPage } from "~/components/music/song-page";
import {
  LiquidGlassBottomNav,
  type LiquidGlassBottomNavTab,
} from "~/components/nav/liquid-glass-bottom-nav";
import {
  RuntimeStatePreviewProvider,
  type RuntimeIdentity,
} from "~/components/runtime-state/runtime-state-provider";
import { captureProductEvent } from "~/lib/observability/product-events";

import {
  buildSimulation,
  SIMULATED_ARTIST,
  SIMULATION_IDS,
  SIMULATION_LABEL,
  type SimulationInput,
  type SimulationScene,
  type SimulationSceneId,
} from "./simulation-model";
import { Spotlight, type SpotlightCue } from "./spotlight";

// The onboarding reel (SK-310, replacing the SK-298 story): six screens,
// about 35 seconds, that show what a producer gets, not the steps to get it.
// Every screen after the hook is a live artist or producer screen rendered
// with the producer's REAL first product, cropped by a spotlight to the one
// element that matters, with the same chain on each: a ring where Noya
// taps, one change on the screen, one green check. It never calls a
// mutation: every control that would reach the server is on a preview seam,
// and every link is swallowed before it can navigate.

export interface SimulationLinks {
  bringActiveWork: string;
  dashboard: string;
  /** The producer's public join URL, shown in the hook and copied at the end. */
  publicUrl: string;
}

interface FirstArtistSimulationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: SimulationInput;
  links: SimulationLinks;
}

// The reused funnel screens position themselves `fixed` against the viewport.
// A transformed, isolated container turns that into "fixed inside the screen
// area", and the viewport-height token makes their 100dvh fill that area.
const SCREEN_AREA_STYLE = {
  "--sk-viewport-height": "100%",
  "--sk-viewport-offset-top": "0px",
  transform: "translateZ(0)",
  isolation: "isolate",
} as CSSProperties;

// The reused screens need an href for links the reel has no route for.
const INERT_HREF = "#simulation";

type ArtistTabId = "home" | "music" | "sessions" | "payments" | "store";

function artistTabs(active: ArtistTabId): LiquidGlassBottomNavTab<ArtistTabId>[] {
  return (["home", "music", "sessions", "payments", "store"] as const).map((id) => ({
    id,
    label: id === "home" ? "Home" : id.charAt(0).toUpperCase() + id.slice(1),
    href: INERT_HREF,
    icon: id === "sessions" ? "calendar" : id,
    active: active === id,
    prefetch: false,
  }));
}

// Runtime state is per-account private storage. The reel borrows the preview
// provider so the live screens can read a draft slot without ever touching
// the producer's own runtime state.
const SIMULATION_ARTIST_IDENTITY: RuntimeIdentity = {
  userId: "simulation-artist",
  role: "artist",
  contextId: SIMULATION_IDS.project,
};
const SIMULATION_PRODUCER_IDENTITY: RuntimeIdentity = {
  userId: "simulation-producer",
  role: "producer",
  contextId: SIMULATION_IDS.studio,
};

/**
 * One beat of a scene: when it starts, which screen state it shows, and
 * where the spotlight, ring, cover and check go. Selectors reach into the
 * live screens; the interaction test walks every one of them.
 */
interface ScenePhase {
  at: number;
  state: string;
  cue: SpotlightCue | null;
}

const PRODUCT = '[data-reel-focus="product"]';
const DAYS = '[data-reel-focus="booking"] .grid-cols-2';
const BOOKED = '[data-reel-focus="booked"]';
const LIST = '[data-reel-focus="list"]';
const NOTE = "[data-song-comment]";
const APPROVE = '[data-test="approve-final-version"]';
const APPROVED = '[data-test="artist-approved-status"]';
const PROOF = '[data-reel-focus="proof"]';
const DELIVERY = '[data-reel-focus="delivery"]';
const OVERVIEW = '[data-reel-focus="overview"]';

function SentChip() {
  return (
    <span className="inline-flex h-full w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-success)/0.14)] px-4 text-[13px] font-bold text-[rgb(var(--fg-success-text))]">
      <Check size={14} strokeWidth={3} aria-hidden />
      Booking request sent
    </span>
  );
}

const SENT_COVER = { selector: `${PRODUCT} button`, node: <SentChip /> };

// `buildScenes` always returns at least five scenes; this only keeps the
// hooks below unconditional for the type checker.
const FALLBACK_SCENE: SimulationScene = {
  id: "hook",
  side: "hook",
  step: 1,
  headline: "",
  line: "",
  durationMs: 0,
};

const PHASES: Record<SimulationSceneId, readonly ScenePhase[]> = {
  hook: [{ at: 0, state: "mess", cue: null }],
  link: [
    { at: 0, state: "store", cue: { focus: [PRODUCT] } },
    { at: 1500, state: "store", cue: { focus: [PRODUCT], ring: `${PRODUCT} button` } },
    { at: 2100, state: "sent", cue: { focus: [PRODUCT], cover: SENT_COVER } },
    { at: 2600, state: "sent", cue: { focus: [PRODUCT], cover: SENT_COVER, stamp: PRODUCT } },
  ],
  booking: [
    { at: 0, state: "days", cue: { focus: [DAYS] } },
    { at: 1400, state: "days", cue: { focus: [DAYS], ring: `${DAYS} > button` } },
    { at: 2300, state: "booked", cue: { focus: [BOOKED] } },
    { at: 3100, state: "booked", cue: { focus: [BOOKED], stamp: BOOKED } },
  ],
  library: [
    { at: 0, state: "list", cue: { focus: [LIST] } },
    { at: 1300, state: "list", cue: { focus: [LIST], ring: `${LIST} li` } },
    { at: 1700, state: "song", cue: { focus: [NOTE] } },
    { at: 4300, state: "song", cue: { focus: [APPROVE], ring: APPROVE } },
    { at: 4700, state: "approved", cue: { focus: [APPROVED] } },
    { at: 4900, state: "approved", cue: { focus: [APPROVED], stamp: APPROVED } },
  ],
  money: [
    { at: 0, state: "pending", cue: { focus: [PROOF] } },
    { at: 1500, state: "pending", cue: { focus: [PROOF], ring: `${PROOF} button`, ringText: /^Confirm/ } },
    { at: 1900, state: "confirmed", cue: { focus: [PROOF], stamp: PROOF } },
    { at: 2500, state: "delivery", cue: { focus: [DELIVERY], stamp: PROOF } },
    { at: 3100, state: "unlocked", cue: { focus: [DELIVERY], stamp: PROOF } },
  ],
  studio: [
    { at: 0, state: "overview", cue: { focus: [`${OVERVIEW} header`, '[aria-label="Studio pulse"]'] } },
    { at: 2100, state: "cta", cue: { focus: [`${OVERVIEW} header`, '[aria-label="Studio pulse"]'] } },
  ],
};

/**
 * Advances through a scene's phases on real time, pauses with the reel, and
 * calls back when the scene has run its length. Reduced motion lands on the
 * last phase at once and never auto-advances.
 */
function useSceneTimeline(input: {
  sceneKey: string;
  phases: readonly ScenePhase[];
  durationMs: number;
  paused: boolean;
  settled: boolean;
  autoplay: boolean;
  onDone: () => void;
}) {
  const { sceneKey, phases, durationMs, paused, settled, autoplay, onDone } = input;
  const [phaseIndex, setPhaseIndex] = useState(0);
  const sceneRef = useRef(sceneKey);
  const startedAt = useRef(0);
  const elapsedBefore = useRef(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (sceneRef.current !== sceneKey) {
      sceneRef.current = sceneKey;
      elapsedBefore.current = 0;
      setPhaseIndex(0);
    }
    if (settled) {
      setPhaseIndex(Math.max(0, phases.length - 1));
      return;
    }
    if (paused) return;
    const base = elapsedBefore.current;
    startedAt.current = performance.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    phases.forEach((phase, index) => {
      if (phase.at <= base) {
        setPhaseIndex((current) => Math.max(current, index));
        return;
      }
      timers.push(
        setTimeout(() => {
          setPhaseIndex((current) => Math.max(current, index));
        }, phase.at - base),
      );
    });
    if (autoplay && durationMs > base) {
      timers.push(
        setTimeout(() => {
          onDoneRef.current();
        }, durationMs - base),
      );
    }
    return () => {
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
      elapsedBefore.current += performance.now() - startedAt.current;
    };
  }, [sceneKey, phases, durationMs, paused, settled, autoplay]);

  return phaseIndex;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listen = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    query.addEventListener("change", listen);
    return () => {
      query.removeEventListener("change", listen);
    };
  }, []);
  return reduced;
}

/**
 * The reel is watched, not driven: no link inside a screen may leave the
 * page, whichever route the live component wrote into it.
 */
function swallowLinks(event: MouseEvent<HTMLElement>) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("a[href]")) event.preventDefault();
}

function ScreenArea({ children, tab }: { children: ReactNode; tab?: ArtistTabId }) {
  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]"
      style={SCREEN_AREA_STYLE}
    >
      {tab ? (
        <>
          <div className="h-full overflow-y-auto">
            {children}
            {/* In-flow spacer, not padding: sticky calls to action measure
                their 4.75rem offset from the scrollport's content edge, so
                padding here would push them above the tabs. */}
            <div aria-hidden className="h-[4.75rem] lg:h-5" />
          </div>
          <div className="lg:hidden">
            <LiquidGlassBottomNav
              ariaLabel="Artist app tabs"
              tabs={artistTabs(tab)}
              position="fixed"
            />
          </div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

interface DeviceProps {
  children: ReactNode;
  cue: SpotlightCue | null;
  cueKey: string;
  settled: boolean;
}

/** Noya's phone: edge to edge on phones, a device frame on desktop. */
function ArtistDevice({ children, cue, cueKey, settled, tab }: DeviceProps & { tab?: ArtistTabId }) {
  return (
    <div
      data-testid="simulation-artist-frame"
      onClickCapture={swallowLinks}
      className="h-full w-full lg:mx-auto lg:h-[min(80vh,780px)] lg:w-[392px] lg:overflow-hidden lg:rounded-[44px] lg:border-[7px] lg:border-[#2a2823] lg:bg-[#2a2823] lg:shadow-[0_40px_90px_rgb(0_0_0/0.55)]"
    >
      <div className="h-full w-full overflow-hidden lg:rounded-[37px]">
        <Spotlight cue={cue} cueKey={cueKey} settled={settled}>
          <ScreenArea {...(tab ? { tab } : {})}>{children}</ScreenArea>
        </Spotlight>
      </div>
    </div>
  );
}

/** The producer's own screen: edge to edge on phones, a browser window on desktop. */
function ProducerWindow({ children, cue, cueKey, settled, flush = false }: DeviceProps & { flush?: boolean }) {
  return (
    <div
      data-testid="simulation-producer-panel"
      onClickCapture={swallowLinks}
      className="flex h-full w-full flex-col bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] lg:mx-auto lg:h-[min(80vh,780px)] lg:w-full lg:max-w-[880px] lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-white/10 lg:shadow-[0_40px_90px_rgb(0_0_0/0.55)]"
    >
      <div
        aria-hidden
        className="hidden h-9 shrink-0 items-center gap-2 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 lg:flex"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--border-subtle))]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--border-subtle))]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--border-subtle))]" />
        <span className="mx-auto rounded-[var(--radius-sm)] bg-[rgb(var(--bg-background))] px-3 py-0.5 text-[11px] text-[rgb(var(--fg-muted))]">
          skitza.app/dashboard
        </span>
      </div>
      <div className="min-h-0 flex-1" style={SCREEN_AREA_STYLE}>
        <Spotlight cue={cue} cueKey={cueKey} settled={settled}>
          <div className="h-full overflow-y-auto">
            {flush ? children : <div className="px-4 pt-5 pb-6 sm:px-6">{children}</div>}
          </div>
        </Spotlight>
      </div>
    </div>
  );
}

// The hook: five app tiles collapse into the producer's own link. Positions
// are in a 300×210 box; each tile flies to its centre, which the CSS reads
// from the two custom properties.
const HOOK_TILES = [
  { label: "WhatsApp", x: 8, y: 10, rotate: -8, tone: "#25D366", delay: 900 },
  { label: "Drive", x: 118, y: 0, rotate: 6, tone: "#4285F4", delay: 960 },
  { label: "Excel", x: 222, y: 22, rotate: -5, tone: "#1D6F42", delay: 1020 },
  { label: "Calendar", x: 48, y: 118, rotate: 7, tone: "#EA4335", delay: 1080 },
  { label: "Contract", x: 176, y: 124, rotate: -9, tone: "#6B6359", delay: 1140 },
] as const;

function HookScene({ publicUrl }: { publicUrl: string }) {
  const shown = publicUrl.replace(/^https?:\/\//, "");
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative h-[210px] w-[300px]" aria-hidden>
        {HOOK_TILES.map((tile) => (
          <span
            key={tile.label}
            className="sk-reel-tile absolute flex h-[74px] w-[74px] flex-col items-center justify-center gap-1.5 rounded-[18px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[10.5px] font-semibold text-[rgb(var(--fg-muted))] shadow-[0_8px_20px_rgb(17_16_9/0.08)]"
            style={
              {
                left: tile.x,
                top: tile.y,
                "--sk-reel-rot": `${String(tile.rotate)}deg`,
                "--sk-reel-dx": `${String(150 - tile.x - 37)}px`,
                "--sk-reel-dy": `${String(105 - tile.y - 37)}px`,
                "--sk-reel-t": `${String(tile.delay)}ms`,
              } as CSSProperties
            }
          >
            <span className="h-[26px] w-[26px] rounded-[8px]" style={{ background: tile.tone }} />
            {tile.label}
          </span>
        ))}
        <span
          className="sk-reel-pill absolute top-1/2 left-1/2 inline-flex h-[52px] items-center gap-2.5 rounded-[14px] bg-[rgb(var(--bg-sidebar))] px-4.5 font-mono text-[15px] whitespace-nowrap text-[rgb(var(--fg-onsidebar))] shadow-[0_16px_36px_rgb(17_16_9/0.28)]"
          style={{ "--sk-reel-t": "1650ms" } as CSSProperties}
        >
          <span className="font-display grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-[rgb(var(--brand-primary))] text-[15px] font-extrabold text-[rgb(var(--bg-sidebar))]">
            S
          </span>
          {shown}
        </span>
        <span
          className="sk-reel-ring sk-reel-ring-lg"
          style={{ left: "50%", top: "50%", "--sk-reel-t": "2150ms" } as CSSProperties}
        />
      </div>
    </div>
  );
}

function GoogleCalendarLine() {
  return (
    <p className="mx-auto inline-flex h-10 items-center gap-2.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
      <span
        aria-hidden
        className="font-display grid h-6 w-6 place-items-center rounded-[6px] border border-[rgb(var(--border-subtle))] text-[12px] font-extrabold text-[#1a73e8]"
      >
        G
      </span>
      Added to Google Calendar
    </p>
  );
}

function DeliveryRow({ unlocked, artist }: { unlocked: boolean; artist: string }) {
  return (
    <div
      data-reel-focus="delivery"
      className="mt-4 flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary-text))] text-[rgb(var(--brand-primary-text))]">
        <AudioLines aria-hidden size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
          {SIMULATED_ARTIST.projectTitle} · v2
        </p>
        <p
          key={unlocked ? "open" : "locked"}
          className={`sk-reel-rise text-[12.5px] ${
            unlocked
              ? "font-bold text-[rgb(var(--brand-primary-dark))]"
              : "text-[rgb(var(--fg-muted))]"
          }`}
        >
          {unlocked ? `Fully paid · download open for ${artist}` : "Download locked until fully paid"}
        </p>
      </div>
      <span
        key={unlocked ? "open" : "locked"}
        className={`sk-reel-pop grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] border ${
          unlocked
            ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--brand-primary-dark))]"
            : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-default))]"
        }`}
        aria-hidden
      >
        {unlocked ? <LockOpen size={20} /> : <Lock size={20} />}
      </span>
    </div>
  );
}

function Progress({
  scenes,
  current,
  settled,
}: {
  scenes: readonly SimulationScene[];
  current: SimulationScene;
  settled: boolean;
}) {
  return (
    <ol aria-hidden className="flex w-full items-center gap-[4px]">
      {scenes.map((scene) => {
        const done = scene.step < current.step || settled;
        const active = scene.id === current.id && !settled;
        return (
          <li
            key={scene.id}
            className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25"
          >
            <span
              key={active ? `${scene.id}-live` : `${scene.id}-still`}
              className={`block h-full rounded-full bg-white ${active ? "sk-reel-fill" : ""}`}
              style={
                {
                  width: done ? "100%" : active ? undefined : "0%",
                  "--sk-reel-dur": `${String(scene.durationMs)}ms`,
                } as CSSProperties
              }
            />
          </li>
        );
      })}
    </ol>
  );
}

function Avatar({ initial, logoUrl }: { initial: string; logoUrl: string | null }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />;
  }
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold text-white">
      {initial}
    </span>
  );
}

export function FirstArtistSimulation({
  open,
  onOpenChange,
  input,
  links,
}: FirstArtistSimulationProps) {
  const model = useMemo(() => buildSimulation(input, new Date()), [input]);
  const { scenes } = model;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const reduceMotion = useReducedMotion();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);

  const lastIndex = scenes.length - 1;
  const scene: SimulationScene = scenes[Math.min(index, lastIndex)] ?? FALLBACK_SCENE;
  const phases = PHASES[scene.id];
  const isLast = index >= lastIndex;

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setPaused(false);
    setCopied(false);
    completedRef.current = false;
    captureProductEvent("simulation_started", { steps: scenes.length, product: input.product.id });
  }, [open, scenes.length, input.product.id]);

  useEffect(() => {
    if (!open) return;
    captureProductEvent("simulation_step", { step: scene.step, frame: scene.id });
    if (scene.step === scenes.length && !completedRef.current) {
      completedRef.current = true;
      captureProductEvent("simulation_completed", { steps: scenes.length });
    }
  }, [open, scene.id, scene.step, scenes.length]);

  const phaseIndex = useSceneTimeline({
    sceneKey: `${scene.id}:${String(open)}`,
    phases,
    durationMs: scene.durationMs,
    paused: paused || !open,
    settled: reduceMotion,
    autoplay: !isLast,
    onDone: () => {
      setIndex((current) => Math.min(lastIndex, current + 1));
    },
  });
  const phase = phases[Math.min(phaseIndex, phases.length - 1)] ?? phases[0];
  const state = phase?.state ?? "";
  const cue = phase?.cue ?? null;
  const cueKey = `${scene.id}:${String(phaseIndex)}`;
  const settledOnCta = reduceMotion || state === "cta";

  function goTo(nextIndex: number) {
    setIndex(Math.max(0, Math.min(lastIndex, nextIndex)));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !isLast) {
      captureProductEvent("simulation_exited_early", { step: scene.step, frame: scene.id });
    }
    onOpenChange(nextOpen);
  }

  function goNext() {
    if (isLast) {
      handleOpenChange(false);
      return;
    }
    goTo(index + 1);
  }

  function goBack() {
    goTo(index - 1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goBack();
    } else if (event.key === " " && tag !== "BUTTON" && tag !== "A") {
      event.preventDefault();
      setPaused((current) => !current);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(links.publicUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      return;
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopied(false);
    }, 2200);
  }

  function renderScene(): ReactNode {
    const { product, producer } = model;
    const device = { cue, cueKey, settled: reduceMotion };
    switch (scene.id) {
      case "hook":
        return <HookScene publicUrl={links.publicUrl} />;
      case "link":
        return (
          <ArtistDevice {...device} tab="store">
            <div className="space-y-4 px-4 pt-4">
              <ProducerHero producerName={producer.name} producerLogoUrl={model.producerLogoUrl} />
              <div data-reel-focus="product">
                <FocalProductCard
                  product={{
                    id: product.id,
                    name: product.name,
                    description: product.tagline,
                    priceCents: product.priceCents,
                    currency: product.currency,
                    pricingModel: product.pricingModel,
                    volumeTiers: product.volumeTiers,
                    sessionCount: product.sessions,
                    durationMin: input.product.durationMin,
                  }}
                  producerName={producer.name}
                  taxMode={model.taxMode}
                  taxRatePct={model.taxRatePct}
                  onPreviewDetails={() => undefined}
                />
              </div>
            </div>
          </ArtistDevice>
        );
      case "booking":
        return (
          <ArtistDevice {...device} tab="sessions">
            <RuntimeStatePreviewProvider identity={SIMULATION_ARTIST_IDENTITY}>
              {state === "booked" ? (
                <div className="space-y-4 px-4 pt-4">
                  <div data-reel-focus="booked" className="sk-reel-rise space-y-4 text-center">
                    <ConfirmationHero session={model.session.item} />
                    <GoogleCalendarLine />
                  </div>
                </div>
              ) : (
                <div data-reel-focus="booking" className="h-full">
                  <BookingClient
                    activeStudioId={SIMULATION_IDS.studio}
                    availability={model.booking.availability}
                    studios={model.booking.studios}
                    activePackages={model.booking.activePackages}
                    initialSessionAllowanceId={model.booking.allowanceId}
                    rescheduleSessionId={null}
                    onPreviewSubmit={() => undefined}
                  />
                </div>
              )}
            </RuntimeStatePreviewProvider>
          </ArtistDevice>
        );
      case "library":
        return (
          <ArtistDevice {...device} tab="music">
            <RuntimeStatePreviewProvider identity={SIMULATION_ARTIST_IDENTITY}>
              {state === "list" ? (
                <div className="px-4 pt-5">
                  <h1 className="font-display text-[28px] leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
                    Music<span className="text-[rgb(var(--brand-primary-dark))]">.</span>
                  </h1>
                  <p className="mt-2 mb-5 text-[12.5px] text-[rgb(var(--fg-muted))]">
                    <span className="font-mono font-bold text-[rgb(var(--fg-default))]">
                      {String(model.library.length)}
                    </span>{" "}
                    songs ·{" "}
                    <span className="font-bold text-[rgb(var(--brand-primary-dark))]">
                      1 note waiting
                    </span>
                  </p>
                  <div data-reel-focus="list">
                    <SongsGrid songs={model.library} role="artist" addSongHref={INERT_HREF} />
                  </div>
                </div>
              ) : (
                <div data-reel-focus="song">
                  <SongPage
                    key={state === "approved" ? "approved" : "reviewing"}
                    role="artist"
                    embedded
                    data={state === "approved" ? model.song.approved : model.song.data}
                    actions={{
                      approveVersion: () => Promise.resolve({ ok: true }),
                    }}
                  />
                </div>
              )}
            </RuntimeStatePreviewProvider>
          </ArtistDevice>
        );
      case "money":
        return (
          <ProducerWindow {...device}>
            <div data-reel-focus="proof">
              <PaymentProofReview
                key={state === "pending" ? "pending" : "confirmed"}
                review={state === "pending" ? model.proofReview : model.proofReviewConfirmed}
                onPreviewDecision={() => undefined}
              />
            </div>
            {state === "delivery" || state === "unlocked" ? (
              <DeliveryRow unlocked={state === "unlocked"} artist={SIMULATED_ARTIST.firstName} />
            ) : null}
          </ProducerWindow>
        );
      case "studio":
        return (
          <ProducerWindow {...device} flush>
            <RuntimeStatePreviewProvider identity={SIMULATION_PRODUCER_IDENTITY}>
              <div data-reel-focus="overview">
                <OverviewScreen
                  displayName={producer.name}
                  slug={null}
                  timezone={input.timezone}
                  pulseStats={model.dashboard.pulseStats}
                  paymentProofs={[]}
                  paymentBalances={model.dashboard.paymentBalances}
                  purchaseRequests={[]}
                  pendingApprovals={[]}
                  todaySession={model.dashboard.todaySession}
                  urgentProjects={[]}
                  recentUploads={model.dashboard.recentUploads}
                  unresolvedItems={[]}
                  dismissals={[]}
                  showSetupNudge={false}
                  showAllNeedsYou
                  now={model.dashboard.now}
                />
              </div>
            </RuntimeStatePreviewProvider>
          </ProducerWindow>
        );
      default:
        return null;
    }
  }

  const nextLabel = isLast ? "Finish" : "Next";
  const identity =
    scene.side === "producer"
      ? { initial: model.producer.initials.charAt(0), name: "You", logoUrl: model.producerLogoUrl }
      : { initial: SIMULATED_ARTIST.firstName.charAt(0), name: SIMULATED_ARTIST.firstName, logoUrl: null };

  const closing = isLast ? (
    <div
      key={settledOnCta ? "cta" : "waiting"}
      className={`mt-5 flex flex-col items-center gap-3 lg:items-start ${settledOnCta ? "sk-reel-rise" : "invisible"}`}
    >
      <Link
        href={links.bringActiveWork}
        className="ob-press sk-reel-shine relative inline-flex min-h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-6 text-[15px] font-bold text-[rgb(var(--bg-sidebar))] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:w-auto sm:min-w-[260px]"
      >
        Add your first client
        <ChevronRight size={18} aria-hidden />
      </Link>
      <div className="flex items-center gap-5 text-[13.5px] font-semibold text-white/70">
        <button
          type="button"
          onClick={() => {
            void copyLink();
          }}
          className="inline-flex min-h-11 items-center gap-1.5 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          {copied ? <Check size={15} aria-hidden /> : null}
          {copied ? "Link copied" : "Copy my link"}
        </button>
        <Link
          href={links.dashboard}
          className="inline-flex min-h-11 items-center hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          Open dashboard
        </Link>
      </div>
      <p className="text-[11.5px] text-white/40">Nothing was sent or saved.</p>
    </div>
  ) : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgb(17_16_9/0.72)]" />
        <DialogPrimitive.Content
          aria-describedby="first-artist-simulation-description"
          onKeyDown={handleKeyDown}
          className={`fixed inset-0 z-[65] flex h-[100dvh] flex-col bg-[rgb(var(--bg-sidebar))] text-white outline-none ${paused ? "sk-reel-paused" : ""}`}
        >
          <DialogPrimitive.Title className="sr-only">Watch your first artist</DialogPrimitive.Title>
          <DialogPrimitive.Description id="first-artist-simulation-description" className="sr-only">
            A short reel of what you and your artists get, played on your real product with a
            fictional artist. {SIMULATION_LABEL}. Nothing is sent or saved.
          </DialogPrimitive.Description>

          {/* Top: hairline progress, identity row, pause, skip, close. */}
          <div className="shrink-0 px-3 pt-[max(env(safe-area-inset-top),10px)] lg:px-8 lg:pt-5">
            <div className="lg:hidden">
              <Progress scenes={scenes} current={scene} settled={reduceMotion} />
            </div>
            <div className="flex h-12 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar initial={identity.initial} logoUrl={identity.logoUrl} />
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="text-[14px] font-semibold text-white">{identity.name}</span>
                  <span className="truncate text-[12px] text-white/50">{SIMULATION_LABEL}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!reduceMotion && !isLast ? (
                  <button
                    type="button"
                    aria-label={paused ? "Play" : "Pause"}
                    aria-pressed={paused}
                    onClick={() => {
                      setPaused((current) => !current);
                    }}
                    className="ob-press inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
                  >
                    {paused ? <Play size={17} aria-hidden /> : <Pause size={17} aria-hidden />}
                  </button>
                ) : null}
                {!isLast ? (
                  <button
                    type="button"
                    onClick={() => {
                      goTo(lastIndex);
                    }}
                    className="ob-press inline-flex h-10 items-center rounded-full px-3 text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
                  >
                    Skip
                  </button>
                ) : null}
                <DialogPrimitive.Close asChild>
                  <button
                    type="button"
                    aria-label="Close simulation"
                    className="ob-press inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
                  >
                    <X size={20} strokeWidth={2} aria-hidden />
                  </button>
                </DialogPrimitive.Close>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-center lg:gap-14 lg:px-12 lg:pb-8">
            {/* Words: bottom on phones, left column on desktop. Two lines,
                nothing else, and the action once the reel has landed. */}
            <div className="order-2 shrink-0 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] lg:order-1 lg:w-[420px] lg:px-0 lg:pt-0 lg:pb-0">
              <div className="relative lg:flex lg:min-h-[420px] lg:flex-col">
                <div className="hidden lg:block">
                  <Progress scenes={scenes} current={scene} settled={reduceMotion} />
                  <p
                    data-testid="simulation-step"
                    className="mt-3 text-[12px] font-medium text-white/50"
                  >
                    {String(scene.step)} / {String(scenes.length)}
                  </p>
                </div>
                <div className="text-center lg:text-left">
                  <p
                    key={scene.id}
                    data-testid="simulation-caption"
                    aria-live="polite"
                    className="sk-step-enter font-display text-[24px] leading-[1.06] font-extrabold tracking-[-0.03em] text-balance text-white lg:mt-3 lg:text-[36px] lg:leading-[1.06]"
                  >
                    {scene.headline}
                  </p>
                  <p className="mt-1.5 text-[13.5px] leading-[1.4] text-balance text-white/60 lg:mt-3 lg:text-[16px] lg:leading-relaxed">
                    {scene.line}
                  </p>
                  {closing}
                </div>
                <div className="mt-3 flex items-center justify-center gap-2 lg:mt-auto lg:justify-start lg:pt-6">
                  <button
                    type="button"
                    onClick={goBack}
                    aria-label="Back"
                    className={`ob-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none lg:h-12 lg:w-12 ${
                      index === 0 ? "invisible" : ""
                    }`}
                  >
                    <ChevronLeft size={20} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label={nextLabel}
                    className="ob-press inline-flex h-10 min-w-[120px] shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-white/20 px-4 text-[13.5px] font-bold text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none lg:h-12 lg:min-w-[160px] lg:rounded-[var(--radius-lg)]"
                  >
                    {nextLabel}
                    <ChevronRight size={17} aria-hidden />
                  </button>
                </div>
                <p className="mt-3 hidden text-[12px] text-white/35 lg:block">
                  Plays on its own. Space pauses, the arrow keys move.
                </p>
              </div>
            </div>

            {/* The screen. */}
            <div className="order-1 min-h-0 flex-1 lg:order-2 lg:flex lg:items-center lg:justify-center">
              <div key={scene.id} className="sk-step-enter h-full w-full">
                {renderScene()}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
