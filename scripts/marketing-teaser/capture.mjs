import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const arg=(k,d)=>{const a=process.argv.find(s=>s.startsWith(`--${k}=`));return a?a.split('=')[1]:d;};

const FORM = arg('form','desktop');
const VW  = FORM==='desktop' ? 1512 : 390;
const VH  = FORM==='desktop' ? 945  : 844;
const DSF = FORM==='desktop' ? 2    : 3;
const screens = arg('screens','').split(',').filter(Boolean);
const out = path.join(DIR, `caps-${FORM}`); mkdirSync(out,{recursive:true});

/* A generic transfer-confirmation graphic stands in for the proof upload,
   whose real image lives in R2 and can't load without credentials.
   Deliberately unbranded — no bank or payment-app identity.            */
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

const CLEAN = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;
  transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}
nextjs-portal,[data-nextjs-dev-tools-button],[data-nextjs-toast],#__next-build-watcher{display:none!important}`;

const browser = await chromium.launch({ executablePath: CHROME,
  args:['--no-sandbox','--force-color-profile=srgb','--font-render-hinting=none','--hide-scrollbars'] });
const page = await browser.newPage({ viewport:{width:VW,height:VH}, deviceScaleFactor:DSF,
  isMobile: FORM==='mobile', hasTouch: FORM==='mobile' });

for (const s of screens){
  try{
    const r = await page.goto(`http://localhost:3000/dev/screens/${s}`, { waitUntil:'networkidle', timeout:180000 });
    if (!r || r.status()!==200){ console.log(`  x ${s}: HTTP ${r?r.status():'?'}`); continue; }
    await page.addStyleTag({ content: CLEAN });
    await page.evaluate(() => document.fonts.ready);

    const fixed = await page.evaluate((receipt) => {
      // drop dev-only floating chrome that isn't part of the product
      let removed = 0;
      for (const el of [...document.body.children]){
        if (['MAIN','SECTION','SCRIPT','STYLE','AUDIO'].includes(el.tagName)) continue;
        if (el.tagName === 'NEXTJS-PORTAL'){ el.remove(); removed++; continue; }
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        if (cs.position === 'fixed' && b.width < 140 && b.height < 140){ el.remove(); removed++; }
      }
      // swap any image that failed to load for the stand-in receipt
      let swapped = 0;
      for (const img of document.images){
        if (!img.complete || img.naturalWidth === 0){
          img.src = receipt; img.srcset = '';
          img.style.width='100%'; img.style.height='auto';
          img.style.borderRadius='12px'; img.style.display='block';
          swapped++;
        }
      }
      return { removed, swapped };
    }, RECEIPT);

    await page.waitForTimeout(700);
    const left = await page.evaluate(() => [...document.images].filter(i=>!i.complete||i.naturalWidth===0).length);
    await page.screenshot({ path: path.join(out, `${s}.png`) });
    console.log(`  ok ${s}  (chrome-removed ${fixed.removed}, imgs-swapped ${fixed.swapped}, still-broken ${left})`);
  }catch(e){ console.log(`  x ${s}: ${String(e.message).split('\n')[0].slice(0,90)}`); }
}
await browser.close();
