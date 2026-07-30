"use client";

import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";
import { CalendarClock, Check, Eye, Link2, Package2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setPackageActive } from "~/app/(producer)/dashboard/booking/actions";
import { ArtistProductPreview } from "~/app/(producer)/dashboard/store/artist-product-preview";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import type { VolumeTier } from "~/lib/pricing";
import type { TaxMode } from "~/lib/tax-mode";

export interface OnboardingReviewProduct {
  id: string;
  name: string;
  tagline: string;
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
  durationMin: number;
  sessionCount: number;
  deliverables: string[];
  revisions: number;
  unlimitedRevisions: boolean;
  paymentPlans: PaymentPlan[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string;
}

function CheckRow({
  icon: Icon,
  title,
  detail,
  editHref,
  previewMode,
}: {
  icon: typeof Link2;
  title: string;
  detail: string;
  editHref: string;
  previewMode: boolean;
}) {
  const suffix = previewMode ? "?__preview=1" : "";
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5">
      <span className="relative mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
        <Icon size={16} aria-hidden />
        <span className="absolute -right-1 -bottom-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]">
          <Check size={10} strokeWidth={3} aria-hidden />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13.5px] font-bold text-[rgb(var(--fg-default))]">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">{detail}</p>
      </div>
      <Link
        href={`${editHref}${suffix}`}
        className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-lg)] px-2.5 text-[12px] font-semibold text-[rgb(var(--brand-primary-dark))] hover:bg-[rgb(var(--brand-primary)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
      >
        Edit
      </Link>
    </div>
  );
}

export function ReviewStepClient({
  producerName,
  product,
  hoursNotNeeded,
  taxMode,
  taxRatePct,
  previewMode = false,
}: {
  producerName: string;
  product: OnboardingReviewProduct;
  hoursNotNeeded: boolean;
  taxMode: TaxMode;
  taxRatePct: number;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const previewSuffix = previewMode ? "?__preview=1" : "";
  const includesSessions = product.durationMin > 0;

  function publish() {
    setError(null);
    if (previewMode) {
      router.push(`/onboarding/complete${previewSuffix}`);
      return;
    }
    if (!online) {
      setError("Reconnect to publish your page.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await setPackageActive({
          id: product.id,
          active: true,
          requireAvailability: true,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast("Your public page is ready to share.", "success");
        router.push("/onboarding/complete");
        router.refresh();
      } catch {
        setError("Could not publish your page. Please try again.");
      }
    });
  }

  return (
    <WizardChrome
      activePosition={5}
      completedCount={4}
      stepIndicator="Review & publish"
      hoursNotNeeded={hoursNotNeeded}
      canExit={!previewMode}
      previewMode={previewMode}
      tip={
        <>
          Skitza never handles your money. Bank or Bit details are optional and stay private until
          you approve an artist.
        </>
      }
      footer={
        <WizardFooter
          onBack={() => {
            router.push(
              `${
                includesSessions ? "/onboarding/availability" : "/onboarding/service"
              }${previewSuffix}`,
            );
          }}
          onContinue={publish}
          continueLabel="Publish page"
          pending={pending}
          pendingLabel="Publishing…"
        />
      }
    >
      <div className="ob-stagger">
        <p className="font-mono text-[10.5px] font-bold tracking-[0.22em] text-[rgb(var(--brand-primary-dark))] uppercase">
          Final check
        </p>
        <h1
          className="font-display mt-2 text-[30px] leading-[1.04] font-extrabold tracking-[-0.035em] text-balance sm:text-[36px]"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Ready to share?
        </h1>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Your first product is still hidden. Check the real signed-in artist view, then publish
          when it feels right.
        </p>

        <section aria-label="Setup checks" className="mt-6 grid gap-2.5">
          <CheckRow
            icon={Link2}
            title="Public page"
            detail={`${producerName} and your share link are ready.`}
            editHref="/onboarding/studio"
            previewMode={previewMode}
          />
          <CheckRow
            icon={Package2}
            title="First product"
            detail={`${product.name} is saved and hidden.`}
            editHref="/onboarding/service"
            previewMode={previewMode}
          />
          <CheckRow
            icon={CalendarClock}
            title="Working hours"
            detail={
              hoursNotNeeded
                ? "Not needed — this product has no bookable sessions."
                : "Saved for artist booking requests."
            }
            editHref={hoursNotNeeded ? "/onboarding/service" : "/onboarding/availability"}
            previewMode={previewMode}
          />
        </section>

        <div className="mt-7 flex items-center gap-2">
          <Eye size={15} className="text-[rgb(var(--brand-primary-dark))]" aria-hidden />
          <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
            What connected artists see in Store
          </p>
        </div>

        <div className="mt-3 rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3 shadow-[var(--shadow-sm)] sm:p-5">
          <ArtistProductPreview
            name={product.name}
            tagline={product.tagline}
            producerName={producerName}
            priceCents={product.priceCents}
            currency={product.currency}
            pricingModel={product.pricingModel}
            volumeTiers={product.volumeTiers}
            includesSessions={includesSessions}
            sessions={includesSessions ? Math.max(1, product.sessionCount) : 0}
            unlimitedSessions={includesSessions && product.sessionCount === 0}
            duration={includesSessions ? `${String(product.durationMin)} min` : ""}
            includes={product.deliverables}
            revisions={product.revisions}
            unlimitedRevisions={product.unlimitedRevisions}
            paymentPlans={product.paymentPlans}
            royaltyTerms={product.royaltyTerms}
            agreementText={product.agreementText}
            taxMode={taxMode}
            taxRatePct={taxRatePct}
            placement="focal"
          />
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Publishing makes this product visible in Store for artists connected to you. Payments stay
          outside Skitza.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.28)] bg-[rgb(var(--fg-danger)/0.07)] px-3.5 py-3 text-[13px] text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </WizardChrome>
  );
}
