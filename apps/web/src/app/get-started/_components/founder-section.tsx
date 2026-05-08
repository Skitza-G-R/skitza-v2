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
              אני גילי. בניתי את סקיצה אחרי שצפיתי בחברים מפיקים מבזבזים יותר
              זמן בוואטסאפ מאשר בסטודיו.
            </p>
            <p className="founder__paragraph">
              הזמנות באפליקציה אחת. דרייב באחרת. חוזים בשלישית. תשלומים
              ברביעית. אף אחד מהם לא דיבר עם השני, ואף אחד לא נבנה למוזיקה.
            </p>
            <p className="founder__paragraph">
              סקיצה היא הכלי שתמיד רציתי שיהיה להם — לינק אחד שמטפל בכל
              הסטאק, כדי שתוכל לחזור לעשות מוזיקה.
            </p>
          </>
        ) : (
          <>
            <p className="founder__paragraph">
              I&apos;m Gili, and I built Skitza after watching my producer
              friends spend more time on WhatsApp than in the studio.
            </p>
            <p className="founder__paragraph">
              Bookings in one app. Drive in another. Contracts in a third.
              Payments in a fourth. None of them talked to each other. None
              of them were built for music.
            </p>
            <p className="founder__paragraph">
              Skitza is what I wish they had — one link that handles the
              whole stack so you can get back to making music.
            </p>
          </>
        )}
        <p className="founder__signoff">
          {isHe ? "— גילי אסרף, מייסד" : "— Gili Asraf, founder"}
        </p>
      </div>
    </div>
  );
}
