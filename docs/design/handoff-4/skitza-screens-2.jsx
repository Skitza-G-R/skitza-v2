/* ===================================================================
   Skitza — mobile purchase flow · SECTION 2 SCREENS (Commit)
   S4 Review & sign · S5 Request sent · S6 Home status card
=================================================================== */
const { useState: useS2, useEffect: useE2, useRef: useR2 } = React;

const SB2 = 60,
  HI2 = 30,
  CREAM2 = "rgb(247 243 236)";

/* reuse the Screen shell from screens.jsx (global) */

/* ====================================================================
   S4 — REVIEW & SIGN CONTRACT  (funnel · back arrow, no cover)
==================================================================== */
function buildTerms(product) {
  return [
    {
      h: "Booking & approval",
      b: `You're sending a request, not a confirmed booking. ${GILI.name} reviews it within 24 hours and may accept or decline. Your quoted price locks the moment you send — and won't change for this booking, even if ${GILI.name}'s rates move later.`,
    },
    { h: `What's included`, b: `This booking covers:`, points: product.includes },
    {
      h: "Payment is handled off-app",
      b: `After approval you'll pay by bank transfer or Bit, using the details ${GILI.name} shares. Skitza records every payment but never processes, holds, or refunds money on your behalf.`,
    },
    {
      h: "Deposit & plans",
      b: `A deposit secures your slot and is usually non-refundable once work begins. On a plan, the remaining balance follows the schedule you agree together. Sessions can run on a deposit — but downloads stay locked until the booking is fully paid.`,
    },
    {
      h: "Rescheduling & cancellation",
      b: `You can reschedule or cancel yourself up to the window set for this offer (shown when you book). Closer than that, message ${GILI.name} directly. Any refund or credit follows this agreement — not an app rule.`,
    },
    {
      h: "Delivery & ownership",
      b: `Stream your delivered songs any time. Downloads unlock at full payment. Usage rights, credits and splits are as written in ${GILI.name}'s full document below.`,
    },
    {
      h: "Records & notifications",
      b: `Your agreement, this timestamp, and every payment proof are saved to this booking. We notify you by app and email at each step.`,
    },
  ];
}

