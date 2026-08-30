/* v3 capture: current-component screens only, one coherent story world,
   and measured element rects so the film crops to complete regions. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const CLEAN = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;
transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}
nextjs-portal,[data-nextjs-dev-tools-button],[data-nextjs-toast]{display:none!important}`;

/* One story world across every screen. Fixtures are fake data; this makes
   them tell a single coherent story instead of five unrelated ones. */
const REWRITES = [
  ['GILI[\\s\\u00A0]+STUDIO', 'NORTHLINE STUDIO'],
  ['Gili[\\s\\u00A0]+Studio', 'Northline Studio'],
  ['Gili[\\s\\u00A0]+studio', 'Northline Studio'],
  ['Lior[\\s\\u00A0]+Tansky', 'Maya Cohen'],
  ['lior@example\\.com', 'maya@example.com'],
  ['Noya[\\s\\u00A0]+Halevi', 'Maya Cohen'],
  ['Single[\\s\\u00A0]*[\\u2014\\u2013-][\\s\\u00A0]*start[\\s\\u00A0]+to[\\s\\u00A0]+finish', 'Premium single production'],
  ['development-ga[a-z]*', 'SK-7F3QK2'],
  ['Totalit', 'Midnight Drive'],
  ['Gili[\\s\\u00A0]+Asraf', 'Maya Cohen'],
  ['האיש שהיה', 'Full production'],
];

const RECEIPT = 'data:image/svg+xml;base64,' + Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="440" viewBox="0 0 760 440">
  <rect width="760" height="440" fill="#F7F3EB"/>
  <rect x="30" y="26" width="700" height="388" rx="20" fill="#fff" stroke="#E8E1D4" stroke-width="2"/>
  <circle cx="380" cy="104" r="34" fill="#22C55E"/>
  <path d="M366 104 l10 10 l19 -20" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="380" y="172" font-family="Outfit,sans-serif" font-size="27" font-weight="600" fill="#111009" text-anchor="middle">Transfer completed</text>
  <text x="380" y="222" font-family="Syne,sans-serif" font-size="46" font-weight="800" fill="#111009" text-anchor="middle">&#8362;1,200.00</text>
  <line x1="70" y1="258" x2="690" y2="258" stroke="#E8E1D4" stroke-width="2"/>
  <text x="70" y="296" font-family="Outfit,sans-serif" font-size="19" fill="#6B6359">To</text>
  <text x="690" y="296" font-family="Outfit,sans-serif" font-size="19" font-weight="600" fill="#111009" text-anchor="end">Northline Studio</text>
  <text x="70" y="336" font-family="Outfit,sans-serif" font-size="19" fill="#6B6359">Date</text>
  <text x="690" y="336" font-family="Outfit,sans-serif" font-size="19" font-weight="600" fill="#111009" text-anchor="end">11 Jul 2026, 16:30</text>
  <text x="70" y="376" font-family="Outfit,sans-serif" font-size="19" fill="#6B6359">Reference</text>
  <text x="690" y="376" font-family="monospace" font-size="19" font-weight="600" fill="#111009" text-anchor="end">TRF-7F3QK2-01</text>
