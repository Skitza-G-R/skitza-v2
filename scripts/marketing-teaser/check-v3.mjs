import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const TLF = (process.argv.find(a=>a.startsWith('--timeline='))||'--timeline=timeline-v3.json').split('=')[1];
const TL = JSON.parse(readFileSync(path.join(DIR,TLF),'utf8'));
let RECTS = {}; try { RECTS = JSON.parse(readFileSync(path.join(DIR,'v3-rects.json'),'utf8')); } catch {}
let SEQS = {}; try { const { readdirSync } = await import('node:fs');
  for (const d of readdirSync(path.join(DIR,'seq'), { withFileTypes:true })){ if(!d.isDirectory()) continue;
    try { SEQS[d.name] = JSON.parse(readFileSync(path.join(DIR,'seq',d.name,'seq.json'),'utf8')); } catch {} } } catch {}
const MODE = process.argv.includes('--tall') ? 'tall' : 'wide';
const W = MODE==='wide'?1920:1080, H = MODE==='wide'?1080:1920;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--force-color-profile=srgb','--font-render-hinting=none','--hide-scrollbars'] });
const p = await b.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:1 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const HTMLF = (process.argv.find(a=>a.startsWith('--html='))||'--html=teaser-v3.html').split('=')[1];
await p.goto('file://'+path.join(DIR,HTMLF),{waitUntil:'load'});
await p.evaluate(async () => {
  await Promise.all([
    document.fonts.load('800 64px Syne'), document.fonts.load('700 64px Syne'),
    document.fonts.load('500 32px Outfit'), document.fonts.load('600 32px Outfit'),
    document.fonts.load('500 30px JBMono'), document.fonts.load('700 30px JBMono'),
  ]);
  await document.fonts.ready;
});
await p.evaluate(({tl,mode,rects,seqs})=>{window.__TIMELINE=tl;window.__RECTS=rects;window.__SEQS=seqs;window.__build(mode);},{tl:TL,mode:MODE,rects:RECTS,seqs:SEQS});
await p.evaluate(async()=>{const jobs=[];for(const [name,m] of Object.entries(window.__SEQS||{})){for(const fr of m.frames){const im=new Image();im.src=`seq/${name}/${fr.f}`;jobs.push(im.decode().catch(()=>{}));}}await Promise.all(jobs);});
await p.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
const times = process.argv.filter(a=>/^[0-9.]+$/.test(a)).map(Number);
for (const t of times){
  await p.evaluate(tt=>window.__render(tt), t);
  await p.screenshot({ path: path.join(DIR, `chk-${MODE}-${t.toFixed(2)}.png`) });
}
if (errs.length) console.error('PAGE ERRORS:', errs.slice(0,4).join(' | '));
console.log('rendered', times.length, 'check frames', MODE);
await b.close();