function S4Contract({ productId = "g1", onBack, onSend, toast }) {
  const product = productById(productId);
  const terms = buildTerms(product);
  const [agreed, setAgreed] = useS2(false);
  const [sending, setSending] = useS2(false);

  const send = () => {
    if (!agreed || sending) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      onSend();
    }, 1100);
  };

  const footer = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: `14px 18px ${HI2 + 10}px`,
        background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 22%)",
      }}
    >
      <PrimaryCTA
        onClick={send}
        disabled={!agreed || sending}
        glow={agreed && !sending}
        sub={agreed ? "Locks your price · sends to Gili" : "Agree below to continue"}
      >
        {sending ? (
          <>
            <span
              className="sk-spin"
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                border: "2px solid rgba(26,20,7,.3)",
                borderTopColor: "#1a1407",
                display: "inline-block",
              }}
            />{" "}
            Sending…
          </>
        ) : (
          <>
            Send request <Ic.arrowR />
          </>
        )}
      </PrimaryCTA>
    </div>
  );

  return (
    <Screen
      footer={footer}
      footerH={150}
      header={() => <TopBar title="Review & agree" sub="BOOKING TERMS" onBack={onBack} />}
    >
      <div style={{ height: SB2 + 46 }} />

      <div style={{ padding: "14px 20px 0" }}>
        <h1
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "-0.035em",
            margin: 0,
            color: "rgb(17 16 9)",
            lineHeight: 1.1,
          }}
        >
          Before we send it
        </h1>
        <p
          style={{
            fontFamily: "Outfit",
            fontSize: 14,
            color: "rgb(var(--fg-muted))",
            lineHeight: 1.55,
            margin: "8px 0 0",
            textWrap: "pretty",
          }}
        >
          Here's the plain-language version of your booking terms. {GILI.name}'s full signed
          agreement is attached as a PDF below.
        </p>
      </div>

      {/* what you're agreeing to */}
      <div style={{ padding: "16px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "14px 16px",
            background: "rgb(17 16 9)",
            borderRadius: 16,
            color: "rgb(247 243 236)",
          }}
        >
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              flexShrink: 0,
              background: skSwatch(GILI.hue),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {GILI.initials}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 14.5, color: "#fff" }}>
              {product.name}
            </div>
            <div
              style={{
                fontFamily: "Outfit",
                fontSize: 12,
                color: "rgba(247,243,236,.7)",
                marginTop: 1,
              }}
            >
              with {GILI.name} · {product.duration}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 19,
                letterSpacing: "-0.03em",
                color: "rgb(var(--brand-primary))",
              }}
            >
              {ils(product.price)}
            </div>
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 8.5,
                color: "rgba(247,243,236,.55)",
                letterSpacing: "0.08em",
              }}
            >
              LOCKS NOW
            </div>
          </div>
        </div>
      </div>

      {/* producer-uploaded PDF */}
      <div style={{ padding: "16px 20px 0" }}>
        <Eyebrow style={{ marginBottom: 9 }}>
          <Ic.doc />
          Gili's full agreement
        </Eyebrow>
        <button
          className="sk-lift"
          onClick={() => toast && toast(`Opening Booking_Agreement.pdf — preview out of scope`)}
          style={{
            all: "unset",
            cursor: "pointer",
            width: "100%",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 16px",
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 16,
            boxShadow: "0 1px 2px rgba(17,16,9,.04)",
          }}
        >
          <span
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              flexShrink: 0,
              background: "rgb(var(--brand-primary) / .14)",
              color: "rgb(140 95 6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M6 2.5h8l4 4V21a.5.5 0 01-.5.5h-11A.5.5 0 016 21z" strokeLinejoin="round" />
              <path d="M14 2.5v4h4" strokeLinejoin="round" />
              <text
                x="12"
                y="16.5"
                fontSize="5.5"
                fontWeight="800"
                fill="currentColor"
                stroke="none"
                textAnchor="middle"
                fontFamily="Outfit"
              >
                PDF
              </text>
            </svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 14, color: "rgb(17 16 9)" }}
            >
              Booking_Agreement.pdf
            </div>
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 10.5,
                color: "rgb(var(--fg-muted))",
                marginTop: 3,
                letterSpacing: "0.02em",
              }}
            >
              PDF · 248 KB · uploaded by {GILI.name}
            </div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 13px",
              borderRadius: 999,
              background: "rgb(17 16 9)",
              color: "rgb(var(--brand-primary))",
              fontFamily: "Outfit",
              fontWeight: 700,
              fontSize: 12.5,
              flexShrink: 0,
            }}
          >
            View
          </span>
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: 9,
            fontFamily: "Outfit",
            fontSize: 11.5,
            color: "rgb(var(--fg-muted))",
            lineHeight: 1.45,
          }}
        >
          <span style={{ marginTop: 1 }}>
            <Ic.shield />
          </span>{" "}
          The PDF is the binding document. The summary below is for easy reading.
        </div>
      </div>

      {/* scrollable plain-language terms card */}
      <div style={{ padding: "18px 20px 0" }}>
        <Eyebrow style={{ marginBottom: 9 }}>Plain-language summary</Eyebrow>
        <div
          style={{
            position: "relative",
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 16,
            boxShadow: "0 1px 2px rgba(17,16,9,.04)",
          }}
        >
          <div
            className="no-scroll"
            style={{ maxHeight: 256, overflowY: "auto", padding: "4px 18px 8px" }}
          >
            {terms.map((t, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 0",
                  borderBottom:
                    i === terms.length - 1 ? "none" : "1px solid rgb(var(--border-subtle))",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "rgb(140 95 6)",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      fontFamily: "Syne",
                      fontWeight: 700,
                      fontSize: 14.5,
                      letterSpacing: "-0.01em",
                      color: "rgb(17 16 9)",
                    }}
                  >
                    {t.h}
                  </span>
                </div>
                <p
                  style={{
                    fontFamily: "Outfit",
                    fontSize: 13,
                    color: "rgb(61 55 48)",
                    lineHeight: 1.6,
                    margin: "7px 0 0",
                    textWrap: "pretty",
                  }}
                >
                  {t.b}
                </p>
                {t.points && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 9 }}>
                    {t.points.map((pt, j) => (
                      <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 999,
                            flexShrink: 0,
                            background: "rgb(var(--brand-primary) / .14)",
                            color: "rgb(140 95 6)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            marginTop: 1,
                          }}
                        >
                          <Ic.check />
                        </span>
                        <span
                          style={{
                            fontFamily: "Outfit",
                            fontSize: 12.5,
                            color: "rgb(40 36 30)",
                            lineHeight: 1.45,
                          }}
                        >
                          {pt}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* scroll fade */}
          <div
            style={{
              position: "absolute",
              left: 1,
              right: 1,
              bottom: 1,
              height: 28,
              borderRadius: "0 0 15px 15px",
              background: "linear-gradient(180deg, rgba(255,255,255,0), rgba(255,255,255,.95))",
              pointerEvents: "none",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 9,
            fontFamily: "Outfit",
            fontSize: 11.5,
            color: "rgb(var(--fg-muted))",
          }}
        >
          <Ic.lock /> Saved with a timestamp once you agree.
        </div>
      </div>

      {/* agree checkbox */}
      <div style={{ padding: "16px 20px 0" }}>
        <CheckRow checked={agreed} onToggle={() => setAgreed((v) => !v)}>
          I've read the agreement (PDF) and agree to these terms.
        </CheckRow>
      </div>
    </Screen>
  );
}

