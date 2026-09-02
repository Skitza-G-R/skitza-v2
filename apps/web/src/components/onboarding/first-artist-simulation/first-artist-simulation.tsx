"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, BellRing, Check, Copy, FolderInput, Lock, X } from "lucide-react";
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

import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { ProfessionalProductDetail } from "~/components/artist/purchase/professional-product-detail";
import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
import { PurchaseRequestScreen } from "~/components/artist/purchase/purchase-request-screen";
import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { ProducerHero } from "~/components/artist/store/producer-hero";
import {
  PaymentProofReview,
  type PreviewPaymentProofDecision,
} from "~/components/dashboard/payments/payment-proof-review";
import {
  LiquidGlassBottomNav,
  type LiquidGlassBottomNavTab,
} from "~/components/nav/liquid-glass-bottom-nav";
import { formatMoney } from "~/lib/format/money";
import { captureProductEvent } from "~/lib/observability/product-events";

import {
  buildSimulation,
  SIMULATED_ARTIST,
  SIMULATION_IDS,
  SIMULATION_LABEL,
  type SimulationFrame,
  type SimulationInput,
  type SimulationModel,
} from "./simulation-model";

// "Watch your first artist" (SK-298): a render-only walkthrough that plays the
// producer's REAL first product through the live artist screens with one
// fictional artist, then flips to the producer side. It never calls a
// mutation: the artist frames are inert storyboards and the producer frames
// only feed the preview callbacks the screens already expose for the
// development gallery.
//
// Chrome follows the focused-process convention: one slim row (close,
// progress, step counter), one caption, the device, one primary action.

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
// A transformed, isolated container turns that into "fixed inside the device",
// and the viewport-height token makes their 100dvh fill that area instead.
const SCREEN_AREA_STYLE = {
  "--sk-viewport-height": "100%",
  "--sk-viewport-offset-top": "0px",
  transform: "translateZ(0)",
  isolation: "isolate",
} as CSSProperties;

// Dev-gallery hash targets for the screens' preview navigation props. The
// frames are inert, so nothing can follow them; they only satisfy the props.
const INERT_HREF = "#simulation";

// The standing artist screens (Store, product detail) sit above the artist
// app's bottom tabs on phones; their sticky call to action already leaves room
// for that bar, so the device renders the real tab surface in the same place.
const ARTIST_TABS: readonly LiquidGlassBottomNavTab<
  "home" | "music" | "sessions" | "payments" | "store"
>[] = [
  { id: "home", label: "Home", href: INERT_HREF, icon: "home", active: false, prefetch: false },
  { id: "music", label: "Music", href: INERT_HREF, icon: "music", active: false, prefetch: false },
  {
    id: "sessions",
    label: "Sessions",
    href: INERT_HREF,
    icon: "calendar",
    active: false,
    prefetch: false,
  },
  {
    id: "payments",
    label: "Payments",
    href: INERT_HREF,
    icon: "payments",
    active: false,
    prefetch: false,
  },
  { id: "store", label: "Store", href: INERT_HREF, icon: "store", active: true, prefetch: false },
];

const DEVICE_WIDTH = "sm:w-[420px]";
const PANEL_WIDTH = "sm:max-w-[920px]";

function money(cents: number, currency: string): string {
  return formatMoney(cents, currency, { withCents: cents % 100 !== 0 });
}

function StatusStrip({ side }: { side: string }) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between gap-3 bg-[rgb(var(--bg-sidebar))] px-3.5 font-mono text-[9.5px] font-bold tracking-[0.14em] text-white/55 uppercase">
      <span className="hidden truncate min-[380px]:inline">{side}</span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[rgb(var(--brand-primary))]">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
        {SIMULATION_LABEL}
      </span>
    </div>
  );
}

