"use client";

// S5 — Request sent (artist purchase funnel · Commit).
//
// The reassuring beat right after the artist sends their request (Gate 1).
// A calm celebration: ripple emblem, the price-locked ticket stub with a
// reference number, and a "what happens next" timeline. No payment details
// yet — the producer reviews first. Quiet and confident, not a spinner.

import { useRouter } from "next/navigation";

import { Check, CheckLarge, CloseIcon, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import { GlassRound, PrimaryCta, SecondaryCta } from "~/components/artist/funnel/funnel-ui";
import {
  coverGradient,
  formatShekels,
  type Producer,
  type PurchaseProduct,
} from "./purchase-data";

export function RequestSentScreen({
  product,
  producer,
  requestRef,
}: {
  product: PurchaseProduct;
  producer: Producer;
  requestRef: string;
}) {
  const router = useRouter();
  const toStore = () => {
    router.push("/artist/store");
  };

  const steps = [
    { title: "Request sent", when: "Just now", done: true },
    { title: `${producer.name} reviews your request`, when: "Within 24 hours", done: false },
    { title: "Payment details arrive", when: "After approval", done: false },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] overflow-hidden"
      style={{
        background:
          "radial-gradient(130% 70% at 50% -4%, rgb(var(--brand-primary) / 0.18), transparent 52%), radial-gradient(100% 60% at 50% 110%, rgb(17 16 9 / 0.04), transparent 60%), rgb(var(--bg-background))",
      }}
    >
      {/* floating close → back to the producer's store */}
      <div className="absolute left-4 top-0 z-40 mt-[calc(env(safe-area-inset-top)+12px)]">
        <GlassRound ariaLabel="Close" onClick={toStore}>
          <CloseIcon />
        </GlassRound>
      </div>

      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col">
          {/* hero */}
          <div className="sk-safe-top flex flex-col items-center px-[30px] pt-[72px] text-center">
            {/* emblem with ripple rings */}
            <div className="relative mb-[26px]">
              <span
                className="absolute -inset-[18px] animate-ping rounded-full"
                style={{ border: "1.5px solid rgb(var(--brand-primary) / 0.25)" }}
              />
              <span
                className="relative flex h-[92px] w-[92px] items-center justify-center rounded-full text-[rgb(var(--brand-primary))]"
                style={{
                  background: "rgb(var(--bg-sidebar))",
                  boxShadow:
                    "0 20px 46px -14px rgb(17 16 9 / 0.55), inset 0 0 0 1.5px rgb(var(--brand-primary) / 0.35)",
                }}
              >
                <CheckLarge />
              </span>
            </div>

            <div className="reveal-up mb-3.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--brand-primary-dark))]">
              Request sent · #{requestRef}
            </div>
            <h1 className="reveal-up reveal-up-delay-1 text-balance font-syne text-[31px] font-extrabold leading-[1.06] tracking-[-0.04em] text-[rgb(var(--fg-default))]">
              Your request is with {producer.name}
            </h1>
            <p className="reveal-up reveal-up-delay-2 mt-3.5 max-w-[290px] text-pretty text-[14.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
              {"They'll look it over and reach out about payment. We'll ping you the moment they do."}
            </p>
          </div>

          {/* ticket stub */}
          <div className="reveal-up reveal-up-delay-3 px-[22px] pt-6">
            <div
              className="relative overflow-hidden rounded-[var(--radius-xl)]"
              style={{
                background: "rgb(var(--bg-elevated))",
                border: "1px solid rgb(var(--border-subtle))",
                boxShadow: "var(--shadow-sm), 0 24px 50px -26px rgb(17 16 9 / 0.3)",
              }}
            >
              <div
                className="h-1"
                style={{
                  background:
                    "linear-gradient(90deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
                }}
              />

              {/* booking row */}
              <div className="flex items-center gap-[13px] px-[18px] pb-4 pt-[17px]">
                <span
                  className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[12px] font-syne text-[14px] font-extrabold text-white"
                  style={{ background: coverGradient(product.id === "g1" ? 44 : producer.hue) }}
                >
                  {producer.initials}
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="font-syne text-[16px] font-extrabold leading-tight tracking-[-0.025em] text-[rgb(var(--fg-default))]">
                    {product.name}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
                    with {producer.name}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-syne text-[19px] font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
                    {formatShekels(product.priceCents)}
                  </div>
                  <div className="font-mono text-[8.5px] tracking-[0.08em] text-[rgb(var(--brand-primary-dark))]">
                    PRICE LOCKED
                  </div>
                </div>
              </div>

              {/* perforation */}
              <div
                className="relative mx-[18px] border-t-[1.5px] border-dashed"
                style={{ borderColor: "rgb(var(--border-strong))" }}
              >
                <span
                  className="absolute -left-[28px] -top-[10px] h-5 w-5 rounded-full"
                  style={{
                    background: "rgb(var(--bg-background))",
                    border: "1px solid rgb(var(--border-subtle))",
                  }}
                />
                <span
                  className="absolute -right-[28px] -top-[10px] h-5 w-5 rounded-full"
                  style={{
                    background: "rgb(var(--bg-background))",
                    border: "1px solid rgb(var(--border-subtle))",
                  }}
                />
              </div>

              {/* what happens next */}
              <div className="px-[18px] pb-[18px] pt-4 text-left">
                <div className="mb-3.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                  What happens next
                </div>
                <div className="relative">
                  {steps.map((step, i) => (
                    <div
                      key={step.title}
                      className="relative flex gap-[13px]"
                      style={{ paddingBottom: i === steps.length - 1 ? 0 : 16 }}
                    >
                      {i < steps.length - 1 ? (
                        <span
                          className="absolute left-[10.5px] top-[22px] bottom-0 w-[1.5px]"
                          style={{ background: "rgb(17 16 9 / 0.12)" }}
                        />
                      ) : null}
                      <span
                        className="z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: step.done ? "rgb(var(--brand-primary))" : "rgb(var(--bg-elevated))",
                          border: `2px solid ${
                            step.done ? "rgb(var(--brand-primary))" : "rgb(17 16 9 / 0.16)"
                          }`,
                          color: "rgb(var(--bg-sidebar))",
                        }}
                      >
                        {step.done ? (
                          <Check />
                        ) : (
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: "rgb(17 16 9 / 0.2)" }}
                          />
                        )}
                      </span>
                      <div className="pt-px">
                        <div
                          className="text-[13.5px] font-semibold leading-tight"
                          style={{
                            color: step.done
                              ? "rgb(var(--fg-default))"
                              : "rgb(var(--fg-secondary))",
                          }}
                        >
                          {step.title}
                        </div>
                        <div
                          className="mt-0.5 font-mono text-[10px] tracking-[0.02em]"
                          style={{
                            color: step.done
                              ? "rgb(var(--brand-primary-dark))"
                              : "rgb(var(--fg-muted))",
                          }}
                        >
                          {step.when}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
              <ShieldIcon />
              <span>Saved to your bookings · we&apos;ll notify you by app &amp; email.</span>
            </div>
          </div>

          <div className="flex-1" />

          {/* actions */}
          <div className="sk-safe-bottom flex flex-col gap-2.5 px-[22px] pb-4 pt-4">
            <PrimaryCta
              glow={false}
              onClick={() => {
                router.push("/artist");
              }}
            >
              Go to my Home
            </PrimaryCta>
            <SecondaryCta onClick={toStore}>
              <span>Back to {producer.name}&apos;s store</span>
            </SecondaryCta>
          </div>
        </div>
      </div>
    </div>
  );
}
