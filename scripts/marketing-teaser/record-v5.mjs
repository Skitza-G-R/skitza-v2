/* v5: record REAL interactions on the dev screens as timestamped frame
   sequences. Client-side interactions only; mutation buttons get genuine
   hover/press states but the pointer slides off before release, so no
   fake post-state is ever shown. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const RECTS = JSON.parse(readFileSync(path.join(DIR,'v3-rects.json'),'utf8'));

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
  ['Three-song[\\s\\u00A0]+production', 'Premium single production'],
];
const CHROME_OFF = `nextjs-portal,[data-nextjs-dev-tools-button],[data-nextjs-toast]{display:none!important}
*{caret-color:transparent!important;-webkit-user-select:none!important;user-select:none!important}`;   // NOTE: animations stay live — that is the point

async function prep(page){
  await page.addStyleTag({ content: CHROME_OFF });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1900);
  for (let round = 0; round < 4; round++){
    await page.evaluate((rw) => {
      for (const el of [...document.body.children]){
        if (['MAIN','SECTION','SCRIPT','STYLE','AUDIO'].includes(el.tagName)) continue;
        const cs = getComputedStyle(el), b = el.getBoundingClientRect();
        if (el.tagName === 'NEXTJS-PORTAL' || (cs.position === 'fixed' && b.width < 140 && b.height < 140)) el.remove();
      }
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())){ let t = n.nodeValue; if(!t) continue;
        for (const [a,b] of rw) t = t.replace(new RegExp(a,'g'), b);
        if (t !== n.nodeValue) n.nodeValue = t; }
      for (const el of document.body.querySelectorAll('*')){
        if (el.children.length) continue;
        const t0 = el.textContent; if (!t0) continue; let t = t0;
        for (const [a,b] of rw) t = t.replace(new RegExp(a,'g'), b);
        if (t !== t0) el.textContent = t; }
    }, REWRITES);
    await page.waitForTimeout(550);
    const left = await page.evaluate((rw) => rw.reduce((k,[a]) =>
      k + ((document.body.innerText.match(new RegExp(a,'g'))||[]).length), 0), REWRITES);
    if (left === 0) break;
  }
}

/* capture loop: run the action plan while screenshotting as fast as possible */
async function recordShot(browser, spec){
  const desktop = spec.form === 'desktop';
  const page = await browser.newPage({
    viewport: desktop ? {width:1512,height:945} : {width:390,height:844},
    deviceScaleFactor: desktop ? 1.5 : 2, isMobile: !desktop, hasTouch: !desktop });
  const cdp = await page.context().newCDPSession(page);
  page.touchScroll = (x, y, dy, speed=900) => cdp.send('Input.synthesizeScrollGesture',
    { x, y, yDistance: -dy, speed, gestureSourceType: 'touch' }).catch(e=>console.log('   scroll-gesture:', e.message.split('\n')[0]));
  // The app scrolls an inner container (main.sk-native-scroll), not the page.
  page.appScroll = (top) => page.evaluate((t) => {
    const el = document.querySelector('main.sk-native-scroll') ||
               [...document.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 40);
    if (el) el.scrollTo({ top: t, behavior: 'smooth' });
  }, top);
  await page.goto(`http://localhost:3000${spec.path}`, { waitUntil:'networkidle', timeout:240000 });
  await prep(page);
  if (spec.setup) await spec.setup(page);

  const out = path.join(DIR, 'seq', spec.name);
  mkdirSync(out, { recursive: true });
  const frames = [];
  const t0 = Date.now();
  let stepIdx = 0, done = false;
  const steps = spec.steps;                         // [{at, run(page)}...] at = seconds
  while (!done){
    const t = (Date.now() - t0) / 1000;
    while (stepIdx < steps.length && steps[stepIdx].at <= t){
      await steps[stepIdx].run(page); stepIdx++;
    }
    const f = `f${String(frames.length).padStart(4,'0')}.jpg`;
    await page.screenshot({ path: path.join(out,f), type:'jpeg', quality:88 });
    frames.push({ f, t: Number((((Date.now()-t0)/1000)+t)/2 - 0.02).valueOf() });
    if (t >= spec.dur && stepIdx >= steps.length) done = true;
    if (frames.length > 220) done = true;
  }
  const urlNow = page.url();
  await page.close();
  const manifest = { name: spec.name, form: spec.form, dur: spec.dur,
    page: desktop ? {w:1512,h:945} : {w:390,h:844},
    rect: spec.rect || null, frames };
  writeFileSync(path.join(out,'seq.json'), JSON.stringify(manifest));
  console.log(`  ok ${spec.name}: ${frames.length} frames over ${spec.dur}s  (url drift: ${urlNow.includes(spec.path.split('?')[0]) ? 'no' : 'YES -> '+urlNow})`);
}

