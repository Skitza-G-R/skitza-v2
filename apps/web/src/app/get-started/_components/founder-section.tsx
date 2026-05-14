import { FounderPhoto } from "./founder-photo";

// Founder section — last-mile trust before the final CTA. Editorial
// single-column layout on dark, matching the homepage's founder
// section voice (homepage.md §5.14).

export function FounderSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";

  return (
    <div className="container">
      <div className="founder">
        <div style={{ marginBottom: 12 }}>
          <span className="eyebrow">
            {isHe ? "מאחורי סקיצה" : "From the founder"}
          </span>
        </div>
        <FounderPhoto
          alt={isHe ? "גילי אסרף, מייסד סקיצה" : "Gili Asraf, Skitza founder"}
        />
        {isHe ? (
          <>
            <p className="founder__paragraph">
              אני גילי. אני מפיק — כזה שבילה יותר זמן בחיפוש בוואטסאפ מאשר
              במיקס בסטודיו.
            </p>
            <p className="founder__paragraph">
              הזמנות באפליקציה אחת. דרייב בשנייה. חוזים בשלישית. תשלומים
              ברביעית, אם הם בכלל הגיעו. אף אחד לא דיבר עם השני. אף אחד לא
              נבנה למוזיקה. אני הייתי האינטגרציה — והמחיר היה היצירה.
            </p>
            <p className="founder__paragraph">
              אז בניתי את הכלי שרציתי. לינק אחד שהאמנים שלך כבר מבינים:
              מזמינים, חותמים, משלמים, שומעים, חוזרים. הדבר היחיד שנשאר
              להיות טוב בו הוא המוזיקה.
            </p>
          </>
        ) : (
          <>
            <p className="founder__paragraph">
              I&apos;m Gili. I&apos;m a producer — the kind who spent more
              time digging through WhatsApp than mixing in the studio.
            </p>
            <p className="founder__paragraph">
              Bookings in one app. Files in another. Contracts in a third.
              Payments in a fourth, if they ever cleared. None of them
              talked to each other. None of them were built for music. I
              was the integration — and the cost was the work.
            </p>
            <p className="founder__paragraph">
              So I built the tool I wanted. One link your artists already
              understand: book, sign, pay, hear, come back. The only thing
              left to be good at is the music.
            </p>
          </>
        )}
        <p className="founder__signoff">
          {isHe
            ? "— גילי אסרף, מפיק ומייסד"
            : "— Gili Asraf, producer & founder"}
        </p>
      </div>
    </div>
  );
}
