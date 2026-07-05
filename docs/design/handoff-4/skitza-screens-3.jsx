/* ===================================================================
   Skitza — mobile purchase flow · SECTION 3 SCREENS (Pay)
   S7 Choose a plan · S8 Payment instructions · S9 Upload proof
=================================================================== */
const { useState: useS3 } = React;
const SB3 = 60,
  HI3 = 30;

/* Build the payment plans a product allows (producer-set, per product). */
function buildPlans(product) {
  const p = product.price;
  const dep = Math.round((p * product.deposit) / 100);
  const defs = {
    full: {
      id: "full",
      label: "Pay in full",
      tagline: "One payment — simplest.",
      dueNow: p,
      badge: null,
      rows: [{ when: "Today", amt: p }],
    },
    split: {
      id: "split",
      label: "50 / 50",
      tagline: "Half now, half on delivery.",
      dueNow: Math.round(p / 2),
      badge: null,
      rows: [
        { when: "Today", amt: Math.round(p / 2) },
        { when: "On delivery", amt: Math.round(p / 2) },
      ],
    },
    milestones: {
      id: "milestones",
      label: "Milestones",
      tagline: "Deposit now, then per song.",
      dueNow: dep,
      badge: null,
      rows: [
        { when: "Deposit today", amt: dep },
        { when: `Then split across ${product.sessions} songs`, amt: p - dep },
      ],
    },
  };
  return (product.plans || ["full"]).map((id) => defs[id]).filter(Boolean);
}
const planById = (product, id) =>
  buildPlans(product).find((pl) => pl.id === id) || buildPlans(product)[0];

