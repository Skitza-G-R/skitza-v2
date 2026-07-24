"use client";

import type { PaymentPlan } from "@skitza/db";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { planKey, requestPlanLabel } from "~/components/checkout/plan-picker-helpers";
import { ArrowRight, Check, ClockIcon, LockIcon } from "~/components/artist/funnel/funnel-icons";
import { Eyebrow, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { StickyNav } from "~/components/artist/sticky-nav";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import { applyTaxToCents, taxModeFootnote, type TaxMode } from "~/lib/tax-mode";
import { requestToBookAction } from "./actions";
import {
  coverGradient,
  formatPurchaseMoney,
  swatchGradient,
  type Producer,
  type PurchaseProduct,
  type PurchaseTargetProject,
} from "./purchase-data";
import { computeSongCountState, SongCountStepper, type SongCountState } from "./song-count-stepper";

function planLabel(plan: PaymentPlan, totalCents: number, currency: string): string {
  return requestPlanLabel(plan, totalCents, (cents) => formatPurchaseMoney(cents, currency));
}

function projectContext(project: PurchaseTargetProject): string {
  const lifecycle = project.lifecycleStatus === "active" ? "Active" : "Waiting for payment";
  const stage = project.workflowStage.charAt(0).toUpperCase() + project.workflowStage.slice(1);
  const updated = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(project.updatedAtIso));
  return `${lifecycle} · ${stage} · Updated ${updated}`;
}

type ProductDetailScreenProps = {
  product: PurchaseProduct;
  producer: Producer;
  productId: string;
  studioId?: string;
  targetProjects?: PurchaseTargetProject[];
  taxMode?: TaxMode;
  taxRatePct?: number;
  /** Deprecated dev-gallery prop. It no longer restricts a second request. */
  pendingRequest?: boolean;
  /** Producer Review only: renders the real screen with submission disabled. */
  previewMode?: boolean;
  /** Producer Review back action; live artist routes use Store navigation. */
  onPreviewBack?: () => void;
  /** Dev-gallery navigation only; live routes create the request first. */
  previewAgreeHref?: string | undefined;
};

