import { StackReveal } from "./stack-reveal";

// Pain cascade — recognition → relief beat (homepage.md §1 thesis).
// Dark theme. Big amber H2, tired-but-not-bitter body, then the
// stack-reveal animation as visual proof of "one app for everything."

export function PainCascadeSection({ locale }: { locale: "en" | "he" }) {
  const isHe = locale === "he";

  return (
    <div className="container">
      <div className="cascade">
        <span className="eyebrow">
          {isHe ? "הזמן שלך" : "Your Tuesday"}
        </span>
        {isHe ? (
          <>
            <h2 className="h2" style={{ marginTop: 14 }}>
              כמה זמן הולך לך על
              <span className="accent-dot">…</span>
            </h2>
            <p className="body-lg">
              לקבוע סשנים. לחפש גרסאות בוואטסאפ. לרדוף אחרי תשלומים. לעקוב מי
              לקוח פעיל ומה דחוף — ואז לתעד את הכל מחדש, בכל פעם.
            </p>
            <p className="cascade__hook">למי יש זמן לזה?</p>
            <p className="body-lg">
              פעם היה צריך לזה מזכירה. היום, יש סקיצה.
            </p>
            <p className="cascade__close">
              אפליקציה אחת שסוגרת לך את כל הפינות. לעד.
            </p>
          </>
        ) : (
          <>
            <h2 className="h2" style={{ marginTop: 14 }}>
              How much time goes
              <br />
              to waste on
              <span className="accent-dot">…</span>
            </h2>
            <p className="body-lg">
              Booking sessions. Searching WhatsApp for the right version.
              Chasing payments. Tracking what&apos;s due Friday and re-typing
              the same to-do list — every. single. time.
            </p>
            <p className="cascade__hook">Who&apos;s got time for this?</p>
            <p className="body-lg">
              You used to need a part-time assistant just to keep up.
              <br />
              Now you have Skitza.
            </p>
            <p className="cascade__close">
              One app. For everything. Forever.
            </p>
          </>
        )}
        <StackReveal />
      </div>
    </div>
  );
}
