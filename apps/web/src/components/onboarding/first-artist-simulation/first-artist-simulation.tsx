"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, ChevronLeft, ChevronRight, Lock, LockOpen, Pause, Play, X } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { formatMoney } from "~/lib/format/money";
import { captureProductEvent } from "~/lib/observability/product-events";

import {
  buildSimulation,
  previewPeaks,
  SIMULATED_ARTIST,
  SIMULATION_LABEL,
  type SimulationInput,
  type SimulationModel,
  type SimulationScene,
  type SimulationSceneId,
} from "./simulation-model";

// The onboarding reel (SK-310, replacing the SK-298 story): six screens,
// about 31 seconds, that show what a producer gets, not the steps to get it.
// Each screen is one drawn picture with one chain on it: the artist acts, the
// picture changes, the same green check stamps the payoff. The producer's
// real product name and price sit inside the pictures. Nothing here reaches
// the server: the pictures are static markup timed by CSS, and the only links
// are the two on the last screen.

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

/** Milliseconds after a scene starts at which its later beats begin. */
const PHASES: Record<SimulationSceneId, readonly number[]> = {
  hook: [0],
  link: [0],
  booking: [0],
  library: [0],
  money: [0],
  // The action appears once the studio picture has settled.
  studio: [0, 2100],
};

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

function at(ms: number, extra?: CSSProperties): CSSProperties {
  return { "--sk-reel-t": `${String(ms)}ms`, ...extra } as CSSProperties;
}

function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Advances a scene's beats on real time, pauses with the reel, and calls
 * back when the scene has run its length. Reduced motion lands on the last
 * beat at once and never auto-advances.
 */
