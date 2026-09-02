"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Check,
  Copy,
  FolderInput,
  Lock,
  Sparkles,
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
  type ReactNode,
} from "react";

import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
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
// mutation: the artist frames are inert storyboards and the two producer
// frames only feed the preview callbacks the screens already expose for the
// development gallery.

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
// A transformed, isolated container turns that into "fixed inside the phone",
// and the viewport-height token makes their 100dvh fill the frame instead.
const ARTIST_FRAME_STYLE = {
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
// for that bar, so the frame renders the real tab surface in the same place.
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

function money(cents: number, currency: string): string {
  return formatMoney(cents, currency, { withCents: cents % 100 !== 0 });
}

function SimulationChip() {
  return (
    <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary)/0.45)] bg-[rgb(var(--brand-primary)/0.12)] px-2.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
      {SIMULATION_LABEL}
    </span>
  );
}

function ArtistFrame({
  children,
  standing = false,
}: {
  children: ReactNode;
  /** Store-side screens scroll inside the frame and show the artist tabs on phones. */
  standing?: boolean;
}) {
  return (
    <div
      inert
      aria-hidden
      data-testid="simulation-artist-frame"
      className="relative mx-auto h-full w-full overflow-hidden bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] sm:h-[min(78vh,760px)] sm:w-[430px] sm:rounded-[32px] sm:border-[6px] sm:border-white/10 sm:shadow-[0_30px_80px_rgb(0_0_0/0.5)]"
      style={ARTIST_FRAME_STYLE}
    >
      {standing ? (
        <>
          <div className="h-full overflow-y-auto px-4 pt-5">
            {children}
            {/* In-flow spacer, not padding: the detail screen's sticky call to
                action measures its 4.75rem offset from the scrollport's content
                edge, so padding here would push it above the tabs. */}
            <div aria-hidden className="h-[4.75rem] lg:h-5" />
          </div>
          <div className="lg:hidden">
            <LiquidGlassBottomNav ariaLabel="Artist app tabs" tabs={ARTIST_TABS} position="fixed" />
          </div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

function ProducerPanel({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="simulation-producer-panel"
      className="mx-auto h-full w-full max-w-[960px] overflow-y-auto bg-[rgb(var(--bg-background))] px-4 py-5 text-[rgb(var(--fg-default))] sm:h-[min(78vh,760px)] sm:rounded-[var(--radius-xl)] sm:border sm:border-white/10 sm:px-6 sm:py-6"
    >
      {children}
    </div>
  );
}

function NeedsYouFrame({ model, onReview }: { model: SimulationModel; onReview: () => void }) {
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div
        role="status"
        className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[var(--shadow-sm)]"
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]">
          <BellRing size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
            Push · Skitza · now
          </p>
          <p className="mt-0.5 text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
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
        <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.06)] px-3.5 py-3">
          <span
            aria-hidden
            className="ob-alive-dot h-2.5 w-2.5 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold text-[rgb(var(--fg-default))]">
              {SIMULATED_ARTIST.name} sent a payment proof
            </p>
            <p className="mt-0.5 truncate text-[12px] text-[rgb(var(--fg-muted))]">
              {SIMULATED_ARTIST.projectTitle} · {model.product.name} ·{" "}
              {money(model.dueNowCents, model.currency)} of{" "}
              {money(model.totalCents, model.currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={onReview}
            className="ob-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3.5 text-[12.5px] font-bold text-[rgb(var(--bg-background))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
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
    <div className="mx-auto max-w-[640px]">
      <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
        Project · {SIMULATED_ARTIST.projectTitle}
      </p>
      <h3 className="font-display mt-1 text-[24px] leading-tight font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] sm:text-[28px]">
        One place. No chasing<span className="text-[rgb(var(--brand-primary))]">.</span>
      </h3>
      <ul className="mt-5 space-y-2.5">
        {rows.map(({ icon: Icon, tone, title, detail }) => (
          <li
            key={title}
            className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5"
          >
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
        You get a push for every one of these moments, on your phone and on the desktop app.
      </p>
    </div>
  );
}

function ClosingFrame({
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
    <div className="mx-auto flex h-full w-full max-w-[560px] flex-col items-center justify-center px-4 text-center">
      <SimulationChip />
      <h3 className="font-display mt-5 text-[34px] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance text-white sm:text-[44px]">
        {frame.caption.replace(/\.$/, "")}
        <span className="text-[rgb(var(--brand-primary))]">.</span>
      </h3>
      <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-white/70">{frame.detail}</p>
      <div className="mt-8 flex w-full flex-col gap-2.5">
        <Link
          href={links.bringActiveWork}
          className="ob-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-extrabold text-[rgb(var(--bg-sidebar))] shadow-[0_12px_30px_rgb(var(--brand-primary)/0.24)] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <FolderInput size={16} aria-hidden />
          Bring in your active work
        </Link>
        <button
          type="button"
          onClick={onCopy}
          className="ob-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-white/15 bg-white/[0.07] px-5 text-[14px] font-bold text-white transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? "Link copied" : "Copy my link"}
        </button>
        <Link
          href={links.dashboard}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-white/70 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          Open dashboard
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <p className="mt-5 text-[12px] text-white/50">
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
  const stepCount = useMemo(
    () => model.frames.filter((candidate) => candidate.step !== null).length,
    [model],
  );
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

  const sideLabel =
    frame.side === "artist"
      ? `${SIMULATED_ARTIST.firstName}'s phone`
      : frame.side === "producer"
        ? "Your dashboard"
        : "Simulation over";

  function renderFrame(current: SimulationFrame): ReactNode {
    const { product, producer } = model;
    switch (current.id) {
      case "store":
        return (
          <ArtistFrame standing>
            <div className="space-y-5">
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
          </ArtistFrame>
        );
      case "detail":
        return (
          <ArtistFrame standing>
            <ProductDetailScreen
              product={product}
              producer={producer}
              productId={product.id}
              taxMode={model.taxMode}
              taxRatePct={model.taxRatePct}
              previewAgreeHref={INERT_HREF}
              onPreviewBack={() => undefined}
            />
          </ArtistFrame>
        );
      case "request-sent":
        return (
          <ArtistFrame>
            <RequestSentScreen producer={producer} requestRef={SIMULATION_IDS.requestRef} />
          </ArtistFrame>
        );
      case "choose-plan":
        return (
          <ArtistFrame>
            <ChoosePlanScreen
              productId={product.id}
              productName={product.name}
              producerName={producer.name}
              purchaseRequestId={SIMULATION_IDS.purchaseRequest}
              options={model.planOptions}
              currency={model.currency}
              previewNextHref={INERT_HREF}
            />
          </ArtistFrame>
        );
      case "agreement":
        return (
          <ArtistFrame>
            <ReviewAgreeScreen
              product={{ ...product, paymentPlans: model.storyPlans }}
              producer={producer}
              terms={buildAgreementTerms(producer.name, product.includes)}
              previewSentHref={INERT_HREF}
              previewReference={SIMULATION_IDS.requestRef}
              previewTax={{ mode: model.taxMode, ratePct: model.taxRatePct }}
            />
          </ArtistFrame>
        );
      case "pay":
        return (
          <ArtistFrame>
            <PaymentInstructionsScreen
              producerName={producer.name}
              amountDueNowCents={model.dueNowCents}
              currency={model.currency}
              paymentDetails={model.paymentDetails}
              productName={product.name}
              planLabel={model.planLabel}
              previewProofHref={INERT_HREF}
            />
          </ArtistFrame>
        );
      case "proof":
        return (
          <ArtistFrame>
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
          </ArtistFrame>
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
          <ClosingFrame
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
          <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.18)] text-[rgb(var(--brand-primary))]"
              >
                <Sparkles size={16} strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <DialogPrimitive.Title className="font-display truncate text-[15px] font-extrabold tracking-[-0.015em] text-white">
                  Watch your first artist
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  id="first-artist-simulation-description"
                  className="truncate text-[11.5px] text-white/60"
                >
                  {SIMULATION_LABEL} · nothing is sent or saved
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close simulation"
                className="ob-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-white/15 bg-white/[0.06] px-3 text-[12.5px] font-semibold text-white hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
              >
                <X size={15} strokeWidth={2.2} aria-hidden />
                <span className="hidden sm:inline">Close</span>
              </button>
            </DialogPrimitive.Close>
          </header>

          <div className="shrink-0 px-4 pt-3.5 pb-3 sm:px-6">
            <div className="mx-auto flex max-w-[960px] flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary))] uppercase">
                  {sideLabel}
                  {frame.step !== null
                    ? ` · Step ${String(frame.step)} of ${String(stepCount)}`
                    : ""}
                </p>
                {isClosing ? null : (
                  <>
                    <p
                      key={frame.id}
                      aria-live="polite"
                      className="sk-step-enter font-display mt-1 text-[17px] leading-tight font-extrabold tracking-[-0.02em] text-balance text-white sm:text-[21px]"
                    >
                      {frame.caption}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-snug text-white/65 sm:text-[13px]">
                      {frame.detail}
                    </p>
                  </>
                )}
              </div>
              {isClosing ? null : <SimulationChip />}
            </div>
          </div>

          <div className="min-h-0 flex-1 sm:px-6 sm:pb-2">
            <div key={frame.id} className="sk-step-enter h-full">
              {renderFrame(frame)}
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/10 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:px-6">
            <div className="mx-auto flex max-w-[960px] items-center justify-between gap-3">
              <button
                type="button"
                onClick={goBack}
                disabled={index === 0}
                className="ob-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] border border-white/15 bg-white/[0.06] px-3.5 text-[12.5px] font-semibold text-white hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ArrowLeft size={14} aria-hidden />
                Back
              </button>
              <ol aria-hidden className="hidden items-center gap-1.5 sm:flex">
                {model.frames
                  .filter((candidate) => candidate.step !== null)
                  .map((candidate) => (
                    <li
                      key={candidate.id}
                      className={`h-1.5 rounded-full transition-[width,background-color] ${
                        candidate.id === frame.id
                          ? "w-6 bg-[rgb(var(--brand-primary))]"
                          : (candidate.step ?? 0) < (frame.step ?? stepCount + 1)
                            ? "w-1.5 bg-white/70"
                            : "w-1.5 bg-white/25"
                      }`}
                    />
                  ))}
              </ol>
              <button
                type="button"
                onClick={goNext}
                className="ob-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[12.5px] font-extrabold text-[rgb(var(--bg-sidebar))] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
              >
                {isClosing ? "Close" : index === lastIndex - 1 ? "Finish" : "Next"}
                {isClosing ? null : <ArrowRight size={14} aria-hidden />}
              </button>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