/* ====================================================================
   S7 — CHOOSE A PAYMENT PLAN  (funnel · back arrow)
==================================================================== */
function S7Plan({ productId = "g1", back, onContinue }) {
  const product = productById(productId);
  const plans = buildPlans(product);
  const single = plans.length === 1;
  const [sel, setSel] = useS3(single ? plans[0].id : null);
  const chosen = plans.find((p) => p.id === sel);

  const footer = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: `14px 18px ${HI3 + 10}px`,
        background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 24%)",
      }}
    >
      <PrimaryCTA
        onClick={() => sel && onContinue(sel)}
        disabled={!sel}
        glow={!!sel}
        sub={chosen ? `Due today · ${ils(chosen.dueNow)}` : "Pick a plan to continue"}
      >
        Continue <Ic.arrowR />
      </PrimaryCTA>
    </div>
  );

  return (
    <Screen
      footer={footer}
      footerH={138}
      header={() => (
        <TopBar title="Payment plan" sub={`${GILI.name.toUpperCase()}`} onBack={back} />
      )}
    >
      <div style={{ height: SB3 + 46 }} />

      <div style={{ padding: "14px 20px 0" }}>
        <h1
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "-0.035em",
            margin: 0,
            color: "rgb(17 16 9)",
            lineHeight: 1.12,
          }}
        >
          How would you like to pay?
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
          {single
            ? `${GILI.name} offers one plan for this booking.`
            : `${GILI.name} set these options for this offer. Money moves off-app — this just records your choice.`}
        </p>
      </div>

      <div style={{ padding: "18px 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        {plans.map((pl) => {
          const on = sel === pl.id;
          return (
            <button
              key={pl.id}
              onClick={() => setSel(pl.id)}
              className="sk-lift"
              style={{
                all: "unset",
                cursor: "pointer",
                boxSizing: "border-box",
                width: "100%",
                background: "#fff",
                borderRadius: 18,
                padding: "16px 17px",
                border: `1.5px solid ${on ? "rgb(var(--brand-primary))" : "rgb(var(--border-subtle))"}`,
                boxShadow: on
                  ? "0 0 0 4px rgb(var(--brand-primary) / .12), 0 14px 30px -16px rgba(17,16,9,.24)"
                  : "0 1px 2px rgba(17,16,9,.04)",
                transition: "border-color .18s, box-shadow .18s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      flexShrink: 0,
                      marginTop: 1,
                      border: `2px solid ${on ? "rgb(var(--brand-primary))" : "rgb(200 192 178)"}`,
                      background: on ? "rgb(var(--brand-primary))" : "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#1a1407",
                    }}
                  >
                    {on && <Ic.check />}
                  </span>
                  <div>
                    <div
                      style={{
                        fontFamily: "Syne",
                        fontWeight: 800,
                        fontSize: 17,
                        letterSpacing: "-0.02em",
                        color: "rgb(17 16 9)",
                      }}
                    >
                      {pl.label}
                    </div>
                    <div
                      style={{
                        fontFamily: "Outfit",
                        fontSize: 12.5,
                        color: "rgb(var(--fg-muted))",
                        marginTop: 2,
                      }}
                    >
                      {pl.tagline}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 8.5,
                      color: "rgb(var(--fg-muted))",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    Due today
                  </div>
                  <div
                    style={{
                      fontFamily: "Syne",
                      fontWeight: 800,
                      fontSize: 20,
                      letterSpacing: "-0.03em",
                      color: on ? "rgb(140 95 6)" : "rgb(17 16 9)",
                    }}
                  >
                    {ils(pl.dueNow)}
                  </div>
                </div>
              </div>
              {/* schedule rows */}
              <div
                style={{
                  marginTop: 13,
                  paddingTop: 13,
                  borderTop: "1px dashed rgb(var(--border-subtle))",
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                }}
              >
                {pl.rows.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        fontFamily: "Outfit",
                        fontSize: 12.5,
                        color: "rgb(61 55 48)",
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 999,
                          background: i === 0 ? "rgb(var(--brand-primary))" : "rgb(17 16 9 / .25)",
                        }}
                      />
                      {r.when}
                    </span>
                    <span
                      style={{
                        fontFamily: "JetBrains Mono",
                        fontSize: 12,
                        color: "rgb(17 16 9)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {ils(r.amt)}
                    </span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: "14px 20px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontFamily: "Outfit",
            fontSize: 11.5,
            color: "rgb(var(--fg-muted))",
            lineHeight: 1.45,
          }}
        >
          <span style={{ marginTop: 1 }}>
            <Ic.shield />
          </span>
          <span>
            The deposit secures your slot and is usually final once {GILI.name} begins. Sessions can
            run on a deposit — downloads unlock at full payment.
          </span>
        </div>
      </div>
    </Screen>
  );
}

