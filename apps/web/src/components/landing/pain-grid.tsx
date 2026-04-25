// PainGrid — verbatim port of source HTML lines 1278-1410.
//
// Server component: pure JSX, zero state, zero interactivity. The
// hover effects (mouse spotlight, expression changes) are CSS-only,
// driven by classes already present in landing.css. The mouse-tracking
// CSS variables (`--mouse-x`/`--mouse-y` from source script line 1976-
// 1985) are decorative — without JS the spotlight stays centred,
// which still reads as a polished hover state.
export function PainGrid() {
  return (
    <section className="section" id="pain">
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">01</span>
          <span className="label" style={{ color: "var(--copper)" }}>
            Sound familiar?
          </span>
          <h2 className="syne">
            You became a producer.<br />Not a secretary.
          </h2>
          <p className="body-text" style={{ marginLeft: 0 }}>
            Yet here you are — scheduling, invoicing, chasing,
            <br />
            reminding, resending, following up.
            <br />
            Every day. Before you&apos;ve played a single note.
          </p>
        </div>

        <div className="pain-grid">
          <div className="card pain-card reveal-up delay-1">
            <div className="pain-ill">
              <div className="meme-face face-1">
                <div className="f1-acc">...same answer</div>
                <div className="m-brow l" />
                <div className="m-brow r" />
                <div className="m-eye l" />
                <div className="m-eye r" />
                <div className="m-mouth" />
              </div>
              <div className="ill-chat-wrap">
                <div className="ill-bubble">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="ill-bubble-2">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
            <h3>&quot;What are your rates?&quot;</h3>
            <p>
              You&apos;ve copy-pasted that answer so many times
              <br />
              you could send it in your sleep.
            </p>
          </div>

          <div className="card pain-card reveal-up delay-2">
            <div className="pain-ill">
              <div className="meme-face face-2">
                <div className="f2-acc" />
                <div className="m-brow l" />
                <div className="m-brow r" />
                <div className="m-eye l" />
                <div className="m-eye r" />
                <div className="m-mouth" />
              </div>
              <div className="ill-calendar">
                <div className="ill-cal-cell">×</div>
                <div className="ill-cal-cell">×</div>
                <div className="ill-cal-cell amber-q">?</div>
                <div className="ill-cal-cell">×</div>
                <div className="ill-cal-cell">×</div>
                <div className="ill-cal-cell amber-q">?</div>
                <div className="ill-cal-cell">×</div>
                <div className="ill-cal-cell">×</div>
              </div>
            </div>
            <h3>The scheduling nightmare</h3>
            <p>
              6 messages to confirm one session.
              <br />
              &quot;Does Tuesday work? Actually Thursday?&quot;
            </p>
          </div>

          <div className="card pain-card reveal-up delay-3">
            <div className="pain-ill">
              <div className="meme-face face-3">
                <div className="f3-acc" />
                <div className="m-brow l" />
                <div className="m-brow r" />
                <div className="m-eye l" />
                <div className="m-eye r" />
                <div className="m-mouth" />
              </div>
              <div className="ill-stack-wrap">
                <div className="ill-inv-card ill-inv-1" />
                <div className="ill-inv-card ill-inv-2" />
                <div className="ill-inv-card ill-inv-3">
                  <div className="ill-stamp">OVERDUE</div>
                </div>
              </div>
            </div>
            <h3>Unpaid invoices stacking up</h3>
            <p>
              Chasing clients for money is the worst part
              <br />
              of the job. Somehow it&apos;s also your job.
            </p>
          </div>

          <div className="card pain-card reveal-up delay-4">
            <div className="pain-ill">
              <div className="meme-face face-4">
                <div className="f4-acc">3</div>
                <div className="m-brow l" />
                <div className="m-brow r" />
                <div className="m-eye l" />
                <div className="m-eye r" />
                <div className="m-mouth" />
              </div>
              <div className="ill-resend-wrap">
                <div className="ill-resend-arrow" />
                <div className="ill-file-icon" />
                <div className="ill-resend-num">3</div>
              </div>
            </div>
            <h3>&quot;Can you resend the files?&quot;</h3>
            <p>
              For the third time.
              <br />
              On WhatsApp. At midnight.
            </p>
          </div>

          <div className="card pain-card reveal-up delay-5">
            <div className="pain-ill">
              <div className="meme-face face-5">
                <div className="f5-acc">
                  <span className="f5-z1">z</span>
                  <span className="f5-z2">z</span>
                  <span className="f5-z3">z</span>
                </div>
                <div className="m-brow l" />
                <div className="m-brow r" />
                <div className="m-eye l" />
                <div className="m-eye r" />
                <div className="m-mouth" />
              </div>
              <div className="ill-loop-wrap">
                <div className="ill-loop-border" />
                <div className="ill-loop-content">
                  <span>DMs</span>{" "}
                  <span className="ill-loop-arrow-right">→</span>{" "}
                  <span>Session</span>{" "}
                  <span className="ill-loop-arrow-right">→</span>{" "}
                  <span>Invoice</span>{" "}
                  <span className="ill-loop-arrow-right">→</span>{" "}
                  <span>Chase</span>
                </div>
              </div>
            </div>
            <h3>Doing it all again tomorrow</h3>
            <p>
              Wake up. Answer DMs. Make a beat.
              <br />
              Chase payment. Repeat until you hate this.
            </p>
          </div>

          <div className="card pain-card reveal-up delay-6">
            <div className="pain-ill">
              <div className="meme-face face-6">
                <div className="f6-acc">
                  <div className="f6-arc f6-a1" />
                  <div className="f6-arc f6-a2" />
                  <div className="f6-arc f6-a3" />
                </div>
                <div className="m-brow l" />
                <div className="m-brow r" />
                <div className="m-eye l" />
                <div className="m-eye r" />
                <div className="m-mouth" />
              </div>
              <div className="ill-mental-wrap">
                <div className="ill-batt">
                  <div className="ill-batt-level" />
                </div>
                <div className="ill-drain-bolt" />
              </div>
            </div>
            <h3>Mental bandwidth, gone</h3>
            <p>
              By the time you open your DAW,
              <br />
              you&apos;re already running on empty.
            </p>
          </div>
        </div>

        <h3
          className="syne reveal-up"
          style={{
            textAlign: "center",
            color: "var(--amber)",
            marginTop: 56,
            fontSize: "clamp(20px, 3vw, 28px)",
            letterSpacing: "-0.01em",
          }}
        >
          Every one of these problems disappears with Skitza. ↓
        </h3>
      </div>
    </section>
  );
}
