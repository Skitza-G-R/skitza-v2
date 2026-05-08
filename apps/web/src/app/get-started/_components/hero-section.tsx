import { Fragment } from "react";

import { WaitlistForm } from "./waitlist-form";

// Hero section. Marketing-class styling (.hero / .h1 / .body-lg /
// .eyebrow) lives in get-started.css.
//
// Headline word-fade — each word renders as <span class="hero-word">
// with a per-word --w-i index, fired by .get-started-root.is-loaded
// (set by IsLoadedPing 100ms after mount). Spaces are explicit text
// nodes BETWEEN the spans, not inside them — inline-block elements
// trim trailing whitespace inside, so a space inside the span gets
// collapsed.
//
// Period accent — sentence-final periods are rendered as a separate
// <span class="accent-dot"> for amber color. If a "word" string ends
// in `.`, we split the period off and render it amber.

interface HeroWord {
  text: string;
  /** True if this word should have an amber period dot after it. */
  amberDot?: boolean;
  /** True if a hard line break should follow this word. */
  lineBreakAfter?: boolean;
}

const EN_HEADLINE: HeroWord[] = [
  { text: "You’re" },
  { text: "a" },
  { text: "producer", amberDot: true, lineBreakAfter: true },
  { text: "Not" },
  { text: "an" },
  { text: "assistant", amberDot: true },
];

const HE_HEADLINE: HeroWord[] = [
  { text: "אתה" },
  { text: "מפיק", amberDot: true, lineBreakAfter: true },
  { text: "לא" },
  { text: "מזכירה", amberDot: true },
];

export function HeroSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  const thanksHref = isHe ? "/get-started/he/thanks" : "/get-started/thanks";
  const headline = isHe ? HE_HEADLINE : EN_HEADLINE;

  return (
    <div className="container">
      <div className="hero">
        <div>
          <span className="eyebrow">
            {isHe ? "כלי אחד למפיקים" : "Built for solo producers"}
          </span>
          <h1 className="h1" style={{ marginTop: 14 }}>
            {headline.map((word, i) => (
              <Fragment key={`${word.text}-${String(i)}`}>
                <span
                  className="hero-word"
                  style={{ ["--w-i" as string]: i }}
                >
                  {word.text}
                  {word.amberDot ? (
                    <span className="accent-dot">.</span>
                  ) : null}
                </span>
                {word.lineBreakAfter ? (
                  <br />
                ) : i < headline.length - 1 ? (
                  " "
                ) : null}
              </Fragment>
            ))}
          </h1>
          <p className="body-lg" style={{ maxWidth: 560 }}>
            {isHe
              ? "תיאום סשן לא אמור להיות ארוך יותר מהסשן עצמו. סקיצה מאחדת WhatsApp, Drive, Notion, DocuSign ו-Stripe — לקישור אחד."
              : "Booking a session shouldn’t take longer than the session. Skitza replaces WhatsApp, Drive, Notion, DocuSign, and Stripe — with one link your clients remember."}
          </p>
          <div style={{ marginTop: 32 }}>
            <WaitlistForm locale={locale} thanksHref={thanksHref} />
            <p className="gs-form-meta">
              {isHe
                ? "בלי ספאם. נשלח לך מייל ברגע שהמקום שלך מתפנה."
                : "No spam. We’ll email you the moment your spot opens."}
            </p>
          </div>
        </div>
        <SplitScreen locale={locale} />
      </div>
    </div>
  );
}

// Chaos↔calm visual proof. Pure decoration (aria-hidden); the
// hero copy + form are the announced surface.
function SplitScreen({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  return (
    <div className="hero-split" aria-hidden>
      <div className="hero-split__chaos">
        <div className="hero-split__msg hero-split__msg--1">
          {isHe ? "פנוי שלישי 19:00?" : "u up to record Tuesday?"}
        </div>
        <div className="hero-split__msg hero-split__msg--2">
          {isHe ? "איפה הקישור לתשלום?" : "where’s the Stripe link?"}
        </div>
        <div className="hero-split__msg hero-split__msg--3">
          FINAL_v7.wav
        </div>
        <div className="hero-split__msg hero-split__msg--4">
          {isHe ? "לא שולם" : "Unpaid · 12 days"}
        </div>
      </div>
      <div className="hero-split__calm">
        <div className="hero-split__card">
          <span className="hero-split__card-eyebrow">
            {isHe ? "אישור הזמנה" : "New booking"}
          </span>
          <span className="hero-split__card-title">
            {isHe ? "סשן · 14.8, 14:00" : "Session — Aug 14, 2:00 PM"}
          </span>
          <span className="hero-split__card-meta">
            <span>Marcus T.</span>
            <span>·</span>
            <span>$240 paid</span>
          </span>
          <span className="hero-split__card-status">
            {isHe ? "✓ מאושר ושולם" : "✓ Confirmed & paid"}
          </span>
        </div>
      </div>
    </div>
  );
}