const move = (x,y,steps=18) => ({ page:p }) => p; // placeholder (unused)
const M = (p,x,y,st=16) => p.mouse.move(x,y,{steps:st});

const gate = RECTS['desktop/gate2-review'], s4m = RECTS['mobile/s4'], s9m = RECTS['mobile/s9-partial'],
      storeD = RECTS['desktop/artist-store'], sk = RECTS['desktop/sk217-guest'];

const SHOTS = [
  { name:'store', form:'desktop', path:'/dev/screens/artist-store', dur:3.0,
    rect:{ x:0, y:0, w:1512, h:945 },
    steps: [
      { at:0.15, run: p => M(p, 300, 760, 6) },
      { at:0.30, run: p => M(p, storeD.click.x, storeD.click.y, 22) },
      { at:1.60, run: p => M(p, storeD.click.x + 10, storeD.click.y - 4, 8) },
      { at:2.30, run: p => M(p, storeD.click.x - 6, storeD.click.y + 3, 8) },
    ] },
  { name:'verify', form:'desktop', path:'/dev/screens/gate2-review', dur:3.6,
    rect: gate.rect,
    steps: [
      { at:0.15, run: p => M(p, gate.click.x - 330, gate.click.y + 190, 6) },
      { at:0.30, run: p => M(p, gate.click.x, gate.click.y, 24) },
      { at:1.70, run: p => p.mouse.down() },
      { at:2.35, run: p => M(p, gate.click.x + 240, gate.click.y + 160, 10) },  // slide off — no click fires
      { at:2.55, run: p => p.mouse.up() },
      { at:2.70, run: p => M(p, gate.click.x + 320, gate.click.y + 240, 8) },
    ] },
  { name:'locked', form:'desktop', path:'/dev/sk217-guest?role=producer', dur:4.2,
    rect: sk.rect,
    steps: (() => {                        // real drag-scrub across Waveform50
      const wy = sk.rect.y + sk.rect.h * 0.44;             // waveform band
      const x0 = sk.rect.x + sk.rect.w * 0.10;
      const x1 = sk.rect.x + sk.rect.w * 0.52;
      return [
        { at:0.15, run: p => M(p, x0, wy + 160, 6) },
        { at:0.35, run: p => M(p, x0, wy, 14) },
        { at:0.90, run: p => p.mouse.down() },
        { at:1.00, run: p => M(p, sk.rect.x + sk.rect.w*0.22, wy, 10) },
        { at:1.45, run: p => M(p, sk.rect.x + sk.rect.w*0.34, wy, 10) },
        { at:1.90, run: p => M(p, sk.rect.x + sk.rect.w*0.44, wy, 10) },
        { at:2.35, run: p => M(p, x1, wy, 10) },
        { at:2.55, run: p => p.mouse.up() },
        { at:3.10, run: p => M(p, sk.rect.x + sk.rect.w*0.82, sk.rect.y + sk.rect.h*0.35, 14) }, // toward notes rail
      ];
    })() },
  { name:'book', form:'mobile', path:'/dev/screens/artist-book', dur:3.0,
    steps: [
      { at:0.6, run: async p => {
          const day = p.locator('button, [role="button"]').filter({ hasText: 'Aug 17' }).first();
          if (await day.count()) await day.tap().catch(()=>day.click().catch(()=>{}));
        } },
      { at:1.9, run: p => p.touchScroll(195, 500, 200, 650) },
    ] },
  { name:'agree', form:'mobile', path:'/dev/screens/s4', dur:3.2,
    steps: [
      { at:0.35, run: p => p.appScroll(430) },
      { at:1.70, run: p => p.appScroll(900) },
    ] },
  { name:'pay', form:'mobile', path:'/dev/screens/s9-partial', dur:2.8,
    steps: [
      { at:0.35, run: p => p.touchScroll(195, 500, 170, 600) },
      { at:1.60, run: p => p.touchScroll(195, 500, -150, 600) },
    ] },
];

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const RUN = ONLY.length ? SHOTS.filter(s => ONLY.includes(s.name)) : SHOTS;
const browser = await chromium.launch({ executablePath: CHROME,
  args:['--no-sandbox','--force-color-profile=srgb','--font-render-hinting=none','--hide-scrollbars'] });
for (const s of RUN) await recordShot(browser, s);
await browser.close();
console.log('sequences done');
