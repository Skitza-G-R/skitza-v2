"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { BellRing, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import {
  Suspense,
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
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { ConfirmationHero } from "~/components/artist/sessions/confirmation-hero";
import { MySessionsScreen } from "~/components/artist/sessions/my-sessions-screen";
import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { ProducerHero } from "~/components/artist/store/producer-hero";
import { OverviewScreen } from "~/components/dashboard/overview/overview-screen";
import {
  PaymentProofReview,
  type PreviewPaymentProofDecision,
} from "~/components/dashboard/payments/payment-proof-review";
import { PurchaseRequestCommercialDetails } from "~/components/dashboard/requests/purchase-request-commercial-details";
import { PurchaseRequestReview } from "~/components/dashboard/requests/purchase-request-review";
import { SongPage, type L3Actions } from "~/components/music/song-page";
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
  type SimulationFrame,
  type SimulationInput,
} from "./simulation-model";

// "Watch your first artist" (SK-298): a render-only walkthrough that plays the
// producer's REAL first product through the live artist screens with one
// fictional artist, then flips to the producer side. It never calls a
// mutation: the artist frames are inert storyboards and the producer frames
// only feed the preview callbacks the screens already expose for the
// development gallery.
//
// Presentation borrows from stories and first-run tours: the screen is the
// content and fills the phone edge to edge; a hairline progress strip and an
// identity row are the only chrome on top; one sentence and one action sit at
// the bottom; tapping the right side advances, the left side goes back. On
// desktop the narration sits beside a real device frame.

