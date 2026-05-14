// Demo section. Embeds the founder's standalone HTML demo
// (apps/web/public/landing/demo.html) inside an iframe.
// next.config.ts lifts X-Frame-Options to SAMEORIGIN for /landing/*
// so the iframe loads.

export function DemoVideoSection({ locale }: { locale?: "en" | "he" } = {}) {
  const isHe = locale === "he";
  return (
    <div className="container">
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <span className="eyebrow">
          {isHe ? "הצצה למוצר" : "A 15-second look"}
        </span>
        <h2 className="h2" style={{ marginTop: 14 }}>
          {isHe
            ? "ככה זה נראה."
            : (
              <>
                See it in action
                <span className="accent-dot">.</span>
              </>
            )}
        </h2>
      </div>
      <div className="demo-frame">
        <iframe
          src="/landing/demo.html"
          title="Skitza app demo: producer creates session, artist books, payment confirmed"
          loading="lazy"
          className="demo-frame__iframe"
          allow="autoplay"
        />
      </div>
    </div>
  );
}