function useSceneTimeline(input: {
  sceneKey: string;
  phases: readonly number[];
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
    phases.forEach((phaseAt, index) => {
      if (phaseAt <= base) {
        setPhaseIndex((current) => Math.max(current, index));
        return;
      }
      timers.push(
        setTimeout(() => {
          setPhaseIndex((current) => Math.max(current, index));
        }, phaseAt - base),
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

// ---------------------------------------------------------------------------
// Shared marks: the artist, the fingertip ring, the green check, a swap.
// ---------------------------------------------------------------------------

const AVATAR_TONES = {
  noya: "bg-[#DCEBF5] text-[#1E4A6B]",
  amit: "bg-[#F1E1D2] text-[#6B3A16]",
  dana: "bg-[#E5E1F4] text-[#3F2E7A]",
} as const;

function Avatar({
  tone,
  initial,
  size = "md",
}: {
  tone: keyof typeof AVATAR_TONES;
  initial: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-full font-bold ${AVATAR_TONES[tone]} ${
        size === "sm" ? "h-[34px] w-[34px] text-[14px]" : "h-12 w-12 text-[18px]"
      }`}
    >
      {initial}
    </span>
  );
}

/** The fingertip: blooms once where the artist taps. */
function Ring({ ms, large = false }: { ms: number; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`sk-reel-ring ${large ? "sk-reel-ring-lg" : ""}`}
      style={at(ms, { left: "50%", top: "50%" })}
    />
  );
}

/** The payoff: one green check, the same on every screen. */
function Stamp({ ms, small = false, className = "" }: { ms: number; small?: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Done"
      data-testid="reel-stamp"
      className={`sk-reel-stamp ${small ? "sk-reel-stamp-sm" : ""} ${className}`}
      style={at(ms)}
    >
      <svg
        width={small ? 22 : 26}
        height={small ? 22 : 26}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/** One slot that shows `before`, then `after`, at `ms`. */
function Swap({ ms, before, after }: { ms: number; before: ReactNode; after: ReactNode }) {
  return (
    <span className="sk-reel-swap" style={at(ms)}>
      <span className="sk-reel-swap-b">{before}</span>
      <span className="sk-reel-swap-a">{after}</span>
    </span>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return <Check size={size} strokeWidth={3} aria-hidden className="shrink-0" />;
}

const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[14px] font-bold";
const CHIP_AMBER = `${CHIP} bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]`;
const CHIP_GREEN = `${CHIP} bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]`;
const CHIP_GREY = `${CHIP} border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]`;
const CARD =
  "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] rounded-[var(--radius-xl)]";

// ---------------------------------------------------------------------------
// The six pictures.
// ---------------------------------------------------------------------------

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

function LinkPill({ publicUrl, className = "" }: { publicUrl: string; className?: string }) {
  return (
    <>
      <span className="font-display grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] bg-[rgb(var(--brand-primary))] text-[15px] font-extrabold text-[rgb(var(--bg-sidebar))]">
        S
      </span>
      <span className={`truncate ${className}`}>{publicUrl.replace(/^https?:\/\//, "")}</span>
    </>
  );
}

function HookScene({ publicUrl }: { publicUrl: string }) {
  return (
    <div className="relative h-[210px] w-[300px]" aria-hidden>
      {HOOK_TILES.map((tile) => (
        <span
          key={tile.label}
          className="sk-reel-tile absolute flex h-[74px] w-[74px] flex-col items-center justify-center gap-1.5 rounded-[18px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[10.5px] font-semibold text-[rgb(var(--fg-muted))] shadow-[0_8px_20px_rgb(17_16_9/0.08)]"
          style={at(tile.delay, {
            left: tile.x,
            top: tile.y,
            "--sk-reel-rot": `${String(tile.rotate)}deg`,
            "--sk-reel-dx": `${String(150 - tile.x - 37)}px`,
            "--sk-reel-dy": `${String(105 - tile.y - 37)}px`,
          } as CSSProperties)}
        >
          <span className="h-[26px] w-[26px] rounded-[8px]" style={{ background: tile.tone }} />
          {tile.label}
        </span>
      ))}
      <span
        className="sk-reel-pill absolute top-1/2 left-1/2 inline-flex h-[52px] max-w-[300px] items-center gap-2.5 rounded-[14px] bg-[rgb(var(--bg-sidebar))] px-4.5 font-mono text-[15px] whitespace-nowrap text-[rgb(var(--fg-onsidebar))] shadow-[0_16px_36px_rgb(17_16_9/0.28)]"
        style={at(1650)}
      >
        <LinkPill publicUrl={publicUrl} />
      </span>
      <Ring ms={2150} large />
    </div>
  );
}

function LinkScene({ model, publicUrl }: { model: SimulationModel; publicUrl: string }) {
  const price = formatMoney(model.totalCents, model.currency, {
    withCents: model.totalCents % 100 !== 0,
  });
  return (
    <>
      <div
        className="sk-reel-rise relative inline-flex h-[52px] max-w-full items-center gap-2.5 rounded-[14px] bg-[rgb(var(--bg-sidebar))] px-4.5 font-mono text-[15px] text-[rgb(var(--fg-onsidebar))]"
        style={at(100)}
      >
        <LinkPill publicUrl={publicUrl} />
        <Ring ms={1500} />
      </div>
      <div
        className="sk-reel-slide flex flex-col items-center gap-1.5 text-[13px] font-semibold text-[rgb(var(--fg-muted))]"
        style={at(900)}
      >
        <Avatar tone="noya" initial="N" />
        {SIMULATED_ARTIST.firstName}
      </div>
      <svg
        className="sk-reel-rise text-[rgb(var(--border-strong))]"
        style={at(2000)}
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 5v14M6 13l6 6 6-6" />
      </svg>
      <div className={`sk-reel-rise relative flex w-[300px] max-w-full flex-col gap-3 p-[18px] ${CARD}`} style={at(2100)}>
        <p className="text-[13px] font-bold tracking-[0.06em] text-[rgb(var(--fg-muted))] uppercase">
          New request
        </p>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar tone="noya" initial="N" size="sm" />
          <div className="min-w-0">
            <p className="text-[17px] font-bold">{SIMULATED_ARTIST.firstName}</p>
            <p className="truncate text-[14px] text-[rgb(var(--fg-muted))]">
              {model.product.name} · <span className="font-mono font-semibold">{price}</span>
            </p>
          </div>
        </div>
        <Stamp ms={2700} className="top-[-14px] right-[-14px]" />
      </div>
    </>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu"] as const;
// Row by row: open, busy in Google, or the slot she picks.
const CELLS: readonly ("open" | "busy" | "pick")[] = [
  "busy", "open", "open", "open", "open",
  "open", "busy", "pick", "open", "open",
  "open", "open", "open", "busy", "open",
];

function BookingScene() {
  return (
    <>
      <div
        className="sk-reel-slide flex flex-col items-center gap-1.5 text-[13px] font-semibold text-[rgb(var(--fg-muted))]"
        style={at(800)}
      >
        <Avatar tone="noya" initial="N" />
        {SIMULATED_ARTIST.firstName} picks a time
      </div>
      <div className={`sk-reel-rise w-[320px] max-w-full p-3.5 ${CARD}`} style={at(100)}>
        <div className="mb-1.5 grid grid-cols-5 gap-1.5">
          {DAYS.map((day) => (
            <span key={day} className="text-center text-[13px] font-semibold text-[rgb(var(--fg-muted))]">
              {day}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {CELLS.map((cell, index) => (
            <span
              key={String(index)}
              className={`relative h-[46px] rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] ${
                cell === "busy" ? "sk-reel-busy" : ""
              }`}
            >
              {cell === "pick" ? (
                <>
                  <Ring ms={1400} />
                  <span
                    className="sk-reel-pop absolute inset-0 flex flex-col items-center justify-center rounded-[10px] bg-[rgb(var(--brand-primary))] text-[12px] leading-[1.1] font-bold text-[rgb(var(--bg-sidebar))]"
                    style={at(1600)}
                  >
                    <span>{SIMULATED_ARTIST.firstName}</span>
                    <span>14:00</span>
                  </span>
                </>
              ) : null}
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex gap-3.5 text-[12px] text-[rgb(var(--fg-muted))]">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-3.5 w-3.5 rounded-[4px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))]" />
            Your open hours
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="sk-reel-busy h-3.5 w-3.5 rounded-[4px] border border-[rgb(var(--border-subtle))]" />
            Busy in Google
          </span>
        </div>
      </div>
      <div
        className="sk-reel-rise relative inline-flex h-11 items-center gap-2.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] pr-[34px] pl-2.5 text-[14px] font-semibold"
        style={at(2300)}
      >
        <span
          aria-hidden
          className="font-display grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[rgb(var(--border-subtle))] text-[13px] font-extrabold text-[#1a73e8]"
        >
          G
        </span>
        Added to Google Calendar
        <Stamp ms={2800} small className="top-[-12px] right-[-18px]" />
      </div>
    </>
  );
}

const WAVE_BARS = previewPeaks(3).filter((_, index) => index % 5 === 0).slice(0, 42);

function SongRow({ title, meta }: { title: string; meta: string }) {
  return (
    <>
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
        <Play size={12} fill="currentColor" aria-hidden />
      </span>
      <span className="flex-1 truncate text-[15px] font-bold">{title}</span>
      <span className="font-mono text-[12px] text-[rgb(var(--fg-muted))]">{meta}</span>
    </>
  );
}

function LibraryScene({ model }: { model: SimulationModel }) {
  const [first, ...rest] = model.library;
  return (
    <div className={`sk-reel-rise relative flex w-[320px] max-w-full flex-col gap-2 p-3.5 ${CARD}`} style={at(100)}>
      <div className="flex items-center gap-2.5 pr-[34px] pb-1.5 pl-1">
        <Avatar tone="noya" initial="N" size="sm" />
        <span className="text-[16px] font-bold">{SIMULATED_ARTIST.firstName}&apos;s library</span>
        <span className="ml-auto text-[13px] text-[rgb(var(--fg-muted))]">
          {String(model.library.length)} songs
        </span>
      </div>
      <div
        className="sk-reel-rise rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 pt-2.5 pb-3 shadow-[0_10px_24px_rgb(17_16_9/0.06)]"
        style={at(400)}
      >
        <div className="flex items-center gap-2.5 pb-1">
          <SongRow
            title={first?.trackTitle ?? SIMULATED_ARTIST.projectTitle}
            meta={`${first?.label ?? "v2"} · ${clock(first?.durationMs ?? 0)}`}
          />
        </div>
        <div className="relative mt-4 flex h-[72px] items-center gap-[3px]" aria-hidden>
          {WAVE_BARS.map((height, index) => (
            <i
              key={String(index)}
              className={`sk-reel-bar flex-1 rounded-[3px] ${
                index < 18 ? "bg-[rgb(var(--brand-primary))]" : "bg-[rgb(var(--fg-default)/0.18)]"
              }`}
              style={at(500 + index * 12, { height: `${String(Math.round(height * 100))}%` })}
            />
          ))}
          <span className="sk-reel-playhead" style={at(900)} />
          <span className="sk-reel-pin" style={at(1900)} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[12px] text-[rgb(var(--fg-muted))]">
          <span>0:00</span>
          <span className="font-semibold text-[rgb(var(--brand-primary-dark))]">0:42</span>
          <span>{clock(first?.durationMs ?? 0)}</span>
        </div>
        <div className="sk-reel-rise mt-2.5 flex items-center gap-2.5" style={at(2200)}>
          <Avatar tone="noya" initial="N" size="sm" />
          <span className="rounded-[4px_14px_14px_14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] px-3 py-2 text-[15px] font-medium">
            <span className="mr-2 font-mono text-[12px] text-[rgb(var(--brand-primary-dark))]">0:42</span>
            Keep this vocal.
          </span>
        </div>
        <div className="mt-2.5 flex">
          <Swap
            ms={3500}
            before={<span className={CHIP_GREY}>v2 · waiting for approval</span>}
            after={
              <span className={CHIP_GREEN}>
                <Lock size={14} aria-hidden />
                v2 approved and locked
              </span>
            }
          />
        </div>
      </div>
      {rest.map((row, index) => (
        <div
          key={row.id}
          className="sk-reel-rise flex items-center gap-2.5 rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] px-2.5 py-2"
          style={at(600 + index * 150)}
        >
          <SongRow title={row.trackTitle} meta={`${row.label ?? "v1"} · ${clock(row.durationMs ?? 0)}`} />
        </div>
      ))}
      <Stamp ms={3500} className="top-[-14px] right-[-14px]" />
    </div>
  );
}

function MoneyScene({ model }: { model: SimulationModel }) {
  const price = formatMoney(model.totalCents, model.currency, {
    withCents: model.totalCents % 100 !== 0,
  });
  return (
    <>
      <div className={`sk-reel-rise relative flex w-[320px] max-w-full flex-col gap-3.5 px-5 py-[18px] ${CARD}`} style={at(100)}>
        <div className="flex min-w-0 items-center gap-2.5 pr-7 text-[15px] text-[rgb(var(--fg-muted))]">
          <Avatar tone="noya" initial="N" size="sm" />
          <span className="truncate">{model.product.name}</span>
        </div>
        <p className="font-mono text-[44px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {price}
        </p>
        <div className="flex items-center">
          <Swap
            ms={1900}
            before={<span className={CHIP_AMBER}>Waiting for payment</span>}
            after={
              <span className={CHIP_GREEN}>
                <CheckIcon />
                Paid
              </span>
            }
          />
        </div>
        <span
          aria-hidden
          className="sk-reel-slide sk-reel-receipt absolute top-16 right-[22px] flex h-[68px] w-[54px] items-end justify-center rounded-[8px] border border-[rgb(var(--border-strong))] pb-1.5 text-[10px] font-bold text-[rgb(var(--fg-muted))] shadow-[0_10px_20px_rgb(17_16_9/0.1)]"
          style={at(1000)}
        >
          Receipt
        </span>
        <Stamp ms={1900} className="top-[-14px] right-[-14px]" />
      </div>
      <div className={`sk-reel-rise flex w-[320px] max-w-full items-center gap-3.5 px-[18px] py-3.5 ${CARD}`} style={at(2500)}>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold">{SIMULATED_ARTIST.projectTitle} · v2</p>
          <Swap
            ms={3100}
            before={<span className="text-[14px] text-[rgb(var(--fg-muted))]">Download locked</span>}
            after={
              <span className="text-[14px] font-bold text-[rgb(var(--brand-primary-dark))]">Download open</span>
            }
          />
        </div>
        <Swap
          ms={3100}
          before={
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))]">
              <Lock size={20} aria-hidden />
            </span>
          }
          after={
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--brand-primary-dark))]">
              <LockOpen size={20} aria-hidden />
            </span>
          }
        />
      </div>
    </>
  );
}

const STUDIO_ROWS = [
  { tone: "noya", initial: "N", title: "Blue Hour", chip: CHIP_GREEN, label: "Paid" },
  { tone: "amit", initial: "A", title: "Night Drive", chip: CHIP_AMBER, label: "Session Thu" },
  { tone: "dana", initial: "D", title: "Golden", chip: CHIP_GREY, label: "v3 sent" },
] as const;

function StudioScene() {
  return (
    <>
      <span
        className="sk-reel-pop inline-flex h-9 items-center gap-2 rounded-[12px] bg-[rgb(var(--fg-success)/0.12)] px-3.5 text-[15px] font-bold text-[rgb(var(--fg-success-text))]"
        style={at(1500)}
      >
        <i aria-hidden className="ob-alive-dot h-2 w-2 rounded-full bg-[rgb(var(--fg-success))]" />
        Nothing waiting for you
      </span>
      <div className="flex w-[320px] max-w-full flex-col gap-2">
        {STUDIO_ROWS.map((row, index) => (
          <div
            key={row.title}
            className={`sk-reel-rise flex items-center gap-3 px-3.5 py-3 ${CARD}`}
            style={at(200 + index * 200)}
          >
            <Avatar tone={row.tone} initial={row.initial} size="sm" />
            <span className="flex-1 text-[16px] font-bold">{row.title}</span>
            <span className={row.chip}>{row.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The shell.
// ---------------------------------------------------------------------------

/** One phone: edge to edge on phones, a device frame on desktop. */
function Picture({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="simulation-picture"
      className="h-full w-full lg:mx-auto lg:h-[min(80vh,760px)] lg:w-[392px] lg:overflow-hidden lg:rounded-[44px] lg:border-[7px] lg:border-[#2a2823] lg:bg-[#2a2823] lg:shadow-[0_40px_90px_rgb(0_0_0/0.55)]"
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3.5 overflow-hidden bg-[rgb(var(--bg-background))] px-5 text-[rgb(var(--fg-default))] lg:rounded-[37px]">
        {children}
      </div>
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
          <li key={scene.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
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

function IdentityAvatar({ initial, logoUrl }: { initial: string; logoUrl: string | null }) {
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
  const actionReady = isLast && (reduceMotion || phaseIndex >= phases.length - 1);

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
    switch (scene.id) {
      case "hook":
        return <HookScene publicUrl={links.publicUrl} />;
      case "link":
        return <LinkScene model={model} publicUrl={links.publicUrl} />;
      case "booking":
        return <BookingScene />;
      case "library":
        return <LibraryScene model={model} />;
      case "money":
        return <MoneyScene model={model} />;
      case "studio":
        return <StudioScene />;
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
      key={actionReady ? "ready" : "waiting"}
      className={`mt-5 flex flex-col items-center gap-3 lg:items-start ${actionReady ? "sk-reel-rise" : "invisible"}`}
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
            A short reel of what you and your artists get, drawn around your real product with a
            fictional artist. {SIMULATION_LABEL}. Nothing is sent or saved.
          </DialogPrimitive.Description>

          {/* Top: hairline progress, identity row, pause, skip, close. */}
          <div className="shrink-0 px-3 pt-[max(env(safe-area-inset-top),10px)] lg:px-8 lg:pt-5">
            <div className="lg:hidden">
              <Progress scenes={scenes} current={scene} settled={reduceMotion} />
            </div>
            <div className="flex h-12 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <IdentityAvatar initial={identity.initial} logoUrl={identity.logoUrl} />
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
                  <p data-testid="simulation-step" className="mt-3 text-[12px] font-medium text-white/50">
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

            {/* The picture. */}
            <div className="order-1 min-h-0 flex-1 lg:order-2 lg:flex lg:items-center lg:justify-center">
              <div key={scene.id} className="sk-step-enter h-full w-full">
                <Picture>{renderScene()}</Picture>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
