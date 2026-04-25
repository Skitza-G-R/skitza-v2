"use client";

import { useState } from "react";

// FeaturesTabs — verbatim port of source HTML lines 1444-1660.
//
// Source-vs-port differences:
//   - The source mutates DOM via classList.add/remove on click handlers
//     (script lines 1948-1958). React port uses useState + className
//     interpolation. Net behaviour identical: clicking a tab makes its
//     `.feature-tab` and matching `.feature-content` element gain the
//     `active` modifier; the others lose it.
//   - The "feature-indicator" (sliding amber bar at source line 1454)
//     is purely visual — its position is set by the script via
//     getBoundingClientRect calculations. Skipping the dynamic
//     positioning in the React port; the bar still renders but stays
//     at the top. Visual nicety, not a functional regression. (Future
//     enhancement: useRef + ResizeObserver if we want it to slide.)
//
// Tests pin FEATURE_TABS, featureTabClassName, featureContentClassName.

// Pure helpers — exported so the test suite can pin the active-class
// rule without needing to render React.
export function featureTabClassName(index: number, activeIndex: number) {
  return index === activeIndex ? "feature-tab active" : "feature-tab";
}
export function featureContentClassName(index: number, activeIndex: number) {
  return index === activeIndex ? "feature-content active" : "feature-content";
}

// FEATURE_TABS — the 7 carousel labels in source order. Adding/removing
// a tab requires updating both the labels here AND the
// `feature-content` panels rendered below; the test pins this exact
// array so a drift fails fast.
export const FEATURE_TABS = [
  "Storefront & Booking",
  "Payments on autopilot",
  "Files & Feedback",
  "Client history",
  "Follow-up on autopilot",
  "Lead Management",
  "Contracts & Protection",
] as const;