/* ====================================================================
   S8 — PAYMENT INSTRUCTIONS  (funnel · off-app pay, v1)
==================================================================== */
function S8Pay({ productId = "g1", planId = "full", hasDetails = true, back, onUpload, toast }) {
  const product = productById(productId);
  const plan = planById(product, planId);

  const copy = (label, value) => {
    toast && toast(`Copied ${label}`);
  };

  const footer = (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        padding: `14px 18px ${HI3 + 10}px`,
        background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 24%)",
      }}
    >
      <PrimaryCTA onClick={onUpload} sub="Money moves off-app · we keep the record">
        I've paid — upload proof <Ic.arrowR />
      </PrimaryCTA>
    </div>
  );

  const MethodRow = ({ icon, name, value, sub }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "14px 16px",
        borderBottom: "1px solid rgb(var(--border-subtle))",
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          flexShrink: 0,
          background: "rgb(17 16 9 / .05)",
          color: "rgb(40 36 30)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 13.5, color: "rgb(17 16 9)" }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: "rgb(var(--fg-muted))",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </div>
      </div>
      <button
        onClick={() => copy(name, value)}
        className="sk-pop"
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "7px 12px",
          borderRadius: 999,
          background: "rgb(var(--brand-primary) / .14)",
          color: "rgb(140 95 6)",
          fontFamily: "Outfit",
          fontWeight: 700,
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        <Ic.copy /> Copy
      </button>
    </div>
  );

  return (
    <Screen
      footer={footer}
      footerH={138}
      header={() => <TopBar title="Payment" sub={plan.label.toUpperCase()} onBack={back} />}
    >
      <div style={{ height: SB3 + 46 }} />

      {/* amount due now */}
      <div style={{ padding: "16px 20px 0" }}>
        <div
          style={{
            background: "rgb(17 16 9)",
            borderRadius: 20,
            padding: "20px 20px 18px",
            color: "rgb(247 243 236)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(120% 90% at 88% 0%, rgb(212 150 10 / .22), transparent 55%)",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 10,
                letterSpacing: "0.16em",
                color: "rgba(247,243,236,.6)",
                textTransform: "uppercase",
              }}
            >
              Amount due now
            </div>
            <div
              style={{
                fontFamily: "Syne",
                fontWeight: 800,
                fontSize: 46,
                letterSpacing: "-0.04em",
                color: "#fff",
                lineHeight: 1,
                marginTop: 7,
              }}
            >
              {ils(plan.dueNow)}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 12,
                fontFamily: "Outfit",
                fontSize: 12.5,
                color: "rgba(247,243,236,.78)",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  background: skSwatch(GILI.hue),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "Syne",
                  fontWeight: 800,
                  fontSize: 9,
                }}
              >
                {GILI.initials}
              </span>
              {product.name} · {plan.label}
            </div>
            {plan.id !== "full" && (
              <div
                style={{
                  marginTop: 13,
                  paddingTop: 13,
                  borderTop: "1px solid rgba(247,243,236,.14)",
                  fontFamily: "JetBrains Mono",
                  fontSize: 10.5,
                  color: "rgba(247,243,236,.6)",
                }}
              >
                {ils(plan.dueNow)} now · {ils(product.price - plan.dueNow)} later ·{" "}
                {ils(product.price)} total
              </div>
            )}
          </div>
        </div>
      </div>

      {/* methods */}
      <div style={{ padding: "18px 20px 0" }}>
        <Eyebrow style={{ marginBottom: 9 }}>How to pay {GILI.name}</Eyebrow>
        {hasDetails ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid rgb(var(--border-subtle))",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(17,16,9,.04)",
            }}
          >
            <MethodRow icon={<Ic.layers />} name="Bank transfer" value={GILI.pay.bank} />
            <div style={{ borderBottom: "none" }}>
              <MethodRowBit toast={toast} />
            </div>
          </div>
        ) : (
          <div
            style={{
              background: "#fff",
              border: "1px dashed rgb(var(--border-strong, 200 192 178))",
              borderRadius: 16,
              padding: "18px 16px",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 999,
                flexShrink: 0,
                background: "rgb(var(--brand-primary) / .14)",
                color: "rgb(140 95 6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.clock />
            </span>
            <div
              style={{
                fontFamily: "Outfit",
                fontSize: 13,
                color: "rgb(61 55 48)",
                lineHeight: 1.5,
              }}
            >
              <b style={{ fontWeight: 600 }}>{GILI.name} will send payment details.</b> You'll get a
              notification — then come back here to upload your proof.
            </div>
          </div>
        )}

        {/* card coming soon (v2) */}
        <div
          style={{
            marginTop: 11,
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "13px 16px",
            background: "rgb(17 16 9 / .035)",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 14,
            opacity: 0.85,
          }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              flexShrink: 0,
              background: "#fff",
              color: "rgb(var(--fg-muted))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgb(var(--border-subtle))",
            }}
          >
            <Ic.cardIc />
          </span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "Outfit",
                fontWeight: 600,
                fontSize: 13.5,
                color: "rgb(var(--fg-muted))",
              }}
            >
              Pay by card
            </div>
            <div
              style={{
                fontFamily: "Outfit",
                fontSize: 11.5,
                color: "rgb(var(--fg-muted) / .8)",
                marginTop: 1,
              }}
            >
              Instant, in-app
            </div>
          </div>
          <Chip tone="plain">Coming soon</Chip>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            marginTop: 14,
            fontFamily: "Outfit",
            fontSize: 12,
            color: "rgb(var(--fg-muted))",
            lineHeight: 1.5,
          }}
        >
          <span style={{ marginTop: 1 }}>
            <Ic.spark />
          </span>
          <span>
            Pay using your bank or Bit, then upload your proof. {GILI.name} confirms it and your
            sessions unlock.
          </span>
        </div>
      </div>
    </Screen>
  );
}

