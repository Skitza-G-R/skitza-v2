/* Skitza teaser v3 — hook / story / payoff / CTA on real product crops.
   Every product shot is a measured element-region crop from v3-rects.json,
   shown complete. Headlines carry the story (silent-autoplay-safe); UI is
   the evidence. All cuts sit on a 100 BPM grid so a music bed can lock in. */

function mk(parent, cls, css, text){
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (css) Object.assign(d.style, css);
  if (text != null) d.textContent = text;
  parent.appendChild(d); return d;
}
const PX = v => (typeof v === 'number' ? v.toFixed(2) + 'px' : v);
function rng(seed){ let s = seed >>> 0; return () => ((s = (s*1664525 + 1013904223) >>> 0) / 4294967296); }

const INK = 'rgb(17 16 9)', CREAM = 'rgb(242 237 230)', AMBER = 'rgb(212 150 10)';

/* ---------- shared: kinetic headline (word-by-word spring) ---------- */
function headline(root, C, { x, y, w, size, color = INK, align = 'left', lines }){
  const { E, clamp, lerp, P, px } = C;
  const wrap = mk(root, '', { position:'absolute', left:PX(x), top:PX(y), width:PX(w),
    textAlign:align, pointerEvents:'none' });
  const words = [];
  lines.forEach((line, li) => {
    const l = mk(wrap, 'disp', { fontSize:PX(size), lineHeight:'1.04', color,
      letterSpacing:'-.025em', display:'block' });
    line.split(' ').forEach(word => {
      const holder = mk(l, '', { display:'inline-block', overflow:'hidden',
        verticalAlign:'bottom', paddingRight:'.24em', marginRight:'-.02em' });
      const el = mk(holder, '', { display:'inline-block', willChange:'transform,opacity' }, word);
      words.push({ el, li });
    });
  });
  return {
    el: wrap,
    update(lt, at, opts = {}){
      const slam = opts.slam;
      words.forEach((wd, i) => {
        const d = at + i * (slam ? 0.03 : 0.055) + wd.li * 0.10;
        const u = P(lt, d, slam ? 0.30 : 0.62, slam ? C.E.outQ : C.E.spring);
        wd.el.style.opacity = clamp(u * 1.3);
        wd.el.style.transform = `translateY(${PX(lerp(slam ? 44 : 30, 0, u))})`;
      });
      if (slam){
        const k = P(lt, at, 0.34, C.E.outQ);
        wrap.style.transform = `scale(${lerp(1.10, 1, k)})`;
        wrap.style.transformOrigin = '50% 50%';
      }
    }
  };
}

/* ---------- shared: measured crop card ---------- */
/* Fits the rect (page coords from v3-rects.json) into a box, complete.
   dsf: capture deviceScaleFactor (2 desktop / 3 mobile). */
function cropCard(root, C, { file, rectKey, rectOverride, box, radius = 20, dsf = 2, frame = 'card' }){
  const meta = (window.__RECTS || {})[rectKey] || {};
  const rect = rectOverride || meta.rect;
  const page = meta.page || { w: 1512, h: 998 };
  if (!rect) return null;

  const fit = Math.min(box.w / rect.w, box.h / rect.h);
  const cw = rect.w * fit, ch = rect.h * fit;
  const cx = box.x + (box.w - cw) / 2, cy = box.y + (box.h - ch) / 2;

  const card = mk(root, '', { position:'absolute', left:PX(cx), top:PX(cy),
    width:PX(cw), height:PX(ch), borderRadius:PX(radius), overflow:'hidden',
    background:'rgb(255 255 255)',
    border:'1px solid rgb(var(--border-subtle))',
    boxShadow:'0 2px 5px rgb(120 100 70/.07), 0 44px 88px -30px rgb(70 55 30/.40)',
    willChange:'transform,opacity' });
  const mover = mk(card, '', { position:'absolute', inset:'0', willChange:'transform' });
  const img = document.createElement('img');
  img.src = file;
  Object.assign(img.style, { position:'absolute',
    left:PX(-rect.x * fit), top:PX(-rect.y * fit),
    width:PX(page.w * fit), height:'auto' });
  mover.appendChild(img);

  return {
    el: card, fit, cx, cy, cw, ch,
    toStage(p){ return { x: cx + (p.x - rect.x) * fit, y: cy + (p.y - rect.y) * fit }; },
    click: meta.click || null,
    enter(lt, at, C2){
      const u = C2.P(lt, at, .62, C2.E.spring);
      card.style.opacity = C2.clamp(u * 1.35);
      card.style.transform = `translateY(${PX(C2.lerp(56, 0, u))}) scale(${C2.lerp(.965, 1, u)})`;
      return u;
    },
    dolly(lt, dur, zoom = 1.06, ox = '50%', oy = '50%', C2 = C){
      mover.style.transformOrigin = `${ox} ${oy}`;
      mover.style.transform = `scale(${C2.lerp(1, zoom, C2.E.io(C2.clamp(lt / dur)))})`;
    }
  };
}