export function ProductDetailScreen({
  product,
  producer,
  productId,
  studioId,
  targetProjects = [],
  taxMode = "tax_free",
  taxRatePct = 0,
  previewMode = false,
  onPreviewBack,
  previewAgreeHref,
}: ProductDetailScreenProps) {
  const router = useRouter();
  const online = useOnlineStatus();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const operationKeyRef = useRef<string | null>(null);
  const isPerSong = product.pricingModel === "per_song";
  const volumeTiers = useMemo(
    () =>
      isPerSong && product.volumeTiers.length === 0
        ? [{ minQty: 1, pricePerUnitCents: product.priceCents }]
        : product.volumeTiers,
    [isPerSong, product.priceCents, product.volumeTiers],
  );
  const [songState, setSongState] = useState<SongCountState>(() =>
    isPerSong
      ? computeSongCountState(1, volumeTiers)
      : {
          qty: 1,
          unitPriceCents: product.priceCents,
          totalCents: product.priceCents,
          savedCents: 0,
        },
  );
  const [targetKind, setTargetKind] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requiresLiveRequest = !previewAgreeHref;
  const royalty = royaltyTermsDisplay(product.royaltyTerms);
  const proposalSubtotal = isPerSong ? songState.totalCents : product.priceCents;
  const proposalTotal = applyTaxToCents(proposalSubtotal, taxMode, taxRatePct);
  const taxFootnote = taxModeFootnote(taxMode, taxRatePct);
  const targetIsReady = targetKind === "new" || projectId !== null;

  const updateSongState = useCallback((state: SongCountState) => {
    setSongState(state);
  }, []);

  async function sendRequest() {
    if (previewMode || sending || !targetIsReady) return;
    if (previewAgreeHref) {
      router.push(previewAgreeHref);
      return;
    }
    if (!online) {
      setError("Reconnect before sending. No purchase request has been created.");
      return;
    }

    setSending(true);
    setError(null);
    try {
      const operationKey = operationKeyRef.current ?? crypto.randomUUID();
      operationKeyRef.current = operationKey;
      const result = await requestToBookAction({
        productId,
        operationKey,
        ...(isPerSong ? { songQty: songState.qty } : {}),
        ...(targetKind === "existing" && projectId ? { projectId } : {}),
      });
      if (!result.ok) {
        setSending(false);
        setError(result.error);
        return;
      }
      operationKeyRef.current = null;
      router.push(
        withArtistStudio(
          `/artist/purchase/${productId}/sent?req=${result.purchaseRequestId}`,
          studioId,
        ),
      );
    } catch {
      setSending(false);
      setError("Couldn't send your request. Check your connection and try again.");
    }
  }

  return (
    <div
      ref={scrollRef}
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <StickyNav
        title={product.name}
        sub={producer.name || undefined}
        onBack={() => {
          if (onPreviewBack) {
            onPreviewBack();
            return;
          }
          router.push(withArtistStudio("/artist/store", studioId));
        }}
        scrollContainerRef={scrollRef}
        className="max-w-[440px]"
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
        <div
          className="relative h-[138px] overflow-hidden"
          style={{ background: coverGradient(producer.hue) }}
        >
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(17 16 9 / 0.18), transparent 50%, rgb(var(--bg-background)) 100%)",
            }}
          />
          <span className="label-eyebrow absolute bottom-3 left-[18px] text-white/80">
            {(producer.name || "Producer").toUpperCase()}
          </span>
        </div>

        <main className="flex-1 px-5 pt-[18px] pb-[184px]">
          <h1 className="sk-rise font-syne text-[26px] leading-[1.1] font-extrabold tracking-[-0.035em] [text-wrap:pretty] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
            {product.name}
          </h1>
          {product.tagline ? (
            <p className="sk-rise mt-2.5 text-[14px] leading-relaxed text-[rgb(var(--fg-secondary))]">
              {product.tagline}
            </p>
          ) : null}

          <section
            className="sk-rise mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-[18px] py-4 shadow-[var(--shadow-sm)]"
            aria-labelledby="proposal-price-heading"
          >
            <div
              id="proposal-price-heading"
              className="font-mono text-[9.5px] tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase"
            >
              Current proposal
            </div>
            <div className="font-amount mt-1.5 text-[36px] leading-none font-extrabold tracking-[-0.04em] text-[rgb(var(--fg-default))]">
              {formatPurchaseMoney(proposalTotal, product.currency)}
            </div>
            {taxFootnote ? (
              <div className="mt-1.5 font-mono text-[9.5px] font-medium tracking-[0.06em] text-[rgb(var(--fg-muted))] uppercase">
                {taxFootnote}
                {taxMode === "tax_added" ? (
                  <span>
                    {" "}
                    · {formatPurchaseMoney(proposalSubtotal, product.currency)} before tax
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
              <span>{product.durationLabel}</span>
              {product.unlimitedRevisions ? (
                <span>Unlimited revisions</span>
              ) : product.revisions > 0 ? (
                <span>
                  {String(product.revisions)} {product.revisions === 1 ? "revision" : "revisions"}
                </span>
              ) : null}
            </div>
          </section>

          {isPerSong ? (
            <section className="sk-rise mt-4" aria-labelledby="song-count-heading">
              <h2 id="song-count-heading" className="sr-only">
                Choose song quantity
              </h2>
              <SongCountStepper
                tiers={volumeTiers}
                currency={product.currency}
                taxMode={taxMode}
                taxRatePct={taxRatePct}
                onChange={updateSongState}
              />
            </section>
          ) : null}

          <div className="sk-rise mt-4 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3">
            <span
              className="font-syne flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-extrabold text-white"
              style={{ background: swatchGradient(producer.hue) }}
            >
              {producer.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                {producer.name}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
                Reviews every request personally
              </div>
            </div>
          </div>

          <fieldset className="sk-rise mt-5">
            <legend className="mb-2.5">
              <Eyebrow>Where should this work go?</Eyebrow>
            </legend>
            <div className="space-y-2.5">
              <label
                className="sk-press flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3.5"
                style={{
                  background:
                    targetKind === "new"
                      ? "rgb(var(--brand-primary) / 0.08)"
                      : "rgb(var(--bg-elevated))",
                  borderColor:
                    targetKind === "new" ? "rgb(var(--focus-ring))" : "rgb(var(--border-control))",
                }}
              >
                <input
                  type="radio"
                  name="purchase-target"
                  value="new"
                  checked={targetKind === "new"}
                  onChange={() => {
                    setTargetKind("new");
                    setError(null);
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand-primary))]"
                />
                <span>
                  <span className="block text-[14px] font-bold text-[rgb(var(--fg-default))]">
                    Start a new project
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                    Default choice. {producer.name} will create the project after acceptance.
                  </span>
                </span>
              </label>

              {targetProjects.length > 0 ? (
                <label
                  className="sk-press flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3.5"
                  style={{
                    background:
                      targetKind === "existing"
                        ? "rgb(var(--brand-primary) / 0.08)"
                        : "rgb(var(--bg-elevated))",
                    borderColor:
                      targetKind === "existing"
                        ? "rgb(var(--focus-ring))"
                        : "rgb(var(--border-control))",
                  }}
                >
                  <input
                    type="radio"
                    name="purchase-target"
                    value="existing"
                    checked={targetKind === "existing"}
                    onChange={() => {
                      setTargetKind("existing");
                      setError(null);
                    }}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand-primary))]"
                  />
                  <span>
                    <span className="block text-[14px] font-bold text-[rgb(var(--fg-default))]">
                      Add to an existing project
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                      Choose deliberately from projects with this same producer and client.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>

            {targetKind === "existing" ? (
              <div className="mt-3 space-y-2" role="radiogroup" aria-label="Existing project">
                {targetProjects.map((project) => {
                  const selected = project.id === projectId;
                  return (
                    <label
                      key={project.id}
                      className="sk-press flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] px-4 py-3"
                      style={{
                        borderColor: selected
                          ? "rgb(var(--focus-ring))"
                          : "rgb(var(--border-subtle))",
                      }}
                    >
                      <input
                        type="radio"
                        name="existing-project"
                        value={project.id}
                        checked={selected}
                        onChange={() => {
                          setProjectId(project.id);
                          setError(null);
                        }}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand-primary))]"
                      />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-bold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                          {project.title}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] leading-relaxed text-[rgb(var(--fg-muted))]">
                          {projectContext(project)}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {!projectId ? (
                  <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
                    Select the exact project before sending.
                  </p>
                ) : null}
              </div>
            ) : null}
          </fieldset>

          {product.includes.length > 0 || product.unlimitedRevisions || product.revisions > 0 ? (
            <section className="sk-rise mt-5" aria-labelledby="included-heading">
              <h2 id="included-heading" className="mb-3">
                <Eyebrow>What&apos;s included</Eyebrow>
              </h2>
              {product.includes.length > 0 ? (
                <ul className="flex list-none flex-col gap-[11px]">
                  {product.includes.map((line) => (
                    <li key={line} className="flex items-start gap-[11px]">
                      <span className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-text))]">
                        <Check width={12} height={12} />
                      </span>
                      <span className="text-[14px] leading-normal text-[rgb(var(--fg-secondary))]">
                        {line}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-[18px] text-[12.5px] text-[rgb(var(--fg-muted))]">
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon /> {product.durationLabel}
                </span>
                {product.unlimitedRevisions ? (
                  <span>Unlimited revisions</span>
                ) : product.revisions > 0 ? (
                  <span>
                    {String(product.revisions)} {product.revisions === 1 ? "revision" : "revisions"}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="sk-rise mt-5" aria-labelledby="rights-heading">
            <h2 id="rights-heading">
              <Eyebrow>Rights & royalties</Eyebrow>
            </h2>
            <dl className="mt-2.5 grid gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-4 py-3.5 text-[13px]">
              <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <dt className="font-semibold text-[rgb(var(--fg-muted))]">Master</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                  {royalty.master}
                </dd>
              </div>
              <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <dt className="font-semibold text-[rgb(var(--fg-muted))]">Composition</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                  {royalty.composition}
                </dd>
              </div>
            </dl>
            {product.royaltyTerms?.notes ? (
              <p className="mt-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-muted))]">
                {product.royaltyTerms.notes}
              </p>
            ) : null}
          </section>

          <section
            className="sk-rise mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
            aria-labelledby="payment-heading"
          >
            <h2 id="payment-heading">
              <Eyebrow>Enabled payment plans</Eyebrow>
            </h2>
            <ul className="mt-3 list-none divide-y divide-[rgb(var(--border-subtle))]">
              {product.paymentPlans.map((plan) => (
                <li
                  key={planKey(plan)}
                  className="py-2.5 text-[13px] text-[rgb(var(--fg-secondary))] first:pt-0 last:pb-0"
                >
                  {planLabel(plan, proposalTotal, product.currency)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
              If the producer approves, you choose one enabled plan before accepting the exact
              agreement.
            </p>
          </section>

          <div className="sk-rise mt-3.5 flex items-start gap-[11px] rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-[15px] py-[13px] text-[rgb(var(--fg-onsidebar))]">
            <span className="mt-px text-[rgb(var(--brand-primary))]">
              <LockIcon />
            </span>
            <span className="text-[12.5px] leading-[1.55]">
              Sending this request moves no money and accepts no agreement. The exact quantity,
              discount, tax, total, rights, rules, agreement, target, and plan freeze only when you
              accept after approval.
            </span>
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.1)] px-3.5 py-3 text-[12.5px] font-medium text-[rgb(var(--fg-danger-text))]"
            >
              {error}
            </p>
          ) : null}
          {!online && !previewMode && requiresLiveRequest ? (
            <p
              role="status"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-3.5 py-3 text-[12.5px] text-[rgb(var(--fg-secondary))]"
            >
              Reconnect to send this request. Your choices stay on this screen.
            </p>
          ) : null}
        </main>

        <div
          className="sk-safe-bottom sticky bottom-0 z-10 px-[18px] pt-3.5 pb-3.5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
          }}
        >
          <PrimaryCta
            onClick={() => {
              void sendRequest();
            }}
            disabled={previewMode || (!online && requiresLiveRequest) || !targetIsReady || sending}
            glow={!previewMode && (online || !requiresLiveRequest) && targetIsReady && !sending}
            ariaBusy={sending}
            sub={
              previewMode
                ? "Preview only · requests are disabled"
                : !online && requiresLiveRequest
                  ? "Reconnect to send this live request"
                  : sending
                    ? "Sending your request"
                    : targetIsReady
                      ? "No payment or acceptance yet"
                      : "Choose the exact existing project"
            }
          >
            {previewMode ? "Preview only" : sending ? "Sending…" : "Send request"} <ArrowRight />
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