function MethodRowBit({ toast }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 16px" }}>
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 13.5, color: "rgb(17 16 9)" }}
        >
          Bit
        </div>
        <div
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: "rgb(var(--fg-muted))",
            marginTop: 2,
          }}
        >
          {GILI.pay.bit}
        </div>
      </div>
      <button
        onClick={() => toast && toast("Copied Bit number")}
        className="sk-pop"
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "7px 12px",
          borderRadius: 999,
          background: "rgb(var(--brand-primary) / .14)",
          color: "rgb(140 95 6)",
          fontFamily: "Outfit",
          fontWeight: 700,
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        <Ic.copy /> Copy
      </button>
    </div>
  );
}

/* ====================================================================
   S9 — UPLOAD PROOF OF PAYMENT (POP)  (funnel · Gate 2)
   states: empty / attached / uploading / awaiting / rejected / paid
==================================================================== */
function S9Proof({
  productId = "g1",
  planId = "split",
  state = "empty",
  back,
  onSend,
  onHome,
  onAttach,
  onRemove,
  toast,
}) {
  const product = productById(productId);
  const plan = planById(product, planId);
  const covers = plan.dueNow;
  const total = product.price;
  const paidSoFar = state === "paid" ? total : 0;

  const hasFile = state === "attached" || state === "uploading";
  const submitted = state === "awaiting" || state === "paid";

  let footer = null;
  if (state === "paid") {
    footer = (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          padding: `14px 18px ${HI3 + 10}px`,
          background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 24%)",
        }}
      >
        <PrimaryCTA onClick={onHome} sub="Sessions unlocked">
          Done <Ic.arrowR />
        </PrimaryCTA>
      </div>
    );
  } else if (state === "awaiting") {
    footer = (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          padding: `14px 18px ${HI3 + 10}px`,
          background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 24%)",
        }}
      >
        <SecondaryCTA onClick={onHome}>Back to Home</SecondaryCTA>
      </div>
    );
  } else {
    footer = (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          padding: `14px 18px ${HI3 + 10}px`,
          background: "linear-gradient(180deg, rgba(247,243,236,0) 0%, rgba(247,243,236,.96) 24%)",
        }}
      >
        <PrimaryCTA
          onClick={() => hasFile && onSend()}
          disabled={!hasFile}
          glow={hasFile}
          sub={
            hasFile
              ? `Covers ${ils(covers)} · sent to ${GILI.name}`
              : "Attach a screenshot or PDF first"
          }
        >
          {state === "uploading" ? (
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
              Uploading…
            </>
          ) : (
            <>
              Send proof <Ic.arrowR />
            </>
          )}
        </PrimaryCTA>
      </div>
    );
  }

  return (
    <Screen
      footer={footer}
      footerH={132}
      header={() => <TopBar title="Upload proof" sub={`OF ${ils(total)}`} onBack={back} />}
    >
      <div style={{ height: SB3 + 46 }} />

      <div style={{ padding: "14px 20px 0" }}>
        <h1
          style={{
            fontFamily: "Syne",
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "-0.035em",
            margin: 0,
            color: "rgb(17 16 9)",
            lineHeight: 1.12,
          }}
        >
          {state === "paid"
            ? "Payment complete"
            : state === "rejected"
              ? "Re-upload your proof"
              : "Upload your proof"}
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
          {state === "paid"
            ? `You've paid ${GILI.name} in full. Your sessions and downloads are unlocked.`
            : state === "awaiting"
              ? `Sent to ${GILI.name} for review. We'll let you know the moment they confirm it.`
              : state === "rejected"
                ? `${GILI.name} couldn't confirm the last screenshot. Have another go — no limit.`
                : `Snap or attach the bank / Bit confirmation. ${GILI.name} checks it and your sessions unlock.`}
        </p>
      </div>

      {/* running total */}
      <div style={{ padding: "18px 20px 0" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid rgb(var(--border-subtle))",
            borderRadius: 16,
            padding: "15px 16px",
            boxShadow: "0 1px 2px rgba(17,16,9,.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <span style={{ fontFamily: "Outfit", fontSize: 12.5, color: "rgb(var(--fg-muted))" }}>
              Paid so far
            </span>
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 12.5,
                color: "rgb(17 16 9)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <b style={{ color: paidSoFar > 0 ? "rgb(21 110 60)" : "rgb(17 16 9)" }}>
                {ils(paidSoFar)}
              </b>{" "}
              <span style={{ color: "rgb(var(--fg-muted))" }}>of {ils(total)}</span>
            </span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: "rgb(17 16 9 / .07)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 999,
                width: `${Math.max(4, (paidSoFar / total) * 100)}%`,
                background:
                  paidSoFar >= total
                    ? "rgb(34 197 94)"
                    : "linear-gradient(90deg, rgb(var(--brand-primary)), rgb(176 104 48))",
                transition: "width .4s",
              }}
            />
          </div>
          {state !== "paid" && (
            <div
              style={{
                marginTop: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontFamily: "Outfit",
                fontSize: 12,
              }}
            >
              <span style={{ color: "rgb(var(--fg-muted))" }}>This proof covers</span>
              <span
                style={{
                  fontFamily: "Syne",
                  fontWeight: 800,
                  fontSize: 15,
                  color: "rgb(140 95 6)",
                }}
              >
                {ils(covers)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* upload tile / state */}
      <div style={{ padding: "16px 20px 0" }}>
        {state === "paid" ? (
          <div
            style={{
              background: "rgb(34 197 94 / .08)",
              border: "1px solid rgb(34 197 94 / .3)",
              borderRadius: 18,
              padding: "22px 18px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 999,
                background: "rgb(34 197 94)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.checkFill />
            </span>
            <div
              style={{ fontFamily: "Syne", fontWeight: 800, fontSize: 17, color: "rgb(21 110 60)" }}
            >
              Paid in full — sessions unlocked
            </div>
            <div style={{ fontFamily: "Outfit", fontSize: 13, color: "rgb(40 36 30)" }}>
              Downloads unlock too. Nice work.
            </div>
          </div>
        ) : submitted ? (
          <ProofItem state="pending" covers={covers} />
        ) : (
          <>
            {state === "rejected" && (
              <div
                style={{
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "13px 15px",
                  background: "rgb(220 38 38 / .07)",
                  border: "1px solid rgb(220 38 38 / .25)",
                  borderRadius: 14,
                }}
              >
                <span style={{ color: "rgb(176 38 30)", marginTop: 1 }}>
                  <Ic.alert style={{ width: 16, height: 16 }} />
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: "Outfit",
                      fontWeight: 600,
                      fontSize: 13,
                      color: "rgb(176 38 30)",
                    }}
                  >
                    Proof needs re-uploading
                  </div>
                  <div
                    style={{
                      fontFamily: "Outfit",
                      fontSize: 12,
                      color: "rgb(120 40 34)",
                      marginTop: 2,
                      lineHeight: 1.45,
                    }}
                  >
                    “Screenshot was cut off — please include the date & amount.” — {GILI.name}
                  </div>
                </div>
              </div>
            )}
            {hasFile ? (
              <div
                style={{
                  background: "#fff",
                  border: "1.5px solid rgb(var(--brand-primary))",
                  borderRadius: 18,
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  boxShadow: "0 0 0 4px rgb(var(--brand-primary) / .1)",
                }}
              >
                <FauxReceipt />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "Outfit",
                      fontWeight: 600,
                      fontSize: 13.5,
                      color: "rgb(17 16 9)",
                    }}
                  >
                    transfer-{ils(covers).replace("₪", "")}.png
                  </div>
                  <div
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 10.5,
                      color: "rgb(var(--fg-muted))",
                      marginTop: 3,
                    }}
                  >
                    PNG · 0.8 MB {state === "uploading" && "· uploading…"}
                  </div>
                </div>
                {state !== "uploading" && (
                  <button
                    onClick={onRemove}
                    className="sk-pop"
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgb(var(--fg-muted))",
                      background: "rgb(17 16 9 / .05)",
                    }}
                  >
                    <Ic.close style={{ width: 15, height: 15 }} />
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={onAttach}
                className="sk-pop"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  boxSizing: "border-box",
                  width: "100%",
                  background: "rgb(17 16 9 / .02)",
                  border: "2px dashed rgb(200 192 178)",
                  borderRadius: 18,
                  padding: "30px 18px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 999,
                    background: "rgb(var(--brand-primary) / .14)",
                    color: "rgb(140 95 6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <path
                      d="M12 16V5m0 0l-4 4m4-4l4 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path d="M5 16v2a1 1 0 001 1h12a1 1 0 001-1v-2" strokeLinecap="round" />
                  </svg>
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: "Syne",
                      fontWeight: 800,
                      fontSize: 16,
                      color: "rgb(17 16 9)",
                    }}
                  >
                    Add your proof
                  </div>
                  <div
                    style={{
                      fontFamily: "Outfit",
                      fontSize: 12.5,
                      color: "rgb(var(--fg-muted))",
                      marginTop: 3,
                    }}
                  >
                    Take a photo or choose a file
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                  <Chip tone="plain">Camera</Chip>
                  <Chip tone="plain">Files</Chip>
                </div>
              </button>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 11,
                fontFamily: "Outfit",
                fontSize: 11.5,
                color: "rgb(var(--fg-muted))",
              }}
            >
              <Ic.shield /> JPG, PNG, HEIC or PDF · paying in installments? Upload one each time.
            </div>
          </>
        )}
      </div>
    </Screen>
  );
}

