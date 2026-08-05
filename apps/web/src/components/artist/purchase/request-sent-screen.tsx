"use client";

// S5 — Request sent (artist purchase funnel · Commit).
//
// The reassuring beat right after the artist sends their request (Gate 1).
// A calm celebration with the request reference and a "what happens next"
// timeline. Commercial terms are intentionally absent: this row is intent
// only, and immutable terms begin at purchase acceptance.

import { useRouter } from "next/navigation";

import { Check, CheckLarge, CloseIcon, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import {
  GlassRound,
  PrimaryCta,
  RippleEmblem,
  SecondaryCta,
} from "~/components/artist/funnel/funnel-ui";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { coverGradient, type Producer } from "./purchase-data";

export function RequestSentScreen({
  producer,
  requestRef,
  studioId,
}: {
  producer: Producer;
  requestRef: string;
  studioId?: string | undefined;
}) {
  const router = useRouter();
  const toStore = () => {
    router.push(withArtistStudio("/artist/store", studioId));
  };

  const steps = [
    { title: "Request sent", when: "Just now", done: true },
    { title: `${producer.name} reviews your request`, when: "Within 24 hours", done: false },
    { title: "Choose an enabled payment plan", when: "After approval", done: false },
    { title: "Review and accept the exact agreement", when: "Before payment", done: false },
    { title: "Receive external payment instructions", when: "After acceptance", done: false },
  ];

  return (
    <div
      className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] flex flex-col overflow-hidden"
      style={{
        background:
          "radial-gradient(130% 70% at 50% -4%, rgb(var(--brand-primary) / 0.18), transparent 52%), radial-gradient(100% 60% at 50% 110%, rgb(17 16 9 / 0.04), transparent 60%), rgb(var(--bg-background))",
      }}
    >
      {/* floating close, aligned to the same centered app panel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 mx-auto w-full max-w-[440px]">
        <div className="pointer-events-auto mt-[calc(env(safe-area-inset-top)+12px)] ml-4 w-fit">
          <GlassRound ariaLabel="Close" onClick={toStore}>
            <CloseIcon />
          </GlassRound>
        </div>
      </div>

      <div className="sk-native-scroll min-h-0 flex-1">
        <div className="mx-auto flex min-h-full w-full max-w-[440px] flex-col">
          {/* hero */}
          <div className="sk-safe-top flex flex-col items-center px-[30px] pt-[72px] text-center">
            {/* emblem with rippling rings (foundation: two staggered sk-ripple rings) */}
            <RippleEmblem tone="amber" className="mb-[26px]">
              <CheckLarge />
            </RippleEmblem>

            <div className="reveal-up mb-3.5 font-mono text-[10px] tracking-[0.2em] text-[rgb(var(--brand-primary-text))] uppercase">
              Request sent · #{requestRef}
            </div>
            <h1 className="reveal-up reveal-up-delay-1 font-syne text-[clamp(24px,7.2vw,28px)] leading-[1.06] font-extrabold tracking-[-0.04em] text-balance text-[rgb(var(--fg-default))]">
              Your request is with {producer.name}
            </h1>
            <p className="reveal-up reveal-up-delay-2 mt-3.5 max-w-[290px] text-[14.5px] leading-relaxed text-pretty text-[rgb(var(--fg-secondary))]">
              If they approve it, we&apos;ll let you know. You will choose a payment plan and accept
              the exact agreement before receiving external payment instructions.
            </p>
          </div>

          {/* ticket stub */}
          <div className="reveal-up reveal-up-delay-3 px-[22px] pt-6">
            <div
              className="rounded-card relative overflow-hidden"
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

              {/* request identity row — no mutable commercial proposal data */}
              <div className="grid grid-cols-[46px_minmax(0,1fr)] items-center gap-x-[13px] px-[18px] pt-[17px] pb-4 min-[350px]:grid-cols-[46px_minmax(0,1fr)_auto]">
                <span
                  aria-hidden="true"
                  className="font-syne flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[12px] text-[14px] font-extrabold text-white"
                  style={{ background: coverGradient(producer.hue) }}
                >
                  {producer.initials}
                </span>
                <div className="min-w-0 text-left">
                  <div className="font-syne text-[16px] leading-tight font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
                    Request #{requestRef}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[rgb(var(--fg-muted))]">
                    with {producer.name}
                  </div>
                </div>
                <div className="col-start-2 mt-2 text-left min-[350px]:col-start-3 min-[350px]:row-start-1 min-[350px]:mt-0 min-[350px]:text-right">
                  <div className="font-mono text-[8.5px] tracking-[0.08em] text-[rgb(var(--brand-primary-text))]">
                    PENDING REVIEW
                  </div>
                </div>
              </div>

              {/* perforation */}
              <div
                className="relative mx-[18px] border-t-[1.5px] border-dashed"
                style={{ borderColor: "rgb(var(--border-strong))" }}
              >
                <span
                  className="absolute -top-[10px] -left-[28px] h-5 w-5 rounded-full"
                  style={{
                    background: "rgb(var(--bg-background))",
                    border: "1px solid rgb(var(--border-subtle))",
                  }}
                />
                <span
                  className="absolute -top-[10px] -right-[28px] h-5 w-5 rounded-full"
                  style={{
                    background: "rgb(var(--bg-background))",
                    border: "1px solid rgb(var(--border-subtle))",
                  }}
                />
              </div>

              {/* what happens next */}
              <div className="px-[18px] pt-4 pb-[18px] text-left">
                <div className="mb-3.5 font-mono text-[9.5px] tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                  What happens next
                </div>
                <ol className="relative list-none">
                  {steps.map((step, i) => (
                    <li
                      key={step.title}
                      aria-current={i === 1 ? "step" : undefined}
                      className="sk-rise relative flex gap-[13px]"
                      style={{
                        animationDelay: `${String(40 + i * 70)}ms`,
                        paddingBottom: i === steps.length - 1 ? 0 : 16,
                      }}
                    >
                      {i < steps.length - 1 ? (
                        <span
                          className="absolute top-[22px] bottom-0 left-[10.5px] w-[1.5px]"
                          style={{ background: "rgb(17 16 9 / 0.12)" }}
                        />
                      ) : null}
                      <span
                        className="z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: step.done
                            ? "rgb(var(--brand-primary))"
                            : "rgb(var(--bg-elevated))",
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
                          className="text-[13.5px] leading-tight font-semibold"
                          style={{
                            color: step.done
                              ? "rgb(var(--fg-default))"
                              : "rgb(var(--fg-secondary))",
                          }}
                        >
                          {step.title}
                          <span className="sr-only">
                            {step.done
                              ? " — completed"
                              : i === 1
                                ? " — current step"
                                : " — upcoming"}
                          </span>
                        </div>
                        <div
                          className="mt-0.5 font-mono text-[10px] tracking-[0.02em]"
                          style={{
                            color: step.done
                              ? "rgb(var(--brand-primary-text))"
                              : "rgb(var(--fg-muted))",
                          }}
                        >
                          {step.when}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
              <ShieldIcon />
              <span>Saved to your bookings · we&apos;ll notify you by app &amp; email.</span>
            </div>
          </div>

          <div className="flex-1" />

          {/* actions */}
          <div className="sk-safe-bottom flex flex-col gap-2.5 px-[22px] pt-4 pb-4">
            <PrimaryCta
              glow={false}
              onClick={() => {
                router.push(withArtistStudio("/artist", studioId));
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