function ArtistDevice({
  children,
  standing = false,
}: {
  children: ReactNode;
  /** Store-side screens scroll inside the device and show the artist tabs on phones. */
  standing?: boolean;
}) {
  return (
    <div
      inert
      aria-hidden
      data-testid="simulation-artist-frame"
      className={`relative mx-auto flex h-full w-full max-w-[430px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] shadow-[0_24px_60px_rgb(0_0_0/0.45)] sm:h-[min(76vh,760px)] ${DEVICE_WIDTH}`}
    >
      <StatusStrip side={`${SIMULATED_ARTIST.firstName}'s phone`} />
      <div className="relative min-h-0 flex-1 overflow-hidden" style={SCREEN_AREA_STYLE}>
        {standing ? (
          <>
            <div className="h-full overflow-y-auto">
              {children}
              {/* In-flow spacer, not padding: the detail screen's sticky call to
                  action measures its 4.75rem offset from the scrollport's content
                  edge, so padding here would push it above the tabs. */}
              <div aria-hidden className="h-[4.75rem] lg:h-5" />
            </div>
            <div className="lg:hidden">
              <LiquidGlassBottomNav
                ariaLabel="Artist app tabs"
                tabs={ARTIST_TABS}
                position="fixed"
              />
            </div>
          </>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function ProducerPanel({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="simulation-producer-panel"
      className={`mx-auto flex h-auto max-h-full w-full flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] shadow-[0_24px_60px_rgb(0_0_0/0.45)] sm:h-[min(76vh,760px)] ${PANEL_WIDTH}`}
    >
      <StatusStrip side="Your dashboard" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">{children}</div>
    </div>
  );
}

function NeedsYouFrame({ model, onReview }: { model: SimulationModel; onReview: () => void }) {
  return (
    <div className="mx-auto max-w-[620px] space-y-3">
      <div
        role="status"
        className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3"
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]">
          <BellRing size={15} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold tracking-[0.14em] whitespace-nowrap text-[rgb(var(--fg-muted))] uppercase">
            Skitza · now
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-[rgb(var(--fg-default))]">
            {SIMULATED_ARTIST.name} sent a payment proof for {SIMULATED_ARTIST.projectTitle}.
          </p>
        </div>
      </div>

      <section
        aria-labelledby="simulation-needs-you-heading"
        className="rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
      >
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
          Needs you
        </p>
        <h3
          id="simulation-needs-you-heading"
          className="font-display mt-1 text-[22px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
        >
          1 thing needs you<span className="text-[rgb(var(--brand-primary))]">.</span>
        </h3>
        <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.06)] px-3.5 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[14px] font-bold text-[rgb(var(--fg-default))]">
              <span
                aria-hidden
                className="ob-alive-dot h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
              />
              {SIMULATED_ARTIST.name} sent a payment proof
            </p>
            <p className="mt-0.5 pl-4 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
              {SIMULATED_ARTIST.projectTitle} · {model.product.name} ·{" "}
              {money(model.dueNowCents, model.currency)} of{" "}
              {money(model.totalCents, model.currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={onReview}
            className="ob-press inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[12.5px] font-bold text-[rgb(var(--bg-background))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
          >
            Review
            <ArrowRight size={14} aria-hidden />
          </button>
        </div>
      </section>
    </div>
  );
}

function OutcomeFrame({ model }: { model: SimulationModel }) {
  const fullyPaid = model.remainingCents === 0;
  const rows: { icon: typeof Check; tone: "good" | "wait"; title: string; detail: string }[] = [
    {
      icon: Check,
      tone: "good",
      title: `${SIMULATED_ARTIST.projectTitle} is active`,
      detail: `Songs, versions, comments and sessions for ${SIMULATED_ARTIST.firstName} live here from now on.`,
    },
    {
      icon: Check,
      tone: "good",
      title: `${money(model.dueNowCents, model.currency)} recorded`,
      detail: "Confirmed by you, once. It shows on her side too.",
    },
  ];
  if (!fullyPaid) {
    rows.push({
      icon: Lock,
      tone: "wait",
      title: `${money(model.remainingCents, model.currency)} still to come`,
      detail:
        model.finalPaymentTrigger === "artist_approval"
          ? "Due only when she approves the final version. Skitza reminds her, not you."
          : "Due monthly from her first payment. Skitza sends the reminders.",
    });
  }
  rows.push(
    fullyPaid
      ? {
          icon: Check,
          tone: "good",
          title: "Downloads unlocked",
          detail: "Fully paid, so her final files are hers to download.",
        }
      : {
          icon: Lock,
          tone: "wait",
          title: "Downloads stay locked",
          detail: "They unlock the moment the last payment is confirmed.",
        },
  );

  return (
    <div className="mx-auto max-w-[620px]">
      <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
        Project · {SIMULATED_ARTIST.projectTitle}
      </p>
      <h3 className="font-display mt-1 text-[24px] leading-tight font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] sm:text-[28px]">
        One place. No chasing<span className="text-[rgb(var(--brand-primary))]">.</span>
      </h3>
      <ul className="mt-5 divide-y divide-[rgb(var(--border-subtle))] rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
        {rows.map(({ icon: Icon, tone, title, detail }) => (
          <li key={title} className="flex items-start gap-3 px-4 py-3.5">
            <span
              className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                tone === "good"
                  ? "bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]"
                  : "bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]"
              }`}
            >
              <Icon size={15} strokeWidth={2.4} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-[rgb(var(--fg-default))]">{title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                {detail}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
        You get a push for every one of these moments, on your phone and in the desktop app.
      </p>
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
    <div className="mx-auto flex h-full w-full max-w-[520px] flex-col items-center justify-center px-2 text-center">
      <span className="inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary)/0.4)] px-2.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
        {SIMULATION_LABEL}
      </span>
      <h3 className="font-display mt-6 text-[34px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance text-white sm:text-[44px]">
        {frame.caption.replace(/\.$/, "")}
        <span className="text-[rgb(var(--brand-primary))]">.</span>
      </h3>
      <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-white/70">{frame.detail}</p>
      <div className="mt-8 flex w-full flex-col gap-2.5">
        <Link
          href={links.bringActiveWork}
          className="ob-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-extrabold text-[rgb(var(--bg-sidebar))] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <FolderInput size={16} aria-hidden />
          Bring in your active work
        </Link>
        <button
          type="button"
          onClick={onCopy}
          className="ob-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-white/12 bg-white/[0.06] px-5 text-[14px] font-bold text-white transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? "Link copied" : "Copy my link"}
        </button>
        <Link
          href={links.dashboard}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-white/65 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          Open dashboard
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <p className="mt-5 text-[12px] text-white/45">
        Nothing was sent or saved during this simulation.
      </p>
    </div>
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
  const contentWidth = frame.side === "artist" ? DEVICE_WIDTH : PANEL_WIDTH;

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

  function handleProofDecision(decision: PreviewPaymentProofDecision) {
    if (decision.kind !== "confirm") return;
    const outcomeIndex = model.frames.findIndex((candidate) => candidate.id === "outcome");
    if (outcomeIndex < 0) return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    // Let the review screen show its own "confirmed" state for a beat first.
    advanceTimer.current = setTimeout(() => {
      setIndex(outcomeIndex);
    }, 700);
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
          <ArtistDevice standing>
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
      case "detail":
        return (
          <ArtistDevice standing>
            <ProfessionalProductDetail
              product={product}
              studioId={SIMULATION_IDS.studio}
              activePurchase={null}
              requestHrefOverride={INERT_HREF}
            />
          </ArtistDevice>
        );
      case "request":
        return (
          <ArtistDevice>
            <PurchaseRequestScreen
              productId={product.id}
              productName={product.name}
              producerName={producer.name}
              studioId={SIMULATION_IDS.studio}
              amountCents={model.totalCents}
              currency={model.currency}
              targetProjects={[]}
              previewSentHref={INERT_HREF}
              backHrefOverride={INERT_HREF}
            />
          </ArtistDevice>
        );
      case "request-sent":
        return (
          <ArtistDevice>
            <RequestSentScreen producer={producer} requestRef={SIMULATION_IDS.requestRef} />
          </ArtistDevice>
        );
      case "choose-plan":
        return (
          <ArtistDevice>
            <ChoosePlanScreen
              productId={product.id}
              productName={product.name}
              producerName={producer.name}
              purchaseRequestId={SIMULATION_IDS.purchaseRequest}
              options={model.planOptions}
              currency={model.currency}
              previewNextHref={INERT_HREF}
            />
          </ArtistDevice>
        );
      case "agreement":
        return (
          <ArtistDevice>
            <ReviewAgreeScreen
              product={{ ...product, paymentPlans: model.storyPlans }}
              producer={producer}
              terms={buildAgreementTerms(producer.name, product.includes)}
              previewSentHref={INERT_HREF}
              previewReference={SIMULATION_IDS.requestRef}
              previewTax={{ mode: model.taxMode, ratePct: model.taxRatePct }}
            />
          </ArtistDevice>
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
      case "proof":
        return (
          <ArtistDevice>
            <UploadProofScreen
              productName={product.name}
              producerName={producer.name}
              previewOnly
              currency={model.currency}
              installmentPosition={1}
              paidCents={0}
              totalCents={model.totalCents}
              thisProofCents={model.dueNowCents}
            />
          </ArtistDevice>
        );
      case "needs-you":
        return (
          <ProducerPanel>
            <NeedsYouFrame
              model={model}
              onReview={() => {
                goTo(index + 1);
              }}
            />
          </ProducerPanel>
        );
      case "verify":
        return (
          <ProducerPanel>
            <PaymentProofReview
              review={model.proofReview}
              onPreviewDecision={handleProofDecision}
            />
          </ProducerPanel>
        );
      case "outcome":
        return (
          <ProducerPanel>
            <OutcomeFrame model={model} />
          </ProducerPanel>
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

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgb(17_16_9/0.72)] backdrop-blur-[4px]" />
        <DialogPrimitive.Content
          aria-describedby="first-artist-simulation-description"
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-[65] flex h-[100dvh] flex-col bg-[rgb(var(--bg-sidebar))] text-white outline-none"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_46%_at_50%_42%,rgb(var(--brand-primary)/0.12),transparent_72%)]"
          />
          <DialogPrimitive.Title className="sr-only">Watch your first artist</DialogPrimitive.Title>
          <DialogPrimitive.Description id="first-artist-simulation-description" className="sr-only">
            A simulation with a fictional artist using your real product. {SIMULATION_LABEL}.
            Nothing is sent or saved.
          </DialogPrimitive.Description>

          <div className="relative flex h-14 shrink-0 items-center gap-4 px-3 sm:px-6">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close simulation"
                className="ob-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
              >
                <X size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </DialogPrimitive.Close>
            <ol aria-hidden className="flex min-w-0 flex-1 items-center gap-1">
              {numbered.map((candidate) => (
                <li
                  key={candidate.id}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    candidate.id === frame.id
                      ? "bg-[rgb(var(--brand-primary))]"
                      : isClosing || (candidate.step ?? 0) < (frame.step ?? 0)
                        ? "bg-white/60"
                        : "bg-white/18"
                  }`}
                />
              ))}
            </ol>
            <span
              data-testid="simulation-step"
              className="w-14 shrink-0 text-right font-mono text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-white/55"
            >
              {frame.step !== null ? `${String(frame.step)} / ${String(stepCount)}` : ""}
            </span>
          </div>

          {isClosing ? null : (
            <div className="relative shrink-0 px-5 pt-1 pb-3 sm:px-6 sm:pb-4 sm:text-center">
              <div className="mx-auto max-w-[44ch]">
                <p
                  key={frame.id}
                  data-testid="simulation-caption"
                  aria-live="polite"
                  className="sk-step-enter text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance text-white sm:text-[19px]"
                >
                  {frame.caption}
                </p>
                <p className="mt-1 text-[13px] leading-snug text-white/60 [@media(max-height:680px)]:hidden">
                  {frame.detail}
                </p>
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1 px-3 sm:px-6">
            <div key={frame.id} className="sk-step-enter h-full">
              {renderFrame(frame)}
            </div>
          </div>

          {isClosing ? (
            <div className="h-[max(env(safe-area-inset-bottom),16px)] shrink-0" />
          ) : (
            <div className="relative shrink-0 px-3 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] sm:px-6 sm:pb-6">
              <div
                className={`mx-auto flex w-full max-w-[430px] items-center justify-between gap-3 ${contentWidth}`}
              >
                <button
                  type="button"
                  onClick={goBack}
                  disabled={index === 0}
                  className="ob-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-3 text-[13px] font-semibold text-white/70 hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowLeft size={15} aria-hidden />
                  Back
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="ob-press inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-6 text-[14px] font-bold text-[rgb(var(--bg-sidebar))] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                >
                  {index === lastIndex - 1 ? "Finish" : "Next"}
                  <ArrowRight size={15} aria-hidden />
                </button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