</svg>`).toString('base64');

/* shot spec: anchors define the crop rect (padded union of their block
   ancestors); click names the control whose center the cursor targets. */
const SHOTS = {
  desktop: [
    { key:'artist-store',  anchors:['Northline Studio','Premium single production','View service'], click:'View service', pad:26 },
    { key:'clients-projects', anchors:['Projects','Maya Cohen'], pad:30 },
    { key:'sk217-guest', path:'/dev/sk217-guest', anchors:['Midnight Drive','V2'], pad:30, padBottom:392 },
    { key:'gate2-review',  anchors:['Maya Cohen','Reject proof'], click:'Confirm ₪', pad:28, padBottom:240 },
    { key:'s9-partial',    anchors:['Remaining','Payment history'], pad:28 },
    { key:'s9-paid',       anchors:['Remaining','Payment history'], pad:28 },
  ],
  mobile: [
    { key:'s4', click:'Accept exact agreement' },
    { key:'artist-store', click:'View service' },
  ],
};

const browser = await chromium.launch({ executablePath: CHROME,
  args:['--no-sandbox','--force-color-profile=srgb','--font-render-hinting=none','--hide-scrollbars'] });

const meta = {};
for (const [form, shots] of Object.entries(SHOTS)){
  const desktop = form === 'desktop';
  const out = path.join(DIR, `v3-${form}`); mkdirSync(out, { recursive:true });
  const page = await browser.newPage({
    viewport: desktop ? {width:1512,height:945} : {width:390,height:844},
    deviceScaleFactor: desktop ? 2 : 3, isMobile: !desktop, hasTouch: !desktop });

  for (const shot of shots){
    let r = null;
    const url = `http://localhost:3000${shot.path || `/dev/screens/${shot.key}`}`;
    for (let attempt = 1; attempt <= 3; attempt++){
      try { r = await page.goto(url, { waitUntil:'networkidle', timeout:240000 }); break; }
      catch (e){ console.log(`  ~ ${form}/${shot.key} attempt ${attempt}: ${String(e.message).split('\n')[0].slice(0,70)}`);
                 await page.waitForTimeout(2500); }
    }
    if (!r || r.status() !== 200){ console.log(`  x ${form}/${shot.key}: HTTP ${r?r.status():'?'}`); continue; }
    await page.addStyleTag({ content: CLEAN });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1900);   // let React hydration finish, or it re-renders over the patch

    let info;
    for (let round = 1; round <= 4; round++){
      info = await page.evaluate(({ rewrites, receipt, anchors, click, pad, padBottom }) => {
      // 1. dev chrome off
      for (const el of [...document.body.children]){
        if (['MAIN','SECTION','SCRIPT','STYLE','AUDIO'].includes(el.tagName)) continue;
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        if (el.tagName === 'NEXTJS-PORTAL' || (cs.position === 'fixed' && b.width < 140 && b.height < 140)) el.remove();
      }
      // 2. one story world
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n, patched = 0;
      while ((n = walker.nextNode())){
        let t = n.nodeValue; if (!t) continue;
        for (const [a,b] of rewrites){ t = t.replace(new RegExp(a, 'g'), b); }
        if (t !== n.nodeValue){ n.nodeValue = t; patched++; }
      }
      // second pass: leaf elements whose text is split across inline nodes
      for (const el of document.body.querySelectorAll('*')){
        if (el.children.length) continue;
        const t0 = el.textContent; if (!t0) continue;
        let t = t0;
        for (const [a,b] of rewrites){ t = t.replace(new RegExp(a, 'g'), b); }
        if (t !== t0){ el.textContent = t; patched++; }
      }

      // 3. images that can't load (R2) -> stand-in receipt
      let swapped = 0;
      for (const img of document.images){
        if (!img.complete || img.naturalWidth === 0){
          img.src = receipt; img.srcset = '';
          img.style.width='100%'; img.style.height='auto';
          img.style.borderRadius='12px'; img.style.display='block'; swapped++;
        }
      }
      // 4. measured rect: padded union of each anchor's block ancestor
      const findByText = (needle) => {
        const it = document.evaluate(
          `//*[self::h1 or self::h2 or self::h3 or self::p or self::span or self::div or self::button or self::a or self::td or self::th]
             [contains(normalize-space(.), ${JSON.stringify(needle)})]`,
          document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        let best = null;
        for (let i = 0; i < it.snapshotLength; i++){
          const el = it.snapshotItem(i), b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (!best || b.width*b.height < best.rect.width*best.rect.height) best = { el, rect:b };
        }
        return best?.el ?? null;
      };
      const blockOf = (el) => {
        let cur = el;
        while (cur && cur !== document.body){
          const b = cur.getBoundingClientRect();
          if (b.width >= Math.min(640, innerWidth*0.55) && b.height >= 120) return cur;
          cur = cur.parentElement;
        }
        return el;
      };
      let rect = null;
      for (const a of (anchors || [])){
        const el = findByText(a); if (!el) continue;
        const b = blockOf(el).getBoundingClientRect();
        const box = { x:b.x + scrollX, y:b.y + scrollY, r:b.x + scrollX + b.width, b:b.y + scrollY + b.height };
        rect = rect ? { x:Math.min(rect.x,box.x), y:Math.min(rect.y,box.y),
                        r:Math.max(rect.r,box.r), b:Math.max(rect.b,box.b) } : box;
      }
      const page_ = { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight };
      let rectOut = null;
      if (rect){
        rectOut = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad),
                    w: Math.min(page_.w, rect.r + pad) - Math.max(0, rect.x - pad),
                    h: Math.min(page_.h, rect.b + pad + padBottom) - Math.max(0, rect.y - pad) };
      }
      // 5. click target center (page coords)
      let clickOut = null;
      if (click){
        const els = [...document.querySelectorAll('button,a,[role="button"]')];
        const el = els.find(e => (e.textContent||'').trim().includes(click));
        if (el){ const b = el.getBoundingClientRect();
          clickOut = { x: b.x + scrollX + b.width/2, y: b.y + scrollY + b.height/2,
                       w: b.width, h: b.height, text:(el.textContent||'').trim().slice(0,40) }; }
      }
      return { patched, swapped, rect: rectOut, click: clickOut, page: page_,
               broken: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length };
    }, { rewrites: REWRITES, receipt: RECEIPT, anchors: shot.anchors, click: shot.click, pad: shot.pad ?? 24, padBottom: shot.padBottom ?? 0 });
      await page.waitForTimeout(600);
      const reverted = await page.evaluate((rw) => rw.reduce((k,[a]) =>
        k + ((document.body.innerText.match(new RegExp(a,'g')) || []).length), 0), REWRITES);
      if (reverted === 0) break;
      if (round === 4) console.log(`  ! ${form}/${shot.key}: fixture text kept reverting`);
    }

    await page.waitForTimeout(300);
    const file = path.join(out, `${shot.key}.png`);
    await page.screenshot({ path: file, fullPage: desktop });   // full page on desktop: rects never fall off the fold
    meta[`${form}/${shot.key}`] = info;
    console.log(`  ok ${form}/${shot.key}  patched=${info.patched} swapped=${info.swapped} broken=${info.broken}` +
      (info.rect ? ` rect=${Math.round(info.rect.w)}x${Math.round(info.rect.h)}@${Math.round(info.rect.x)},${Math.round(info.rect.y)}` : '') +
      (info.click ? ` click="${info.click.text}"@${Math.round(info.click.x)},${Math.round(info.click.y)}` : ''));
  }
  await page.close();
}
await browser.close();
writeFileSync(path.join(DIR, 'v3-rects.json'), JSON.stringify(meta, null, 2));
console.log('meta -> v3-rects.json');
