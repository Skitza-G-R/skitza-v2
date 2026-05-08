import { Fragment } from "react";

import { DemoVideo } from "./demo-video";
import { WaitlistForm } from "./waitlist-form";

// Hero — verbatim port of the homepage hero (apps/web/src/components/
// landing/landing-page.tsx Hero). Differences from homepage:
//   1. Single CTA = WaitlistForm (no Get demo / See how it works pair).
//   2. Right side hosts the iframe demo, not the homepage's
//      hand-rolled product peek.
//
// Structure (matches homepage):
//   - Dark background #111009 + animate-shine + hero-grid-bg
//   - Eyebrow pill (amber-tinted)
//   - H1 split per-word with .hero-word class for staggered word-fade
//     (fires once on .landing-v3-root.is-loaded)
//   - Subhead in Outfit (cream-on-dark)
//   - Waitlist form (single CTA)
//   - Social proof strip (avatar pile + 5-star + 340+ count)
//   - HeroPeek (right) — browser-chrome wrapper with iframe demo

interface HeroLine {
  words: string[];
  /** Last word of last line gets the amber accent dot. */
  amberDotOnLastWord?: boolean;
}

const EN_LINES: HeroLine[] = [
  { words: ["You’re", "a", "producer."] },
  { words: ["Not", "an", "assistant."], amberDotOnLastWord: true },
];

const HE_LINES: HeroLine[] = [
  { words: ["אתה", "מפיק."] },
  { words: ["לא", "מזכירה."], amberDotOnLastWord: true },
];

export function HeroSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  const thanksHref = isHe ? "/get-started/he/thanks" : "/get-started/thanks";
  const lines = isHe ? HE_LINES : EN_LINES;
  let wordIndex = 0;

  return (
    <section
      id="hero"
      className="relative overflow-hidden"
      style={{ background: "transparent", color: "#F2EDE6", padding: "48px 20px 72px" }}
    >
      <div className="animate-shine" />
      <div className="hero-grid-bg is-dark absolute inset-0 pointer-events-none opacity-100" />

      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left — copy + form */}
        <div className="sk-reveal-left">
          <div
            className="mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{
              background: "rgba(212,150,10,0.12)",
              borderColor: "rgba(212,150,10,0.3)",
              color: "rgb(var(--brand-primary))",
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: "rgb(var(--brand-primary))",
                boxShadow: "0 0 10px rgb(var(--brand-primary))",
              }}
            />
            {isHe ? "רישום מוקדם פתוח" : "Now booking · early access"}
          </div>

          <h1
            className="font-syne m-0 font-extrabold"
            style={{
              fontSize: "clamp(40px, 5vw, 68px)",
              letterSpacing: "-0.038em",
              lineHeight: 0.98,
            }}
          >
            {lines.map((line, lineIdx) => {
              const isLastLine = lineIdx === lines.length - 1;
              return (
                <span key={lineIdx} className="block">
                  {line.words.map((word, wIdx) => {
                    const i = wordIndex++;
                    const isLastWord = wIdx === line.words.length - 1;
                    const trailingSpace = wIdx < line.words.length - 1;
                    if (
                      isLastLine &&
                      isLastWord &&
                      line.amberDotOnLastWord === true
                    ) {
                      const stripped = word.replace(/\.$/, "");
                      return (
                        <Fragment key={wIdx}>
                          <span
                            className="hero-word"
                            style={{ ["--w-i" as string]: i }}
                          >
                            {stripped}
                            <span
                              style={{ color: "rgb(var(--brand-primary))" }}
                            >.</span>
                          </span>
                        </Fragment>
                      );
                    }
                    return (
                      <Fragment key={wIdx}>
                        <span
                          className="hero-word"
                          style={{ ["--w-i" as string]: i }}
                        >
                          {word}
                        </span>
                        {trailingSpace ? " " : ""}
                      </Fragment>
                    );
                  })}
                </span>
              );
            })}
          </h1>

          <p
            className="mt-7 max-w-xl text-[17px] leading-[1.55]"
            style={{ color: "rgb(242 237 230 / 0.6)", letterSpacing: "-0.005em" }}
          >
            {isHe
              ? "סקיצה מאחדת WhatsApp, Drive, Notion, DocuSign ו-Stripe לקישור אחד שהלקוחות זוכרים. הם מזמינים סשן, חותמים על חוזה ומשלמים — אוטומטית. המיקס מוגן עד שהחשבונית סגורה."
              : "Skitza replaces Calendly, DocuSign, Stripe, Notion and WhatsApp with one link your clients remember. Sessions book themselves. Deposits land before the downbeat. The mix delivers itself the moment the invoice clears."}
          </p>

          <div className="mt-8 max-w-xl">
            <WaitlistForm locale={locale} thanksHref={thanksHref} />
            <p
              className="mt-3 text-[12.5px]"
              style={{ color: "rgb(242 237 230 / 0.5)" }}
            >
              {isHe
                ? "בלי ספאם. נשלח לך מייל ברגע שהמקום שלך מתפנה."
                : "No spam. We’ll email you the moment your spot opens."}
            </p>
          </div>

          {/* Social proof strip — same shape as the homepage hero */}
          <div className="mt-10 flex flex-wrap items-center gap-5">
            <div className="flex">
              {(["grad-amber", "grad-rose", "grad-violet", "grad-emerald"] as const).map(
                (g, i) => (
                  <div
                    key={g}
                    className={`${g} flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold`}
                    style={{
                      border: `2px solid #111009`,
                      marginLeft: i ? -8 : 0,
                      color: "#111009",
                    }}
                    aria-hidden
                  >
                    {["MR", "LV", "CD", "TK"][i]}
                  </div>
                ),
              )}
            </div>
            <div
              className="text-[12.5px] leading-[1.4]"
              style={{ color: "rgb(242 237 230 / 0.6)" }}
            >
              <div
                className="mb-0.5 flex gap-0.5"
                style={{ color: "rgb(var(--brand-primary))" }}
              >
                ★★★★★
              </div>
              <span>
                <strong className="font-bold text-white">340+</strong>{" "}
                {isHe ? "מפיקים כבר ברשימה" : "producers booked early access"}
              </span>
            </div>
          </div>
        </div>

        {/* Right — demo iframe inside browser chrome */}
        <HeroDemoPeek />
      </div>
    </section>
  );
}