/* ====================================================================
   S5 — REQUEST SENT  (premium confirmation moment)
==================================================================== */
function S5Sent({ productId = "g1", onHome, onStore }) {
  const product = productById(productId);
  const ref = "SKZ-" + (2400 + (product.id.charCodeAt(1) || 1) * 7) + "-" + product.sku.slice(-2);

  const steps = [
    { t: "Request sent", s: "Just now", done: true },
    { t: `${GILI.name} reviews your request`, s: "Within 24 hours", done: false },
    { t: "Payment details arrive", s: "After approval", done: false },
  ];

  const footer = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: `16px 22px ${HI2 + 14}px`,
        background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 26%)",
        display: "flex",
        flexDirection: "column",
        gap: 11,
      }}
    >
      <PrimaryCTA onClick={onHome} glow={false}>
        Go to my Home
      </PrimaryCTA>
      <SecondaryCTA onClick={onStore}>
        <span>Back to {GILI.name}'s store</span>
      </SecondaryCTA>
    </div>
  );

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        overflow: "hidden",
        background:
          "radial-gradient(130% 70% at 50% -4%, rgb(212 150 10 / .18), transparent 52%), radial-gradient(100% 60% at 50% 110%, rgb(17 16 9 / .04), transparent 60%), rgb(247 243 236)",
      }}
    >
      <div style={{ position: "absolute", top: SB2 - 2, left: 16, zIndex: 40 }}>
        <GlassRound onClick={onStore}>
          <Ic.close />
        </GlassRound>
      </div>

      <div
        className="screen-scroll no-scroll"
        style={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          overflowX: "hidden",
          paddingBottom: 168,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            padding: `${SB2 + 40}px 30px 0`,
          }}
        >
          {/* emblem */}
          <div style={{ position: "relative", marginBottom: 26 }}>
            <span
              style={{
                position: "absolute",
                inset: -18,
                borderRadius: 999,
                border: "1.5px solid rgb(var(--brand-primary) / .25)",
                animation: "sk-ripple 2.6s ease-out infinite",
              }}
            />
            <span
              style={{
                position: "absolute",
                inset: -18,
                borderRadius: 999,
                border: "1.5px solid rgb(var(--brand-primary) / .25)",
                animation: "sk-ripple 2.6s ease-out infinite 1.3s",
              }}
            />
            <span
              style={{
                position: "relative",
                width: 92,
                height: 92,
                borderRadius: 999,
                background: "rgb(17 16 9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgb(var(--brand-primary))",
                boxShadow:
                  "0 20px 46px -14px rgba(17,16,9,.55), inset 0 0 0 1.5px rgb(212 150 10 / .35)",
              }}
            >
              <Ic.checkFill />
            </span>
          </div>

          <div
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 10,
              letterSpacing: "0.2em",
              color: "rgb(140 95 6)",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Request sent · #{ref}
          </div>
          <h1
            style={{
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 31,
              letterSpacing: "-0.04em",
              margin: 0,
              color: "rgb(17 16 9)",
              lineHeight: 1.06,
              textWrap: "balance",
            }}
          >
            Your request is with {GILI.name}
          </h1>
          <p
            style={{
              fontFamily: "Outfit",
              fontSize: 14.5,
              color: "rgb(61 55 48)",
              lineHeight: 1.6,
              margin: "13px 0 0",
              maxWidth: 290,
              textWrap: "pretty",
            }}
          >
            They'll look it over and reach out about payment. We'll ping you the moment they do.
          </p>
        </div>

        {/* premium ticket card */}
        <div style={{ padding: "24px 22px 0" }}>
          <div
            style={{
              position: "relative",
              background: "#fff",
              borderRadius: 20,
              border: "1px solid rgb(var(--border-subtle))",
              boxShadow: "0 1px 2px rgba(17,16,9,.05), 0 24px 50px -26px rgba(17,16,9,.3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: 4,
                background: "linear-gradient(90deg, rgb(var(--brand-primary)), rgb(176 104 48))",
              }}
            />
            {/* booking row */}
            <div
              style={{ display: "flex", alignItems: "center", gap: 13, padding: "17px 18px 16px" }}
            >
              <span
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  flexShrink: 0,
                  background: skCover(product.id === "g1" ? 44 : GILI.hue),
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "Syne",
                  fontWeight: 800,
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "radial-gradient(120% 80% at 30% 18%, rgba(255,255,255,.3), transparent 60%)",
                  }}
                />
                <span style={{ position: "relative" }}>{GILI.initials}</span>
              </span>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div
                  style={{
                    fontFamily: "Syne",
                    fontWeight: 800,
                    fontSize: 16,
                    letterSpacing: "-0.025em",
                    color: "rgb(17 16 9)",
                    lineHeight: 1.15,
                  }}
                >
                  {product.name}
                </div>
                <div
                  style={{
                    fontFamily: "Outfit",
                    fontSize: 12,
                    color: "rgb(var(--fg-muted))",
                    marginTop: 2,
                  }}
                >
                  with {GILI.name}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: "Syne",
                    fontWeight: 800,
                    fontSize: 19,
                    letterSpacing: "-0.03em",
                    color: "rgb(17 16 9)",
                  }}
                >
                  {ils(product.price)}
                </div>
                <div
                  style={{
                    fontFamily: "JetBrains Mono",
                    fontSize: 8.5,
                    color: "rgb(140 95 6)",
                    letterSpacing: "0.08em",
                  }}
                >
                  PRICE LOCKED
                </div>
              </div>
            </div>

            {/* perforation divider */}
            <div
              style={{
                position: "relative",
                height: 1,
                margin: "0 18px",
                borderTop: "1.5px dashed rgb(var(--border-strong, 200 192 178))",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: -28,
                  top: -10,
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: "rgb(247 243 236)",
                  border: "1px solid rgb(var(--border-subtle))",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  right: -28,
                  top: -10,
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: "rgb(247 243 236)",
                  border: "1px solid rgb(var(--border-subtle))",
                }}
              />
            </div>

            {/* what happens next timeline */}
            <div style={{ padding: "16px 18px 18px", textAlign: "left" }}>
              <div
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 9.5,
                  letterSpacing: "0.14em",
                  color: "rgb(var(--fg-muted))",
                  textTransform: "uppercase",
                  marginBottom: 14,
                }}
              >
                What happens next
              </div>
              <div style={{ position: "relative" }}>
                {steps.map((st, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 13,
                      paddingBottom: i === steps.length - 1 ? 0 : 16,
                      position: "relative",
                    }}
                  >
                    {/* connector */}
                    {i < steps.length - 1 && (
                      <span
                        style={{
                          position: "absolute",
                          left: 10.5,
                          top: 22,
                          bottom: 0,
                          width: 1.5,
                          background: "rgb(17 16 9 / .12)",
                        }}
                      />
                    )}
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        flexShrink: 0,
                        zIndex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: st.done ? "rgb(var(--brand-primary))" : "#fff",
                        border: `2px solid ${st.done ? "rgb(var(--brand-primary))" : "rgb(17 16 9 / .16)"}`,
                        color: "#1a1407",
                      }}
                    >
                      {st.done ? (
                        <Ic.check />
                      ) : (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: "rgb(17 16 9 / .2)",
                          }}
                        />
                      )}
                    </span>
                    <div style={{ paddingTop: 1 }}>
                      <div
                        style={{
                          fontFamily: "Outfit",
                          fontWeight: 600,
                          fontSize: 13.5,
                          color: st.done ? "rgb(17 16 9)" : "rgb(40 36 30)",
                          lineHeight: 1.3,
                        }}
                      >
                        {st.t}
                      </div>
                      <div
                        style={{
                          fontFamily: "JetBrains Mono",
                          fontSize: 10,
                          color: st.done ? "rgb(140 95 6)" : "rgb(var(--fg-muted))",
                          marginTop: 2,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {st.s}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: 14,
              fontFamily: "Outfit",
              fontSize: 11.5,
              color: "rgb(var(--fg-muted))",
            }}
          >
            <Ic.shield /> Saved to your bookings · we'll notify you by app & email.
          </div>
        </div>
      </div>

      {footer}
    </div>
  );
}

