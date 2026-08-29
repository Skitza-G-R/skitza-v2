import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);

// screen -> the on-screen control the cursor should land on
const WANT = {
  'artist-store':      ['View service'],
  's4':                ['Accept exact agreement', 'Accept exact'],
  'gate2-review':      ['Confirm'],
  'sk94-artist-ready': ['Approve this version'],
};

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--hide-scrollbars'] });
const out = {};
for (const [screen, texts] of Object.entries(WANT)){
  const p = await b.newPage({ viewport:{width:1512,height:945}, deviceScaleFactor:1 });
  await p.goto(`http://localhost:3000/dev/screens/${screen}`, { waitUntil:'networkidle', timeout:180000 });
  await p.evaluate(()=>document.fonts.ready);
  await p.waitForTimeout(400);
  const hit = await p.evaluate((texts) => {
    const els = [...document.querySelectorAll('button,a,[role="button"]')];
    for (const want of texts){
      const el = els.find(e => (e.textContent||'').trim().toLowerCase().includes(want.toLowerCase()));
      if (el){
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          return { text:(el.textContent||'').trim().slice(0,40),
                   nx:(r.x + r.width/2)/innerWidth, ny:(r.y + r.height/2)/innerHeight,
                   nw:r.width/innerWidth, nh:r.height/innerHeight };
      }
    }
    return null;
  }, texts);
  out[screen] = hit;
  console.log(hit ? `  ok ${screen}: "${hit.text}" at ${(hit.nx*100).toFixed(1)}%, ${(hit.ny*100).toFixed(1)}%`
                  : `  x  ${screen}: no target found`);
  await p.close();
}
await b.close();
writeFileSync(path.join(DIR,'targets.json'), JSON.stringify(out,null,2));