export function FeaturesTabs() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">03</span>
          <span className="label">What Skitza does</span>
          <h2 className="syne">
            Your studio.<br />On autopilot.
          </h2>
        </div>

        <div className="features-layout reveal-up delay-1">
          <div className="features-list">
            <div className="feature-indicator" id="feature-indicator" />
            {FEATURE_TABS.map((label, i) => (
              <button
                key={label}
                type="button"
                className={featureTabClassName(i, activeIndex)}
                data-index={i}
                onClick={() => {
                  setActiveIndex(i);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="features-views">
            {/* 0. Storefront & Booking */}
            <div
              className={featureContentClassName(0, activeIndex)}
              id="feat-0"
            >
              <h3>Sell packages, not just time.</h3>
              <p>
                Share your Skitza link as your personal storefront. Clients
                select a service (e.g. &quot;Full Production&quot;), pick a
                date, and pay the deposit — all in one flow.
                <br />
                No more &quot;does Thursday at 4 work?&quot;
              </p>
              <div
                className="feature-mockup"
                style={{ justifyContent: "center" }}
              >
                <div
                  style={{
                    background: "var(--dark-surface)",
                    border: "1px solid rgba(212,150,10,0.5)",
                    borderRadius: 6,
                    padding: 12,
                    marginBottom: 16,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    textAlign: "left",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "var(--amber)",
                      }}
                    >
                      Full Production Package
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--dark-body)",
                        marginTop: 2,
                      }}
                    >
                      Includes beat, tracking, and mix
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-head)",
                      fontWeight: 700,
                      color: "var(--dark-text)",
                    }}
                  >
                    $1,500
                  </div>
                </div>
                <div className="mu-booking-grid">
                  <div className="mu-day">Mon</div>
                  <div className="mu-day">Tue</div>
                  <div className="mu-day">Wed</div>
                  <div className="mu-day">Thu</div>
                  <div className="mu-day">Fri</div>
                  <div className="mu-slot">10am</div>
                  <div className="mu-slot">10am</div>
                  <div className="mu-slot">10am</div>
                  <div className="mu-slot">10am</div>
                  <div className="mu-slot">10am</div>
                  <div className="mu-slot">1pm</div>
                  <div className="mu-slot">1pm</div>
                  <div className="mu-slot">1pm</div>
                  <div className="mu-slot">1pm</div>
                  <div className="mu-slot">1pm</div>
                  <div className="mu-slot">4pm</div>
                  <div className="mu-slot active">3pm</div>
                  <div className="mu-slot">4pm</div>
                  <div className="mu-slot">4pm</div>
                  <div className="mu-slot">4pm</div>
                </div>
                <div className="mu-confirm-card">
                  <div>Marcus T. · 2hr session · $150 deposit paid</div>
                  <div style={{ color: "var(--amber)", fontWeight: "bold" }}>
                    ✓
                  </div>
                </div>
              </div>
            </div>

            {/* 1. Payments */}
            <div
              className={featureContentClassName(1, activeIndex)}
              id="feat-1"
            >
              <h3>Payments on autopilot</h3>
              <p>
                Clients pay the deposit when they book — no invoice needed.
                <br />
                A contract is sent automatically and signed before the session.
                <br />
                After the session, the balance is collected without you asking.
                <br />
                Money in. No chasing. No awkward follow-ups.
              </p>
              <div className="feature-mockup" style={{ padding: 16 }}>
                <div className="mu-inv-main">
                  <div className="mu-inv-head">
                    <span>Invoice #0042 · Marcus T.</span>
                    <span className="mu-badge">Paid ✓</span>
                  </div>
                  <div className="mu-inv-row">
                    <span>Recording session 2hr</span>
                    <span>$300</span>
                  </div>
                  <div className="mu-inv-row">
                    <span>Mix revision</span>
                    <span>$150</span>
                  </div>
                  <div className="mu-inv-total">
                    <span>Total</span>
                    <span>$450</span>
                  </div>
                </div>
                <div>
                  <div className="mu-inv-mini">
                    <span>#0043 · Alex D.</span>
                    <span
                      className="mu-badge ghost"
                      style={{
                        color: "var(--amber)",
                        borderColor: "rgba(212,150,10,0.3)",
                      }}
                    >
                      Pending
                    </span>
                  </div>
                  <div className="mu-inv-mini">
                    <span>#0041 · Jordan S.</span>
                    <span className="mu-badge copper">Overdue</span>
                  </div>
                  <div className="mu-inv-mini">
                    <span>#0040 · Marcus T.</span>
                    <span className="mu-badge">Paid ✓</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Files & Feedback */}
            <div
              className={featureContentClassName(2, activeIndex)}
              id="feat-2"
            >
              <h3>
                Stream freely.<br />Download when paid.
              </h3>
              <p>
                Clients can listen to the latest mix and leave timestamped
                feedback. &quot;Fix the snare at 1:42&quot; stays at 1:42.
              </p>
              <p>
                But the high-res download button?{" "}
                <strong>
                  That stays securely locked until the final invoice is paid.
                </strong>
                <br />
                Deliver files via a clean, branded page. No more chasing money
                after sending the final WAV.
              </p>
              <div className="feature-mockup waveform-mockup">
                <div className="mu-panel">
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginBottom: 16,
                      overflowX: "auto",
                      paddingBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        background: "rgba(212,150,10,0.15)",
                        color: "var(--amber)",
                        border: "1px solid var(--amber)",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 10,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Mix V3 (Current)
                    </div>
                    <div
                      style={{
                        background: "var(--dark-elevated)",
                        color: "var(--dark-body)",
                        border: "1px solid var(--dark-border)",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Mix V2 (Approved)
                    </div>
                    <div
                      style={{
                        background: "var(--dark-elevated)",
                        color: "var(--dark-body)",
                        border: "1px solid var(--dark-border)",
                        borderRadius: 4,
                        padding: "4px 8px",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Mix V1
                    </div>
                  </div>
                  <div className="track-title">Draft_v3_unreleased.wav</div>
                  <div className="player-bar-container">
                    <div className="player-progress" />
                    <div className="player-pin pin-1" />
                    <div className="player-pin pin-2" />
                  </div>
                  <div className="comment-bubble">
                    <div className="comment-header">
                      <span className="comment-time">1:42</span>
                      <span
                        style={{
                          color: "var(--amber)",
                          fontSize: 10,
                          textTransform: "uppercase",
                          fontWeight: "bold",
                        }}
                      >
                        ✓ Resolved
                      </span>
                    </div>
                    &quot;Snare too loud here&quot;
                  </div>
                </div>
                <div className="mu-panel mu-delivery-flex">
                  <div>
                    <div className="track-title" style={{ marginBottom: 2 }}>
                      Final Mix + Stems.zip
                    </div>
                    <div style={{ fontSize: 11, color: "var(--dark-body)" }}>
                      Ready for download · 450MB
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      className="mu-dl-btn"
                      style={{
                        background: "rgba(212,150,10,0.1)",
                        color: "rgba(255,255,255,0.4)",
                        border: "1px solid rgba(212,150,10,0.3)",
                        cursor: "not-allowed",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      🔒 Download
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "var(--copper)",
                        marginTop: 6,
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                      }}
                    >
                      Unlocks after $150 payment
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Client history */}
            <div
              className={featureContentClassName(3, activeIndex)}
              id="feat-3"
            >
              <h3>Client Management</h3>
              <p>
                Every client&apos;s history, sessions, payments, notes,
                <br />
                and files in one place. Know who&apos;s coming back,
                <br />
                who owes you, and who sent you three referrals.
              </p>
              <div className="feature-mockup" style={{ padding: 24 }}>
                <div className="mu-crm-head">
                  <div className="mu-avatar">MT</div>
                  <div className="mu-crm-name">Marcus T.</div>
                </div>
                <div className="mu-crm-stats">
                  <div className="mu-stat-chip">8 sessions</div>
                  <div className="mu-stat-chip">$3,200 total</div>
                  <div className="mu-stat-chip">2 referrals</div>
                </div>
                <div>
                  <div className="mu-feed-item">
                    <div className="mu-dot" />
                    <div>Session booked · 2 days ago</div>
                  </div>
                  <div className="mu-feed-item">
                    <div className="mu-dot" />
                    <div>Invoice paid · 5 days ago</div>
                  </div>
                  <div className="mu-feed-item">
                    <div className="mu-dot" />
                    <div>Files delivered · 1 week ago</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Follow-up on autopilot */}
            <div
              className={featureContentClassName(4, activeIndex)}
              id="feat-4"
            >
              <h3>Follow-up on autopilot</h3>
              <p>
                Booking confirmations, session reminders, post-session
                thank-yous,
                <br />
                payment nudges — sent via WhatsApp or email, in your voice.
                <br />
                Clients feel taken care of. You didn&apos;t lift a finger.
              </p>
              <div className="feature-mockup">
                <div className="mu-chat">
                  <div className="mu-bubble left">
                    Hey Marcus, your session is confirmed for Tuesday at 3pm 🎛
                  </div>
                  <div className="mu-bubble left">
                    Your files are ready — click here to download
                  </div>
                  <div className="mu-bubble right">Perfect, thanks!</div>
                  <div className="mu-chat-note">
                    Sent automatically by Skitza
                  </div>
                </div>
              </div>
            </div>

            {/* 5. Lead Management */}
            <div
              className={featureContentClassName(5, activeIndex)}
              id="feat-5"
            >
              <h3>Lead Management</h3>
              <p>
                Someone DMs and goes quiet?
                <br />
                Skitza tracks the lead, sends automated follow-ups,
                <br />
                and tells you exactly when to reach back out.
                <br />
                Your pipeline, managed.
              </p>
              <div className="feature-mockup" style={{ padding: 16 }}>
                <div className="mu-board">
                  <div className="mu-col">
                    <div className="mu-col-title">New</div>
                    <div className="mu-l-card">
                      <div className="mu-l-name">Sarah J.</div>
                      <div className="mu-l-sub">DM inquiry · Today</div>
                    </div>
                    <div className="mu-l-card" style={{ opacity: 0.5 }}>
                      <div className="mu-l-name">Jay K.</div>
                      <div className="mu-l-sub">Instagram DM</div>
                    </div>
                  </div>
                  <div
                    className="mu-col"
                    style={{ border: "1px dashed rgba(255,255,255,0.05)" }}
                  >
                    <div className="mu-col-title">Following Up</div>
                    <div className="mu-l-card active">
                      <div className="mu-l-name">Marcus T.</div>
                      <div className="mu-l-sub">Rates sent</div>
                      <div className="mu-l-action">
                        <div className="mu-pulse-dot" /> Auto-follow-up sent
                      </div>
                    </div>
                    <div className="mu-l-card" style={{ opacity: 0.5 }}>
                      <div className="mu-l-name">Dana R.</div>
                      <div className="mu-l-sub">No reply · 3 days</div>
                    </div>
                  </div>
                  <div className="mu-col">
                    <div className="mu-col-title">Booked</div>
                    <div className="mu-l-card" style={{ opacity: 0.6 }}>
                      <div className="mu-l-name">Alex D.</div>
                      <div className="mu-l-sub">Deposit paid</div>
                    </div>
                    <div className="mu-l-card" style={{ opacity: 0.4 }}>
                      <div className="mu-l-name">Mia L.</div>
                      <div className="mu-l-sub">Session confirmed</div>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid var(--dark-border)",
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "var(--dark-body)",
                  }}
                >
                  <span>6 active leads</span>
                  <span style={{ color: "var(--amber)" }}>
                    2 need follow-up
                  </span>
                </div>
              </div>
            </div>

            {/* 6. Contracts & Protection */}
            <div
              className={featureContentClassName(6, activeIndex)}
              id="feat-6"
            >
              <h3>Zero disputes. Guaranteed.</h3>
              <p>
                Don&apos;t start a session without a signature. Skitza generates
                custom copyright agreements and split sheets that clients
                digitally sign right from their phone. Your final files remain
                securely locked until the balance is completely cleared.
              </p>
              <div
                className="feature-mockup mu-contract-split"
                style={{
                  padding: 24,
                  background:
                    "repeating-linear-gradient(45deg, var(--dark-elevated), var(--dark-elevated) 10px, var(--dark-surface) 10px, var(--dark-surface) 20px)",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    background: "var(--light-bg)",
                    color: "var(--light-text)",
                    padding: 16,
                    borderRadius: 6,
                    boxShadow: "0 15px 40px rgba(0,0,0,0.4)",
                    transform: "rotate(-2deg)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'Times New Roman', serif",
                        fontSize: 14,
                        fontWeight: "bold",
                        borderBottom: "2px solid #000",
                        paddingBottom: 4,
                        marginBottom: 8,
                        textAlign: "center",
                      }}
                    >
                      Master Agreement
                    </div>
                    <div
                      style={{ fontSize: 9, color: "#444", lineHeight: 1.5 }}
                    >
                      Artist agrees to the 50% publishing split and
                      acknowledges files remain securely locked until the
                      balance is cleared.
                    </div>
                  </div>
                  <div
                    style={{
                      borderTop: "1px dashed #ccc",
                      paddingTop: 8,
                      marginTop: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 8,
                          color: "#666",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          marginBottom: 2,
                        }}
                      >
                        Artist Signature
                      </div>
                      <div
                        style={{
                          fontFamily: "cursive",
                          fontSize: 20,
                          color: "#0015ff",
                          transform: "rotate(-5deg)",
                          display: "inline-block",
                        }}
                      >
                        Marcus T.
                      </div>
                    </div>
                    <div
                      style={{
                        background: "#27ae60",
                        color: "white",
                        fontSize: 8,
                        padding: "3px 6px",
                        borderRadius: 4,
                        fontWeight: "bold",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      Verified
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    background: "var(--dark-surface)",
                    border: "1px solid var(--dark-border)",
                    borderRadius: 6,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                    transform: "rotate(1deg)",
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: 13,
                      marginBottom: 4,
                    }}
                  >
                    Final_Master.wav
                  </div>
                  <div
                    style={{
                      background: "rgba(212,150,10,0.05)",
                      border: "1px solid rgba(212,150,10,0.3)",
                      color: "rgba(255,255,255,0.4)",
                      padding: "8px 16px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 12,
                      cursor: "not-allowed",
                    }}
                  >
                    🔒 Download
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "var(--amber)",
                      marginTop: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Unlocks after $150 final payment
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