export interface SimulationLinks {
  bringActiveWork: string;
  dashboard: string;
  /** The producer's public join URL, copied from the closing card. */
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

// Dev-gallery hash targets for the screens' preview navigation props. The
// frames are inert, so nothing can follow them; they only satisfy the props.
const INERT_HREF = "#simulation";

// The song page keeps its notes thread under the player, so the music frame
// scrolls to the first timestamped note the caption is talking about.
const SIMULATION_NOTE_SELECTOR = '[data-test="comment-timestamp"]';
// The agreement runs past a phone screen, so the frame scrolls to the line she
// actually accepts rather than leaving the viewer on the header.
const SIMULATION_AGREE_SELECTOR = '[role="checkbox"]';

// The standing artist screens (Store, Music, Sessions) sit above the artist
// app's bottom tabs on phones; their sticky call to action already leaves room
// for that bar, so the frame renders the real tab surface in the same place.
type ArtistTabId = "home" | "music" | "sessions" | "payments" | "store";

function artistTabs(active: ArtistTabId): LiquidGlassBottomNavTab<ArtistTabId>[] {
  return [
    {
      id: "home",
      label: "Home",
      href: INERT_HREF,
      icon: "home",
      active: active === "home",
      prefetch: false,
    },
    {
      id: "music",
      label: "Music",
      href: INERT_HREF,
      icon: "music",
      active: active === "music",
      prefetch: false,
    },
    {
      id: "sessions",
      label: "Sessions",
      href: INERT_HREF,
      icon: "calendar",
      active: active === "sessions",
      prefetch: false,
    },
    {
      id: "payments",
      label: "Payments",
      href: INERT_HREF,
      icon: "payments",
      active: active === "payments",
      prefetch: false,
    },
    {
      id: "store",
      label: "Store",
      href: INERT_HREF,
      icon: "store",
      active: active === "store",
      prefetch: false,
    },
  ];
}

// Runtime state is per-account private storage. The simulation borrows the
// preview provider so the live screens can read a draft slot without ever
// touching the producer's own runtime state.
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

// The song page takes its writes as props. Approval is the only control the
// story shows, and it resolves without leaving the browser.
const SIMULATION_SONG_ACTIONS: L3Actions = {
  approveVersion: () => Promise.resolve({ ok: true }),
};

// A beat before the artist acts, so the viewer reads the screen first and then
// watches it change, the way a screen recording pauses before it moves.
const ACT_DELAY_MS = 1100;

// Room kept above a revealed element so its own heading stays in shot.
const REVEAL_HEADROOM_PX = 64;

/**
 * An artist frame that plays one action. It renders the screen as she found
 * it, waits a beat, then renders it as she left it: the plan accepted, the
 * version approved, the session booked. Reduced motion goes straight to the
 * result. The frame is keyed by its id, so stepping back replays the beat.
 */
function ActedFrame({ children }: { children: (acted: boolean) => ReactNode }) {
  const [acted, setActed] = useState(false);

  useEffect(() => {
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setActed(true);
      return;
    }
    const timer = setTimeout(() => {
      setActed(true);
    }, ACT_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return <>{children(acted)}</>;
}

// The beat before a scripted scroll, so the viewer reads the top of the screen
// before it moves, the way a screen recording pauses before it scrolls.
const REVEAL_DELAY_MS = 1800;

/** The closest ancestor that actually scrolls, which the live screens own. */
function scrollableAncestor(node: Element): Element | null {
  let current = node.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight + 4
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
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

/** Noya's phone: edge to edge on phones, a device frame on desktop. */
function ArtistDevice({
  children,
  tab,
  revealSelector,
}: {
  children: ReactNode;
  tab?: ArtistTabId;
  /**
   * Scroll this element into view after a beat. The live screens are taller
   * than a phone, so the part the caption is about starts below the fold, and
   * the frame is inert, so the story has to scroll there itself.
   */
  revealSelector?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!revealSelector) return;
    const timer = setTimeout(() => {
      const target = rootRef.current?.querySelector(revealSelector);
      const scroller = target ? scrollableAncestor(target) : null;
      if (!target || !scroller) return;
      const top =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        REVEAL_HEADROOM_PX;
      if (top <= 0) return;
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
      } else {
        scroller.scrollTop = top;
      }
    }, REVEAL_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [revealSelector]);

  return (
    <div
      ref={rootRef}
      inert
      aria-hidden
      data-testid="simulation-artist-frame"
      className="h-full w-full lg:mx-auto lg:h-[min(80vh,780px)] lg:w-[392px] lg:overflow-hidden lg:rounded-[44px] lg:border-[7px] lg:border-[#2a2823] lg:bg-[#2a2823] lg:shadow-[0_40px_90px_rgb(0_0_0/0.55)]"
    >
      <div className="h-full w-full overflow-hidden lg:rounded-[37px]">
        <ScreenArea {...(tab ? { tab } : {})}>{children}</ScreenArea>
      </div>
    </div>
  );
}

/** The phone push that opens every producer frame, exactly as Skitza sends it. */
function PushToast({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="sk-step-enter flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3"
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]">
        <BellRing size={15} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-[rgb(var(--fg-muted))]">Skitza · now</p>
        <p className="mt-0.5 text-[13px] leading-snug text-[rgb(var(--fg-default))]">{text}</p>
      </div>
    </div>
  );
}

/** The producer's own screen: edge to edge on phones, a browser window on desktop. */
function ProducerWindow({
  children,
  push,
  flush = false,
}: {
  children: ReactNode;
  /** The notification that woke this screen. */
  push?: string;
  /** The screen brings its own page padding. */
  flush?: boolean;
}) {
  return (
    <div
      data-testid="simulation-producer-panel"
      // Transformed and isolated, so the live screens' fixed action bars pin to
      // this window instead of escaping to the real viewport.
      style={SCREEN_AREA_STYLE}
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {push ? (
          <div className="px-4 pt-4 sm:px-6">
            <PushToast text={push} />
          </div>
        ) : null}
        {flush ? (
          children
        ) : (
          <div className={`px-4 pb-6 sm:px-6 ${push ? "pt-3" : "pt-5"}`}>{children}</div>
        )}
      </div>
    </div>
  );
}

function ClosingCard({
  frame,
  links,
  copied,
  onCopy,
}: {
  frame: SimulationFrame;
  links: SimulationLinks;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-[520px] flex-col items-center justify-center px-6 text-center">
      <h3 className="font-display text-[36px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance text-white sm:text-[46px]">
        {frame.caption.replace(/\.$/, "")}
        <span className="text-[rgb(var(--brand-primary))]">.</span>
      </h3>
      <p className="mt-4 max-w-[36ch] text-[16px] leading-relaxed text-white/70">{frame.detail}</p>
      <Link
        href={links.bringActiveWork}
        className="ob-press mt-9 inline-flex min-h-[52px] w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-6 text-[15px] font-bold text-[rgb(var(--bg-sidebar))] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:w-auto sm:min-w-[280px]"
      >
        Bring in your active work
      </Link>
      <div className="mt-5 flex items-center gap-6 text-[14px] font-semibold text-white/70">
        <button
          type="button"
          onClick={onCopy}
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
      <p className="mt-10 text-[12px] text-white/40">
        {SIMULATION_LABEL}. Nothing was sent or saved.
      </p>
    </div>
  );
}

function Progress({
  frames,
  current,
}: {
  frames: readonly SimulationFrame[];
  current: SimulationFrame;
}) {
  const done = current.side === "closing";
  return (
    <ol aria-hidden className="flex w-full items-center gap-[3px]">
      {frames.map((candidate) => (
        <li
          key={candidate.id}
          className={`h-[3px] flex-1 rounded-full transition-colors ${
            candidate.id === current.id
              ? "bg-white"
              : done || (candidate.step ?? 0) < (current.step ?? 0)
                ? "bg-white/75"
                : "bg-white/25"
          }`}
        />
      ))}
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
  const numbered = useMemo(
    () => model.frames.filter((candidate) => candidate.step !== null),
    [model],
  );
  const stepCount = numbered.length;
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setCopied(false);
    captureProductEvent("simulation_started", { steps: stepCount, product: input.product.id });
  }, [open, stepCount, input.product.id]);

  useEffect(() => {
    if (!open) return;
    const current = model.frames[index];
    if (!current) return;
    if (current.side === "closing") {
      captureProductEvent("simulation_completed", { steps: stepCount });
      return;
    }
    captureProductEvent("simulation_step", { step: current.step ?? 0, frame: current.id });
  }, [open, index, model, stepCount]);

  const activeFrame = model.frames[index];
  if (!activeFrame) return null;
  // Declared non-null so the hoisted handlers below keep the narrowing.
  const frame: SimulationFrame = activeFrame;
  const lastIndex = model.frames.length - 1;
  const isClosing = frame.side === "closing";
  const isArtist = frame.side === "artist";

  function goTo(nextIndex: number) {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setIndex(Math.max(0, Math.min(lastIndex, nextIndex)));
  }

  function goNext() {
    if (isClosing) {
      handleOpenChange(false);
      return;
    }
    goTo(index + 1);
  }

  function goBack() {
    goTo(index - 1);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !isClosing) {
      captureProductEvent("simulation_exited_early", { step: frame.step ?? 0, frame: frame.id });
    }
    onOpenChange(nextOpen);
  }