/* ====================================================================
   S6 — HOME · PURCHASE STATUS CARD  (standing screen · tab bar)
   5 states: pending / approved / verifying / paid / declined
==================================================================== */
const HOME_STATES = {
  pending: {
    stage: "request",
    pill: "pending",
    pillText: "Pending review",
    headline: `Waiting for ${GILI.name} to review`,
    next: `${GILI.name} is looking over your request. No action needed from you yet.`,
    sub: "Usually within 24 hours",
    action: null,
  },
  approved: {
    stage: "pay",
    pill: "pending",
    pillText: "Awaiting payment",
    headline: `${GILI.name} approved your booking`,
    next: `They'll message you payment details. Pick how you'd like to pay to get started.`,
    sub: null,
    action: { label: "Choose a payment plan", to: "pay" },
  },
  verifying: {
    stage: "pay",
    pill: "pending",
    pillText: "Verifying payment",
    headline: "Checking your proof of payment",
    next: `We sent your proof to ${GILI.name}. They'll confirm it shortly.`,
    sub: "Proof attached",
    action: null,
  },
  paid: {
    stage: "book",
    pill: "ok",
    pillText: "Paid · sessions unlocked",
    headline: `You're all set`,
    next: `Payment confirmed. Pick a date and time to book your first session.`,
    sub: null,
    action: { label: "Book a session", to: "book" },
  },
  declined: {
    stage: "request",
    pill: "neutral",
    pillText: `Couldn't be confirmed`,
    headline: `This request couldn't be confirmed`,
    next: `Your request couldn't be confirmed at this time. You're free to explore other offers.`,
    sub: null,
    action: null,
    declined: true,
  },
};

