import { WaitlistForm } from "./waitlist-form";

// Final CTA — last click. Centered card on dark with amber radial
// glow, identical waitlist target as the hero. Repetition is
// conviction (homepage.md §13 #1).

export function CtaSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";
  const thanksHref = isHe ? "/get-started/he/thanks" : "/get-started/thanks";

  return (
    <div className="container">
      <div className="final-cta">
        <span className="eyebrow">
          {isHe ? "מוכן?" : "Ready?"}
        </span>
        <h2 className="h2" style={{ marginTop: 14 }}>
          {isHe ? (
            <>
              הצטרף לרשימת ההמתנה
              <span className="accent-dot">.</span>
            </>
          ) : (
            <>
              Get on the waitlist
              <span className="accent-dot">.</span>
            </>
          )}
        </h2>
        <p className="body" style={{ marginBottom: 28 }}>
          {isHe
            ? "הביטא נפתחת בקרוב. המקומות מוגבלים — מפיק אחד בפעם אחת."
            : "Beta opens soon. Spots are limited — one producer at a time."}
        </p>
        <WaitlistForm locale={locale} thanksHref={thanksHref} />
        <p className="gs-form-meta">
          {isHe
            ? "ללא כרטיס אשראי. ללא ספאם."
            : "No credit card. No spam. Cancel anytime."}
        </p>
      </div>
    </div>
  );
}