/* a submitted proof line item */
function ProofItem({ state, covers }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid rgb(var(--border-subtle))",
        borderRadius: 16,
        padding: 13,
        display: "flex",
        alignItems: "center",
        gap: 13,
        boxShadow: "0 1px 2px rgba(17,16,9,.04)",
      }}
    >
      <FauxReceipt />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontFamily: "Outfit", fontWeight: 600, fontSize: 13.5, color: "rgb(17 16 9)" }}
        >
          transfer-{ils(covers).replace("₪", "")}.png
        </div>
        <div
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 10.5,
            color: "rgb(var(--fg-muted))",
            marginTop: 3,
          }}
        >
          Sent just now · {ils(covers)}
        </div>
      </div>
      <StatusPill tone="pending">In review</StatusPill>
    </div>
  );
}

/* a small stylised bank-confirmation thumbnail */
function FauxReceipt() {
  return (
    <span
      style={{
        width: 52,
        height: 52,
        borderRadius: 11,
        flexShrink: 0,
        background: "linear-gradient(160deg, oklch(0.92 0.02 250), oklch(0.84 0.03 250))",
        border: "1px solid rgb(17 16 9 / .08)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 3,
        padding: 8,
        overflow: "hidden",
      }}
    >
      <span
        style={{ height: 4, width: "70%", borderRadius: 2, background: "rgb(17 16 9 / .22)" }}
      />
      <span
        style={{ height: 4, width: "90%", borderRadius: 2, background: "rgb(17 16 9 / .12)" }}
      />
      <span
        style={{
          height: 6,
          width: "50%",
          borderRadius: 2,
          background: "rgb(34 130 70 / .55)",
          marginTop: 2,
        }}
      />
    </span>
  );
}

Object.assign(window, { S7Plan, S8Pay, S9Proof, buildPlans, planById });
