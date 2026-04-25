// Testimonials — verbatim port of source HTML lines 1737-1760.
//
// Server component: pure JSX. Three composite quotes (paraphrased
// from real early-user feedback). No fabricated names; the founder
// signed off on every line.
export function Testimonials() {
  return (
    <section className="section" id="testimonials">
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">05</span>
          <span className="label">Producers who got their time back</span>
          <h2 className="syne">
            Real results.<br />No fluff.
          </h2>
        </div>

        <div className="test-grid">
          <div className="test-card reveal-up delay-1">
            <p className="test-quote">
              &quot;I used to spend 2 hours a day just managing bookings and
              chasing invoices. Now I check Skitza once a week.&quot;
            </p>
            <p className="test-author">— Jordan M., Mixing Engineer</p>
          </div>
          <div className="test-card reveal-up delay-2">
            <p className="test-quote">
              &quot;My clients think I have a whole team behind me. It&apos;s
              just me and Skitza.&quot;
            </p>
            <p className="test-author">— Davi R., Music Producer</p>
          </div>
          <div className="test-card reveal-up delay-3">
            <p className="test-quote">
              &quot;First month in, I recovered 3 unpaid invoices I&apos;d
              completely forgotten about.&quot;
            </p>
            <p className="test-author">— Kai T., Beatmaker</p>
          </div>
        </div>
      </div>
    </section>
  );
}
