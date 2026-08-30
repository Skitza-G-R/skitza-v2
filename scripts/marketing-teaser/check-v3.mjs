import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const TL = JSON.parse(readFileSync(path.join(DIR,'timeline-v3.json'),'utf8'));
let RECTS = {}; try { RECTS = JSON.parse(readFileSync(path.join(DIR,'v3-rects.json'),'utf8')); } catch {}
const MODE = process.argv.includes('--tall') ? 'tall' : 'wide';
const W = MODE==='wide'?1920:1080, H = MODE==='wide'?1080:1920;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--force-color-profile=srgb','--font-render-hinting=none','--hide-scrollbars'] });
const p = await b.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:1 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.join(DIR,'teaser-v3.html'),{waitUntil:'load'});
await p.evaluate(()=>document.fonts.ready);
await p.evaluate(({tl,mode,rects})=>{window.__TIMELINE=tl;window.__RECTS=rects;window.__build(mode);},{tl:TL,mode:MODE,rects:RECTS});
await p.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
const times = process.argv.filter(a=>/^[0-9.]+$/.test(a)).map(Number);
for (const t of times){
  await p.evaluate(tt=>window.__render(tt), t);
  await p.screenshot({ path: path.join(DIR, `chk-${MODE}-${t.toFixed(2)}.png`) });
}
if (errs.length) console.error('PAGE ERRORS:', errs.slice(0,4).join(' | '));
console.log('rendered', times.length, 'check frames', MODE);
await b.close();