  // Both producer frames advance on the producer's own decision, after a beat
  // that lets the live screen show its own decided state first.
  function advanceAfterDecision() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      setIndex((current) => Math.min(lastIndex, current + 1));
    }, 700);
  }

  function handleRequestDecision(decision: "approve" | "decline") {
    if (decision !== "approve") return;
    advanceAfterDecision();
  }

  function handleProofDecision(decision: PreviewPaymentProofDecision) {
    if (decision.kind !== "confirm") return;
    advanceAfterDecision();
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
    }
  }

  // Stories gesture on the inert artist frames: right side advances, left side
  // goes back. Producer frames carry real controls, so they keep their clicks.
  function handleStoryTap(event: MouseEvent<HTMLDivElement>) {
    if (!isArtist) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    const ratio = (event.clientX - bounds.left) / bounds.width;
    if (ratio < 0.3) goBack();
    else goNext();
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

  function renderFrame(current: SimulationFrame): ReactNode {
    const { product, producer } = model;
    switch (current.id) {
      case "store":
        return (
          <ArtistDevice tab="store">
            <div className="space-y-4 px-4 pt-4">
              <ProducerHero producerName={producer.name} producerLogoUrl={model.producerLogoUrl} />
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
          </ArtistDevice>
        );
      case "approve":
        return (
          <ProducerWindow push={`${SIMULATED_ARTIST.name} asked to book ${product.name}.`}>
            <PurchaseRequestReview
              id={SIMULATION_IDS.purchaseRequest}
              initialStatus="pending"
              initialProjectId={null}
              targetProjects={[]}
              artistName={SIMULATED_ARTIST.name}
              artistEmail={model.request.artistEmail}
              productName={product.name}
              total={model.request.totalLabel}
              totalCaption="Proposal total"
              submittedAt={model.request.submittedAtLabel}
              reference={SIMULATION_IDS.requestRef}
              brief={model.request.brief}
              onPreviewDecision={handleRequestDecision}
            >
              <PurchaseRequestCommercialDetails
                commercialTerms={{ kind: "proposal", snapshot: model.request.snapshot }}
              />
            </PurchaseRequestReview>
          </ProducerWindow>
        );
      case "agreement":
        return (
          <ActedFrame>
            {(acted) => (
              <ArtistDevice revealSelector={SIMULATION_AGREE_SELECTOR}>
                <ReviewAgreeScreen
                  key={acted ? "accepted" : "reading"}
                  product={{ ...product, paymentPlans: model.storyPlans }}
                  producer={producer}
                  terms={buildAgreementTerms(producer.name, product.includes)}
                  previewSentHref={INERT_HREF}
                  previewReference={SIMULATION_IDS.requestRef}
                  previewTax={{ mode: model.taxMode, ratePct: model.taxRatePct }}
                  defaultAccepted={acted}
                />
              </ArtistDevice>
            )}
          </ActedFrame>
        );
      case "pay":
        return (
          <ArtistDevice>
            <PaymentInstructionsScreen
              producerName={producer.name}
              amountDueNowCents={model.dueNowCents}
              currency={model.currency}
              paymentDetails={model.paymentDetails}
              productName={product.name}
              planLabel={model.planLabel}
              previewProofHref={INERT_HREF}
            />
          </ArtistDevice>
        );
      case "verify":
        return (
          <ProducerWindow
            push={`${SIMULATED_ARTIST.name} sent a payment proof for ${SIMULATED_ARTIST.projectTitle}.`}
          >
            <PaymentProofReview
              review={model.proofReview}
              onPreviewDecision={handleProofDecision}
            />
          </ProducerWindow>
        );
      case "music":
        return (
          <ActedFrame>
            {(acted) => (
              <ArtistDevice tab="music" revealSelector={SIMULATION_NOTE_SELECTOR}>
                <RuntimeStatePreviewProvider identity={SIMULATION_ARTIST_IDENTITY}>
                  <SongPage
                    key={acted ? "approved" : "reviewing"}
                    role="artist"
                    embedded
                    data={acted ? model.song.approved : model.song.data}
                    actions={SIMULATION_SONG_ACTIONS}
                  />
                </RuntimeStatePreviewProvider>
              </ArtistDevice>
            )}
          </ActedFrame>
        );
      case "sessions":
        return (
          <ActedFrame>
            {(acted) => (
              <ArtistDevice tab="sessions">
                <RuntimeStatePreviewProvider identity={SIMULATION_ARTIST_IDENTITY}>
                  {acted ? (
                    <div className="space-y-4 px-4 pt-4">
                      <ConfirmationHero session={model.session.item} />
                      <Suspense fallback={null}>
                        <MySessionsScreen
                          sessions={[model.session.item]}
                          allowances={[model.session.allowance]}
                          nowISO={model.session.nowISO}
                          previewOnly
                        />
                      </Suspense>
                    </div>
                  ) : (
                    <BookingClient
                      activeStudioId={SIMULATION_IDS.studio}
                      availability={model.booking.availability}
                      studios={model.booking.studios}
                      activePackages={model.booking.activePackages}
                      initialSessionAllowanceId={model.booking.allowanceId}
                      rescheduleSessionId={null}
                    />
                  )}
                </RuntimeStatePreviewProvider>
              </ArtistDevice>
            )}
          </ActedFrame>
        );
      case "dashboard":
        return (
          <ProducerWindow
            flush
            push={`${SIMULATED_ARTIST.name} approved ${SIMULATED_ARTIST.projectTitle} v2.`}
          >
            <RuntimeStatePreviewProvider identity={SIMULATION_PRODUCER_IDENTITY}>
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
            </RuntimeStatePreviewProvider>
          </ProducerWindow>
        );
      case "closing":
        return (
          <ClosingCard
            frame={current}
            links={links}
            copied={copied}
            onCopy={() => {
              void copyLink();
            }}
          />
        );
      default:
        return null;
    }
  }

  const nextLabel = index === lastIndex - 1 ? "Finish" : "Next";
  const identity = isArtist
    ? {
        initial: SIMULATED_ARTIST.firstName.charAt(0),
        name: SIMULATED_ARTIST.firstName,
        logoUrl: null,
      }
    : { initial: model.producer.initials.charAt(0), name: "You", logoUrl: model.producerLogoUrl };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgb(17_16_9/0.72)]" />
        <DialogPrimitive.Content
          aria-describedby="first-artist-simulation-description"
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-[65] flex h-[100dvh] flex-col bg-[rgb(var(--bg-sidebar))] text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Watch your first artist</DialogPrimitive.Title>
          <DialogPrimitive.Description id="first-artist-simulation-description" className="sr-only">
            A simulation with a fictional artist using your real product. {SIMULATION_LABEL}.
            Nothing is sent or saved.
          </DialogPrimitive.Description>

          {/* Top: hairline progress, identity row, close. */}
          <div className="shrink-0 px-3 pt-[max(env(safe-area-inset-top),10px)] lg:px-8 lg:pt-5">
            <div className="lg:hidden">
              <Progress frames={numbered} current={frame} />
            </div>
            <div className="flex h-12 items-center justify-between gap-3">
              {isClosing ? (
                <span />
              ) : (
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar initial={identity.initial} logoUrl={identity.logoUrl} />
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-[14px] font-semibold text-white">{identity.name}</span>
                    <span className="truncate text-[12px] text-white/50">{SIMULATION_LABEL}</span>
                  </div>
                </div>
              )}
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  aria-label="Close simulation"
                  className="ob-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
                >
                  <X size={20} strokeWidth={2} aria-hidden />
                </button>
              </DialogPrimitive.Close>
            </div>
          </div>

          {isClosing ? (
            <div className="min-h-0 flex-1">{renderFrame(frame)}</div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-center lg:gap-14 lg:px-12 lg:pb-8">
              {/* Narration: bottom bar on phones, left column on desktop. The
                  desktop block has a fixed height so the progress strip and
                  the buttons stay put while captions change length. */}
              <div className="order-2 shrink-0 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] lg:order-1 lg:w-[400px] lg:px-0 lg:pt-0 lg:pb-0">
                <div className="lg:flex lg:h-[400px] lg:flex-col">
                  <div className="hidden lg:block">
                    <Progress frames={numbered} current={frame} />
                    <p
                      data-testid="simulation-step"
                      className="mt-3 text-[12px] font-medium text-white/50"
                    >
                      {frame.step !== null ? `${String(frame.step)} / ${String(stepCount)}` : ""}
                    </p>
                  </div>
                  <p
                    key={frame.id}
                    data-testid="simulation-caption"
                    aria-live="polite"
                    className="sk-step-enter font-display text-[19px] leading-[1.2] font-bold tracking-[-0.02em] text-balance text-white lg:mt-3 lg:text-[32px] lg:leading-[1.1] lg:tracking-[-0.03em]"
                  >
                    {frame.caption}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-white/55 lg:mt-3 lg:text-[15px] lg:leading-relaxed lg:text-white/60">
                    {frame.detail}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2 lg:mt-auto lg:justify-start">
                    <button
                      type="button"
                      onClick={goBack}
                      aria-label="Back"
                      className={`ob-press inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/20 text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none ${
                        index === 0 ? "invisible" : ""
                      }`}
                    >
                      <ChevronLeft size={20} aria-hidden />
                    </button>
                    {/* A phone already advances on a tap, so the control is
                        just an arrow there and a labelled button on desktop.
                        The accessible name stays the same at both widths. */}
                    <button
                      type="button"
                      onClick={goNext}
                      aria-label={nextLabel}
                      className="ob-press inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none lg:h-auto lg:min-h-12 lg:w-auto lg:min-w-[180px] lg:rounded-[var(--radius-lg)] lg:px-6"
                    >
                      <span className="hidden text-[15px] font-bold lg:inline">{nextLabel}</span>
                      <ChevronRight className="lg:hidden" size={20} aria-hidden />
                    </button>
                  </div>
                  <p className="mt-4 hidden text-[12px] text-white/35 lg:block">
                    Use the arrow keys, or tap the phone.
                  </p>
                </div>
              </div>

              {/* The screen. */}
              <div
                role="presentation"
                onClick={handleStoryTap}
                className={`order-1 min-h-0 flex-1 lg:order-2 lg:flex lg:items-center lg:justify-center ${
                  isArtist ? "cursor-pointer" : ""
                }`}
              >
                <div key={frame.id} className="sk-step-enter h-full w-full">
                  {renderFrame(frame)}
                </div>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