function S6Home({ productId = "g1", state = "pending", go, toast }) {
  const product = productById(productId);
  const st = HOME_STATES[state] || HOME_STATES.pending;
  const tabbar = (
    <BottomTabBar
      active="home"
      onNav={(t) => {
        const m = { home: "s6", music: "s13", book: "s11", store: "s2" };
        if (m[t]) go({ screen: m[t] });
      }}
    />
  );

  const onAction = () => {
    if (!st.action) return;
    if (st.action.to === "pay") go({ screen: "s7" });
    if (st.action.to === "book") go({ screen: "s10" });
  };

  return (
    <Screen
      footer={tabbar}
      footerH={92}
      header={(top) => (
        <StickyNav scrolled={top} title={`${ARTIST.first}'s Home`} start={38} end={94} />
      )}
    >
      <div style={{ height: SB2 + 14 }} />
      {/* greeting */}
      <div
        style={{
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "JetBrains Mono",
              fontSize: 10,
              letterSpacing: "0.18em",
              color: "rgb(var(--fg-muted))",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Good evening
          </div>
          <h1
            style={{
              fontFamily: "Syne",
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: "-0.04em",
              margin: "5px 0 0",
              color: "rgb(17 16 9)",
            }}
          >
            {ARTIST.first}
          </h1>
        </div>
        <Avatar p={ARTIST} size={46} ring />
      </div>

      {/* the heartbeat card */}
      <div style={{ padding: "20px 20px 0" }}>
        <Eyebrow gold style={{ marginBottom: 10 }}>
          <span style={{ width: 18, height: 1, background: "currentColor" }} />
          Your booking
        </Eyebrow>
        <div
          style={{
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 22,
            overflow: "hidden",
            boxShadow: "0 1px 2px rgba(17,16,9,.04), 0 22px 48px -26px rgba(17,16,9,.26)",
          }}
        >
          {/* header band */}
          <div style={{ padding: "18px 18px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", gap: 13, minWidth: 0 }}>
                <span
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 13,
                    flexShrink: 0,
                    background: skCover(product.id === "g1" ? 44 : GILI.hue),
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontFamily: "Syne",
                    fontWeight: 800,
                    fontSize: 15,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "radial-gradient(120% 80% at 30% 18%, rgba(255,255,255,.3), transparent 60%)",
                    }}
                  />
                  <span style={{ position: "relative" }}>{GILI.initials}</span>
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "Syne",
                      fontWeight: 800,
                      fontSize: 17,
                      letterSpacing: "-0.025em",
                      color: "rgb(17 16 9)",
                      lineHeight: 1.15,
                      textWrap: "pretty",
                    }}
                  >
                    {product.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "Outfit",
                      fontSize: 12.5,
                      color: "rgb(var(--fg-muted))",
                      marginTop: 2,
                    }}
                  >
                    with {GILI.name} · {ils(product.price)}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <StatusPill tone={st.pill}>{st.pillText}</StatusPill>
            </div>
          </div>

          {/* stepper */}
          <div style={{ padding: "18px 18px 16px" }}>
            <Stepper stage={st.stage} declined={st.declined} />
          </div>

          {/* what's next */}
          <div
            style={{
              padding: "16px 18px",
              borderTop: "1px solid rgb(var(--border-subtle))",
              background: "rgb(247 243 236 / .5)",
            }}
          >
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 9.5,
                letterSpacing: "0.14em",
                color: "rgb(var(--fg-muted))",
                textTransform: "uppercase",
                marginBottom: 7,
              }}
            >
              What's next
            </div>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: "-0.02em",
                color: "rgb(17 16 9)",
                lineHeight: 1.25,
              }}
            >
              {st.headline}
            </div>
            <p
              style={{
                fontFamily: "Outfit",
                fontSize: 13.5,
                color: "rgb(61 55 48)",
                lineHeight: 1.55,
                margin: "7px 0 0",
                textWrap: "pretty",
              }}
            >
              {st.next}
            </p>
            {st.sub && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 11,
                  fontFamily: "Outfit",
                  fontSize: 12,
                  color: "rgb(140 95 6)",
                }}
              >
                <Ic.clock /> {st.sub}
              </div>
            )}
            {st.action && (
              <div style={{ marginTop: 15 }}>
                <PrimaryCTA onClick={onAction} sub={null}>
                  {st.action.label} <Ic.arrowR />
                </PrimaryCTA>
              </div>
            )}
            {state === "declined" && (
              <div style={{ marginTop: 15 }}>
                <SecondaryCTA onClick={() => go({ screen: "s2" })}>
                  Explore other offers
                </SecondaryCTA>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* quiet message-producer row */}
      {state !== "declined" && (
        <div style={{ padding: "14px 20px 0" }}>
          <button
            className="sk-row"
            onClick={() => toast(`Messaging ${GILI.name} — out of scope for this flow`)}
            style={{
              all: "unset",
              cursor: "pointer",
              width: "100%",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 15px",
              background: "#fff",
              border: "1px solid rgb(var(--border-subtle))",
              borderRadius: 14,
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                flexShrink: 0,
                background: "rgb(17 16 9 / .05)",
                color: "rgb(40 36 30)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.message />
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "Outfit",
                  fontWeight: 600,
                  fontSize: 13.5,
                  color: "rgb(17 16 9)",
                }}
              >
                Message {GILI.name}
              </div>
              <div
                style={{
                  fontFamily: "Outfit",
                  fontSize: 11.5,
                  color: "rgb(var(--fg-muted))",
                  marginTop: 1,
                }}
              >
                Questions about your booking
              </div>
            </div>
            <span style={{ color: "rgb(var(--fg-muted) / .6)" }}>
              <Ic.chevR />
            </span>
          </button>
        </div>
      )}

      {/* one-purchase-at-a-time hint */}
      {state !== "paid" && state !== "declined" && (
        <div style={{ padding: "12px 20px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "center",
              fontFamily: "Outfit",
              fontSize: 11.5,
              color: "rgb(var(--fg-muted))",
            }}
          >
            <Ic.lock /> One booking at a time — new requests open up when this wraps.
          </div>
        </div>
      )}
    </Screen>
  );
}

Object.assign(window, { S4Contract, S5Sent, S6Home, HOME_STATES });