// Browser-chrome wrapper around the founder's standalone demo HTML.
// Same .hero-peek-frame tilt + shadow as the homepage's HeroProductPeek;
// content is the iframe instead of a hand-rolled mock.
//
// "Crop the background" — the demo HTML's outer page background bleeds
// into the iframe. We zoom the iframe contents slightly + clip with
// overflow:hidden so the visible region is the actual UI; the demo's
// page padding is hidden behind the chrome frame.
function HeroDemoPeek() {
  return (
    <div className="sk-reveal-right sk-d-1 sk-float-slow relative">
      <div
        className="hero-peek-frame relative overflow-hidden rounded-2xl"
        style={{
          background: "#fff",
          boxShadow:
            "0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px rgba(212,150,10,0.15)",
        }}
      >
        {/* Browser chrome — matches the homepage HeroProductPeek */}
        <div
          className="flex h-8 items-center gap-2 px-3"
          style={{ background: "#f2ede6", borderBottom: "1px solid #e3dac6" }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ff5f57" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#febc2e" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#28c840" }} />
          <div className="flex flex-1 justify-center">
            <div
              className="font-mono rounded-md border bg-white px-2.5 py-1 text-[10px]"
              style={{ borderColor: "#e3dac6", color: "#6b6359" }}
            >
              app.skitza.com / overview
            </div>
          </div>
        </div>

        {/* Demo body — native <video> playing the founder's recording.
            No controls, autoplay/muted/loop, fills the body. */}
        <div className="get-started-demo-body">
          <DemoVideo title="Skitza app demo: producer creates session, artist books, payment confirmed" />
        </div>
      </div>
    </div>
  );
}