function phoneShell(root, C, { x, y, w }){
  const h = w * (844 / 390);
  const bezel = Math.max(7, w * 0.017);
  mk(root, '', { position:'absolute', left:PX(x + w/2 - w*1.45), top:PX(y + h/2 - w*1.45),
    width:PX(w*2.9), height:PX(w*2.9), borderRadius:'999px', pointerEvents:'none',
    background:'radial-gradient(circle, rgb(212 150 10/.15) 0%, rgb(212 150 10/.05) 44%, rgb(212 150 10/0) 70%)' });
  const dev = mk(root, '', { position:'absolute', left:PX(x), top:PX(y), width:PX(w), height:PX(h),
    borderRadius:PX(w * 0.115), overflow:'hidden', background:'#fff',
    border:`${PX(bezel)} solid #14130F`,
    boxShadow:'0 3px 6px rgb(60 46 22/.14), 0 46px 90px -28px rgb(60 46 22/.46)',
    willChange:'transform,opacity' });
  return { dev, w, h, innerW: w - bezel*2, innerH: h - bezel*2, x, y, bezel };
}

/* ============================== SCENES ============================== */
window.SCENE_BUILDERS = {

/* ---- 1 · HOOK: the producer's actual Tuesday ---- */
hook(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const wide = mode === 'wide';
  root.classList.add('dark');
  root.style.background = '#14130F';

  const colX = wide ? 560 : 90, colW = wide ? 800 : W - 180, baseY = wide ? 880 : 1500;
  const MSGS = [
    'did my transfer arrive??',
    'which mix is final... v3 or v4?',
    'can you resend the stems?',
    "i'll pay after the session, promise",
    'wait, are we tomorrow or friday??',
  ];
  const AT = [0.15, 0.62, 1.08, 1.52, 1.94];
  const fs = wide ? 34 : 40, padV = wide ? 20 : 24, padH = wide ? 28 : 32, gap = wide ? 18 : 22;
  const rowH = fs * 1.25 + padV * 2 + gap;

  const bubbles = MSGS.map((m, i) => {
    const b = mk(root, '', { position:'absolute', left:PX(colX), width:'max-content',
      maxWidth:PX(colW), padding:`${PX(padV)} ${PX(padH)}`,
      background:'rgb(48 46 40)', color:'rgb(238 234 226)',
      fontSize:PX(fs), fontWeight:'500', lineHeight:'1.25',
      borderRadius:'22px', borderBottomLeftRadius:'6px',
      boxShadow:'0 10px 30px rgb(0 0 0/.35)', willChange:'transform,opacity' }, m);
    return { el: b, at: AT[i], i };
  });

  // unread badge
  const badgeWrap = mk(root, '', { position:'absolute', right:PX(wide ? 170 : 90), top:PX(wide ? 120 : 170),
    display:'flex', alignItems:'center', gap:'16px' });
  mk(badgeWrap, '', { fontSize:PX(wide ? 26 : 30), color:'rgb(150 144 134)', fontWeight:'500' }, 'unread');
  const badge = mk(badgeWrap, '', { minWidth:PX(wide ? 58 : 66), height:PX(wide ? 58 : 66),
    borderRadius:'999px', background:'rgb(220 38 38)', color:'#fff', display:'grid',
    placeItems:'center', fontSize:PX(wide ? 27 : 31), fontWeight:'700',
    padding:'0 14px', willChange:'transform' }, '4');

  const head = headline(root, C, {
    x: wide ? 210 : 90, y: wide ? 180 : 420, w: W - (wide ? 420 : 180),
    size: wide ? 92 : 96, color:'rgb(242 237 230)', align: wide ? 'left' : 'left',
    lines: ['Your DMs are not', 'a studio.'] });

  return (lt) => {
    // stack: each new bubble lands at the bottom, older ones shove up
    let arrived = 0;
    bubbles.forEach(b => { if (lt >= b.at) arrived++; });
    bubbles.forEach((b, i) => {
      const u = P(lt, b.at, .5, E.spring);
      const slot = arrived - 1 - i;               // 0 = newest
      const targetY = baseY - slot * rowH;
      b.el.style.opacity = clamp(u * 1.4) * (lt > 2.3 ? .32 : 1);
      b.el.style.top = PX(targetY);
      b.el.style.transform = `translateY(${PX(lerp(70, 0, u))}) scale(${lerp(.92, 1, u)})`;
    });

    const count = [4, 9, 13, 17, 23][Math.min(4, bubbles.filter(b => lt >= b.at).length - 1) < 0 ? 0 : Math.min(4, arrived - 1)] || 4;
    badge.textContent = String(count);
    let pop = 0;
    bubbles.forEach(b => { pop = Math.max(pop, C.pulse(lt, b.at + .04, .3, .1, .2)); });
    badge.style.transform = `scale(${1 + pop * .35})`;
    badgeWrap.style.opacity = clamp(P(lt, .1, .4, E.out)) * (lt > 2.3 ? .4 : 1);

    // tension shake, frozen by the slam
    const amp = lt < 2.3 ? lerp(0, 2.6, clamp(lt / 2.2)) : 0;
    root.style.transform = `translate(${PX(Math.sin(lt*53)*amp)}, ${PX(Math.cos(lt*47)*amp*.7)})`;

    head.update(lt, 2.30, { slam:true });
  };
},

/* ---- 2 · TURN: one link ---- */
turn(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const wide = mode === 'wide';
  const head = headline(root, C, {
    x: wide ? 150 : 90, y: wide ? 88 : 190, w: W - 240,
    size: wide ? 70 : 84, lines: ['One link runs the whole studio.'].concat([]) });
  // URL pill
  const pill = mk(root, '', { position:'absolute',
    left:PX(wide ? 150 : 90), top:PX(wide ? 212 : 460),
    height:PX(wide ? 64 : 76), borderRadius:'999px', background:'rgb(255 255 255)',
    border:'1.5px solid rgb(var(--border-strong))', display:'flex', alignItems:'center',
    padding:'0 30px', boxShadow:'0 14px 34px -14px rgb(90 72 44/.35)' });
  mk(pill, 'dot', { width:'11px', height:'11px', background:AMBER, marginRight:'16px' });
  const url = mk(pill, 'mono', { fontSize:PX(wide ? 27 : 30), color:INK, fontWeight:'500' }, '');

  const card = cropCard(root, C, { file:'v3-desktop/artist-store.png', rectKey:'desktop/artist-store',
    box: wide ? { x:390, y:330, w:1180, h:692 } : { x:65, y:640, w:950, h:1080 }, radius:22 });

  return (lt) => {
    head.update(lt, 0.15);
    const typed = 'skitza.app/join/northline-studio';
    const n = Math.floor(clamp(P(lt, 0.32, 1.05, E.lin)) * typed.length);
    url.textContent = typed.slice(0, n) + (n < typed.length ? '|' : '');
    pill.style.opacity = P(lt, 0.26, .4, E.out);
    pill.style.borderColor = n >= typed.length ? 'rgb(212 150 10)' : 'rgb(var(--border-strong))';
    if (card){
      card.enter(lt, 1.45, C);
      card.dolly(lt - 1.45, 4.5, 1.075, '34%', '26%', C);
    }
  };
},

/* ---- 3 · BOOK: phone tap on the real agreement ---- */
book(root, C){
  const { W, H, mode, E, clamp, lerp, P, cursorPath, setCursor, ripple } = C;
  const wide = mode === 'wide';
  const head = headline(root, C, {
    x: wide ? 150 : 90, y: wide ? 300 : 170, w: wide ? 860 : W - 180,
    size: wide ? 78 : 82, lines: ['They book.', 'Terms locked.'] });
  mk(root, '', { position:'absolute', left:PX(wide ? 154 : 94), top:PX(wide ? 560 : 415),
    fontSize:PX(wide ? 30 : 34), color:'rgb(var(--fg-muted))', fontWeight:'500' },
    '₪2,400 agreed before the work starts.');

  const ph = phoneShell(root, C, wide ? { x:1210, y:64, w:430 } : { x:(W-620)/2, y:520, w:620 });
  const img = document.createElement('img');
  img.src = 'v3-mobile/s4.png';
  Object.assign(img.style, { position:'absolute', left:'0', top:'0', width:'100%' });
  ph.dev.appendChild(img);

  const meta = (window.__RECTS || {})['mobile/s4'] || {};
  const clickPage = meta.click || { x:195, y:793 };
  const sc = ph.innerW / 390;
  const tx = ph.x + ph.bezel + clickPage.x * sc, ty = ph.y + ph.bezel + clickPage.y * sc;
  const rip = mk(root, 'ripple', { opacity:'0' });
  const path = [
    { t:6.05-6, x: tx - 260, y: ty + 140 },
    { t:7.37-6, x: tx, y: ty },
    { t:9.0-6,  x: tx, y: ty },
  ];

  return (lt) => {
    head.update(lt, 0.18);
    const u = P(lt, 0.10, .62, E.spring);
    ph.dev.style.opacity = clamp(u * 1.35);
    ph.dev.style.transform = `translateY(${PX(lerp(70, 0, u))})`;
    const p = cursorPath(path, lt);
    setCursor(p.x, p.y, clamp(P(lt, .35, .3, E.out)) * (1 - clamp((lt - 2.55) / .35)),
      lerp(1, .9, C.pulse(lt, 1.51, .22, .06, .14)));
    rip.style.left = PX(tx); rip.style.top = PX(ty);
    ripple(rip, lt, 1.55, 150);
  };
},

/* ---- 4 · PROJECT: opens itself ---- */
project(root, C){
  const { W, mode, E, clamp, P } = C;
  const wide = mode === 'wide';
  const head = headline(root, C, {
    x: wide ? 150 : 90, y: wide ? 108 : 190, w: W - 240,
    size: wide ? 76 : 82, lines: ['A project opens itself.'] });

  const card = cropCard(root, C, { file:'v3-desktop/clients-projects.png', rectKey:'desktop/clients-projects',
    box: wide ? { x:170, y:300, w:1580, h:700 } : { x:60, y:520, w:960, h:1150 }, radius:22 });
  // soft row glow: the WAITING FOR PAYMENT row sits ~72-86% down the crop
  const glow = card ? mk(card.el, '', { position:'absolute', left:'1%', width:'98%',
    top:'70%', height:'15%', borderRadius:'12px',
    background:'linear-gradient(90deg, rgb(212 150 10/.16), rgb(212 150 10/.05))',
    opacity:'0', pointerEvents:'none' }) : null;

  return (lt) => {
    head.update(lt, 0.15);
    if (card){
      card.enter(lt, 0.42, C);
      card.dolly(lt - .42, 3.4, 1.055, '42%', '68%', C);
      if (glow) glow.style.opacity = C.pulse(lt, 1.05, 1.7, .35, .6) * .95;
    }
  };
},

/* ---- 5 · WORK: the song space ---- */
work(root, C){
  const { W, mode, E, P } = C;
  const wide = mode === 'wide';
  const head = headline(root, C, {
    x: wide ? 150 : 90, y: wide ? 108 : 190, w: W - 240,
    size: wide ? 72 : 78, lines: wide ? ['Every version. Every session.', 'One place.'] : ['Every version.', 'Every session.', 'One place.'] });

  const card = cropCard(root, C, { file:'v3-desktop/sk217-guest.png', rectKey:'desktop/sk217-guest',
    box: wide ? { x:280, y:340, w:1360, h:680 } : { x:60, y:640, w:960, h:1060 }, radius:22 });

  return (lt) => {
    head.update(lt, 0.15);
    if (card){
      card.enter(lt, 0.42, C);
      card.dolly(lt - .42, 3.4, 1.065, '50%', '64%', C);
    }
  };
},

/* ---- 6 · VERIFY: the differentiator ---- */
verify(root, C){
  const { W, mode, E, clamp, lerp, P, cursorPath, setCursor, ripple } = C;
  const wide = mode === 'wide';
  const head = headline(root, C, {
    x: wide ? 150 : 90, y: wide ? 108 : 170, w: W - 240,
    size: wide ? 72 : 76, lines: wide ? ['They pay you direct.', 'You verify in one click.'] : ['They pay direct.', 'You verify in', 'one click.'] });

  const card = cropCard(root, C, { file:'v3-desktop/gate2-review.png', rectKey:'desktop/gate2-review',
    box: wide ? { x:430, y:330, w:1100, h:690 } : { x:65, y:640, w:950, h:1090 }, radius:22 });

  let tx = 0, ty = 0, rip = null, path = null;
  if (card && card.click){
    const p = card.toStage(card.click);
    tx = p.x; ty = p.y;
    rip = mk(root, 'ripple', { opacity:'0' });
    path = [
      { t:0.9,  x: tx - 320, y: ty + 200 },
      { t:2.00, x: tx, y: ty },
      { t:3.6,  x: tx, y: ty },
    ];
  }
  const flash = document.getElementById('flash');

  return (lt) => {
    head.update(lt, 0.15);
    if (card){
      card.enter(lt, 0.40, C);
      card.dolly(lt - .40, 4.0, 1.05, '78%', '46%', C);
    }
    if (path){
      const p = cursorPath(path, lt);
      setCursor(p.x, p.y, clamp(P(lt, .8, .3, E.out)) * (1 - clamp((lt - 3.15) / .35)),
        lerp(1, .9, C.pulse(lt, 2.11, .22, .06, .14)));
      rip.style.left = PX(tx); rip.style.top = PX(ty);
      ripple(rip, lt, 2.15, 170);
    }
    if (flash) flash.style.opacity = C.pulse(lt, 2.42, .5, .12, .4) * .10;
  };
},

/* ---- 7 · PAYOFF: paid in full ---- */
payoff(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const wide = mode === 'wide';
  const head = headline(root, C, {
    x: wide ? 150 : 90, y: wide ? 108 : 170, w: W - 240,
    size: wide ? 80 : 84, lines: ['Paid in full. Verified.'] });

  const box = wide ? { x:965, y:280, w:800, h:750 } : { x:100, y:600, w:880, h:1120 };
  const sharedRect = ((window.__RECTS || {})['desktop/s9-partial'] || {}).rect;
  const before = cropCard(root, C, { file:'v3-desktop/s9-partial.png', rectKey:'desktop/s9-partial', box, radius:22 });
  const after  = cropCard(root, C, { file:'v3-desktop/s9-paid.png',    rectKey:'desktop/s9-paid',
    rectOverride: sharedRect, box, radius:22 });

  // the money moment
  const money = mk(root, '', { position:'absolute',
    left:PX(wide ? 150 : 90), top:PX(wide ? 330 : 340), pointerEvents:'none' });
  const amount = mk(money, 'disp', { fontSize:PX(wide ? 150 : 144), color:AMBER,
    lineHeight:'1', letterSpacing:'-.02em' }, '₪2,400');
  const sub = mk(money, '', { display:'flex', alignItems:'center', gap:'14px', marginTop:'22px' });
  const dot = mk(sub, 'dot', { width:'14px', height:'14px', background:'rgb(34 197 94)' });
  mk(sub, 'mono', { fontSize:PX(wide ? 30 : 32), color:'rgb(var(--fg-secondary))',
    letterSpacing:'.06em' }, 'verified · on the record');

  return (lt) => {
    head.update(lt, 0.12);
    if (before){ before.enter(lt, 0.35, C); before.dolly(lt - .35, 4.2, 1.045, '50%', '30%', C); }
    if (after){
      const d = P(lt, 1.55, .5, E.io);
      after.el.style.opacity = d;
      after.enter(lt, 0.35, C);                      // same geometry as before-card
      after.el.style.opacity = Math.min(P(lt, 0.35, .62, E.spring) * 1.35, 1) * d;
      after.dolly(lt - .35, 4.2, 1.045, '50%', '30%', C);
    }
    const mu = P(lt, 1.85, .7, E.spring);
    money.style.opacity = clamp(mu * 1.3);
    money.style.transform = `translateY(${PX(lerp(46, 0, mu))})`;
    amount.style.transform = `scale(${lerp(.94, 1, mu) * lerp(1, 1.03, C.pulse(lt, 2.0, .8, .25, .45))})`;
    dot.style.transform = `scale(${1 + C.pulse(lt, 2.1, .6, .2, .35) * .5})`;
  };
},

/* ---- 8 · CTA ---- */
cta(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const wide = mode === 'wide';
  root.classList.add('dark');
  root.style.background = '#14130F';

  const l1 = headline(root, C, { x:0, y: wide ? 250 : 560, w: W, align:'center',
    size: wide ? 96 : 92, color:'rgb(242 237 230)', lines:['Stop chasing.'] });
  const l2 = headline(root, C, { x:0, y: wide ? 380 : 700, w: W, align:'center',
    size: wide ? 96 : 92, color: AMBER, lines:['Start producing.'] });

  // wordmark + waveform
  const wm = mk(root, '', { position:'absolute', left:'0', right:'0',
    top:PX(wide ? 620 : 1010), display:'grid', placeItems:'center', gap:'26px' });
  const wave = mk(wm, '', { display:'flex', alignItems:'center', gap:'6px', height:'52px' });
  const bars = []; const r = rng(777);
  for (let i = 0; i < (wide ? 42 : 30); i++){
    const b = mk(wave, '', { width:'5px', borderRadius:'999px', background:AMBER, opacity:'.5' });
    bars.push({ el:b, h:.15 + Math.pow(r(), 1.6) * .85, ph:r() * 6.28 });
  }
  const mark = mk(wm, 'disp', { fontSize:PX(wide ? 120 : 116), color:AMBER, lineHeight:'1' }, 'Skitza');
  const cta = mk(wm, 'mono', { fontSize:PX(wide ? 30 : 32), color:'rgb(178 170 158)',
    letterSpacing:'.18em' }, 'skitza.app · get your link');

  return (lt) => {
    l1.update(lt, 0.20, { slam:true });
    l2.update(lt, 1.10, { slam:true });
    const wu = P(lt, 2.45, .8, E.spring);
    wm.style.opacity = clamp(wu * 1.3);
    wm.style.transform = `translateY(${PX(lerp(40, 0, wu))})`;
    bars.forEach(b => {
      b.el.style.height = PX(b.h * 48 * (0.55 + 0.45 * Math.sin(lt * 3.4 + b.ph)) * wu);
    });
    const cu = P(lt, 3.55, .7, E.out);
    cta.style.opacity = cu * .95;
    cta.style.letterSpacing = PX(lerp(22, 5.2, cu));
    // fade the whole end card out over the last half second
    root.style.opacity = 1 - clamp((lt - 5.55) / .45) * 0;
  };
},

};
