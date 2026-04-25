// SiteFooter — verbatim port of source HTML lines 1810-1846.
//
// Server component: pure JSX. Footer columns + nav + bottom row. All
// links go to in-page anchors (#features, #pricing) or are placeholders
// (Blog, Contact, Socials, Legal) that resolve to "#" until those pages
// ship — same behaviour as the source HTML.
export function SiteFooter() {
  return (
    <footer>
      <div className="container">
        <div className="footer-grid">
          <div>
            <a href="#" className="footer-logo">
              Skitza
            </a>
            <p className="footer-tag">Your studio runs itself.</p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <ul>
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#pricing">Pricing</a>
              </li>
              <li>
                <a href="#">Blog</a>
              </li>
              <li>
                <a href="#">Contact</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Socials</h4>
            <ul>
              <li>
                <a href="#">Instagram</a>
              </li>
              <li>
                <a href="#">Twitter/X</a>
              </li>
              <li>
                <a href="#">YouTube</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Legal</h4>
            <ul>
              <li>
                <a href="#">Privacy Policy</a>
              </li>
              <li>
                <a href="#">Terms of Service</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          © 2026 Skitza. Built for producers, by producers.
        </div>
      </div>
    </footer>
  );
}
