/* Skitza teaser v4 — two-sided story at a comprehension pace.
   Grammar: artist beats live on a phone with a copper YOUR ARTIST chip;
   producer beats live in a browser card with an amber YOU chip. Headlines
   enter alone, then the benefit sub-line, then the UI, then the action —
   one thing at a time. Cuts sit on a 100 BPM grid (0.6s). */

function mk(parent, cls, css, text){
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (css) Object.assign(d.style, css);
  if (text != null) d.textContent = text;
  parent.appendChild(d); return d;
}
const PX = v => (typeof v === 'number' ? v.toFixed(2) + 'px' : v);
function rng(seed){ let s = seed >>> 0; return () => ((s = (s*1664525 + 1013904223) >>> 0) / 4294967296); }

const INK = 'rgb(17 16 9)', AMBER = 'rgb(212 150 10)', COPPER = 'rgb(176 104 48)';

/* ---------- kinetic headline ---------- */
function headline(root, C, { x, y, w, size, color = INK, align = 'left', lines }){
  const { clamp, lerp, P } = C;
  const wrap = mk(root, '', { position:'absolute', left:PX(x), top:PX(y), width:PX(w),
    textAlign:align, pointerEvents:'none' });
  const words = [];
  const lineEls = lines.map((line, li) => {
    const l = mk(wrap, 'disp', { fontSize:PX(size), lineHeight:'1.05', color,
      letterSpacing:'-.025em', display:'block', whiteSpace:'nowrap' });
    line.split(' ').forEach(word => {
      const holder = mk(l, '', { display:'inline-block', overflow:'hidden',
        verticalAlign:'bottom', paddingRight:'.24em', marginRight:'-.02em' });
      const el = mk(holder, '', { display:'inline-block', willChange:'transform,opacity' }, word);
      words.push({ el, li });
    });
    return l;
  });
  // Deliberate line breaks only: measure each nowrap line and shrink the
  // whole block until the widest one fits the column.
  let factor = 1;
  for (const l of lineEls){
    const m = l.cloneNode(true);
    Object.assign(m.style, { position:'absolute', left:'-99999px', top:'0',
      display:'inline-block', width:'auto' });
    wrap.appendChild(m);
    const cw = m.getBoundingClientRect().width;
    m.remove();
    if (cw > w) factor = Math.min(factor, w / cw);
  }
  if (factor < 1){
    const fitted = size * factor * 0.985;
    lineEls.forEach(l => { l.style.fontSize = PX(fitted); });
  }
  return {
    el: wrap,
    update(lt, at, opts = {}){
      const slam = opts.slam;
      words.forEach((wd, i) => {
        const d = at + i * (slam ? 0.03 : 0.06) + wd.li * 0.12;
        const u = P(lt, d, slam ? 0.30 : 0.66, slam ? C.E.outQ : C.E.spring);
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

/* ---------- benefit sub-line ---------- */
function subline(root, C, { x, y, w, size, align = 'left', text }){
  const { clamp, lerp, P } = C;
  const el = mk(root, '', { position:'absolute', left:PX(x), top:PX(y), width:PX(w),
    textAlign:align, fontSize:PX(size), fontWeight:'500', lineHeight:'1.35',
    color:'rgb(var(--fg-muted))', pointerEvents:'none', willChange:'transform,opacity' }, text);
  return { el, update(lt, at){
    const u = P(lt, at, .6, C.E.out);
    el.style.opacity = u;
    el.style.transform = `translateY(${PX(lerp(14, 0, u))})`;
  }};
}

/* ---------- role chip: who is on screen ---------- */
function roleChip(root, C, { x, y, side, label, size }){
  const { clamp, lerp, P } = C;
  const artist = side === 'artist';
  const el = mk(root, '', { position:'absolute', left:PX(x), top:PX(y),
    display:'inline-flex', alignItems:'center', gap:'10px',
    padding:`${PX(size*0.42)} ${PX(size*0.85)}`, borderRadius:'999px',
    fontSize:PX(size), fontWeight:'700', letterSpacing:'.12em', textTransform:'uppercase',
    background: artist ? 'rgb(176 104 48 / .15)' : 'rgb(17 16 9)',
    color: artist ? 'rgb(122 69 32)' : AMBER,
    border: artist ? '1.5px solid rgb(176 104 48 / .35)' : '1.5px solid rgb(17 16 9)',
    willChange:'transform,opacity' });
  mk(el, 'dot', { width:PX(size*0.5), height:PX(size*0.5),
    background: artist ? COPPER : AMBER });
  mk(el, '', {}, label);
  return { el, update(lt, at){
    const u = P(lt, at, .55, C.E.spring);
    el.style.opacity = clamp(u * 1.3);
    el.style.transform = `translateY(${PX(lerp(16, 0, u))}) scale(${lerp(.94, 1, u)})`;
  }};
}

/* ---------- measured crop card ---------- */
function cropCard(root, C, { file, rectKey, rectOverride, box, radius = 20 }){
  const meta = (window.__RECTS || {})[rectKey] || {};
  const rect = rectOverride || meta.rect;
  const page = meta.page || { w: 1512, h: 998 };
  if (!rect) return null;
  const fit = Math.min(box.w / rect.w, box.h / rect.h);
  const cw = rect.w * fit, ch = rect.h * fit;
  const cx = box.x + (box.w - cw) / 2, cy = box.y + (box.h - ch) / 2;
  const card = mk(root, '', { position:'absolute', left:PX(cx), top:PX(cy),
    width:PX(cw), height:PX(ch), borderRadius:PX(radius), overflow:'hidden',
    background:'rgb(255 255 255)', border:'1px solid rgb(var(--border-subtle))',
    boxShadow:'0 2px 5px rgb(120 100 70/.07), 0 44px 88px -30px rgb(70 55 30/.40)',
    willChange:'transform,opacity' });
  const mover = mk(card, '', { position:'absolute', inset:'0', willChange:'transform' });
  const img = document.createElement('img');
  img.src = file;
  Object.assign(img.style, { position:'absolute',
    left:PX(-rect.x * fit), top:PX(-rect.y * fit), width:PX(page.w * fit), height:'auto' });
  mover.appendChild(img);
  return {
    el: card, cx, cy, cw, ch,
    toStage(p){ return { x: cx + (p.x - rect.x) * fit, y: cy + (p.y - rect.y) * fit }; },
    click: meta.click || null,
    enter(lt, at){
      const u = C.P(lt, at, .70, C.E.spring);
      card.style.opacity = C.clamp(u * 1.35);
      card.style.transform = `translateY(${PX(C.lerp(60, 0, u))}) scale(${C.lerp(.965, 1, u)})`;
    },
    dolly(lt, dur, zoom = 1.045, ox = '50%', oy = '50%'){
      mover.style.transformOrigin = `${ox} ${oy}`;
      mover.style.transform = `scale(${C.lerp(1, zoom, C.E.io(C.clamp(lt / dur)))})`;
    }
  };
}

/* ---------- phone ---------- */
function phone(root, C, { x, y, w, file }){
  const h = w * (844 / 390);
  const bezel = Math.max(7, w * 0.017);
  mk(root, '', { position:'absolute', left:PX(x + w/2 - w*1.45), top:PX(y + h/2 - w*1.45),
    width:PX(w*2.9), height:PX(w*2.9), borderRadius:'999px', pointerEvents:'none',
    background:'radial-gradient(circle, rgb(212 150 10/.14) 0%, rgb(212 150 10/.05) 44%, rgb(212 150 10/0) 70%)' });
  const dev = mk(root, '', { position:'absolute', left:PX(x), top:PX(y), width:PX(w), height:PX(h),
    borderRadius:PX(w * 0.115), overflow:'hidden', background:'#fff',
    border:`${PX(bezel)} solid #14130F`,
    boxShadow:'0 3px 6px rgb(60 46 22/.14), 0 46px 90px -28px rgb(60 46 22/.46)',
    willChange:'transform,opacity' });
  const img = document.createElement('img');
  img.src = file;
  Object.assign(img.style, { position:'absolute', left:'0', top:'0', width:'100%' });
  dev.appendChild(img);
  const sc = (w - bezel*2) / 390;
  return {
    dev, x, y, w, h,
    toStage(p){ return { x: x + bezel + p.x * sc, y: y + bezel + p.y * sc }; },
    enter(lt, at){
      const u = C.P(lt, at, .70, C.E.spring);
      dev.style.opacity = C.clamp(u * 1.35);
      dev.style.transform = `translateY(${PX(C.lerp(70, 0, u))})`;
    }
  };
}

/* layout constants per mode */
function L(C){
  const wide = C.mode === 'wide';
  return wide ? {
    wide, headX:150, headY:104, headW:1620, headSize:72,
    subX:154, subY:0 /*set per beat*/, subW:900, subSize:30,
    chipSize:17,
  } : {
    wide, headX:90, headY:150, headW:900, headSize:76,
    subX:94, subW:880, subSize:33,
    chipSize:19,
  };
}

/* ---------- v5 additions: recorded-sequence playback + micro wordmark ---------- */
function seqFrameAt(man, t){
  const fr = man.frames;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi){ const mid = (lo + hi + 1) >> 1; (fr[mid].t <= t) ? lo = mid : hi = mid - 1; }
  return fr[Math.max(0, lo)].f;
}
/* card that plays a recorded interaction inside its measured rect */
function seqCard(root, C, { name, box, radius = 20 }){
  const man = (window.__SEQS || {})[name];
  if (!man || !man.rect) return null;
  const card = cropCard(root, C, {
    file: `seq/${name}/${man.frames[0].f}`,
    rectKey: '__seq__', rectOverride: man.rect, box, radius });
  if (!card) return null;
  // cropCard sized the img from the still-capture page dims; fix to the seq's
  const img = card.el.querySelector('img');
  const fit = card.cw / man.rect.w;
  img.style.width = PX(man.page.w * fit);
  img.style.left = PX(-man.rect.x * fit);
  img.style.top  = PX(-man.rect.y * fit);
  let last = '';
  card.play = (lt, start) => {
    const f = seqFrameAt(man, Math.max(0, lt - start));
    if (f !== last){ img.src = `seq/${name}/${f}`; last = f; }
  };
  return card;
}
/* phone whose screen plays a recorded mobile interaction */
function seqPhone(root, C, geo, name){
  const man = (window.__SEQS || {})[name];
  const ph = phone(root, C, { ...geo, file: man ? `seq/${name}/${man.frames[0].f}` : geo.file });
  if (man){
    const img = ph.dev.querySelector('img');
    let last = '';
    ph.play = (lt, start) => {
      const f = seqFrameAt(man, Math.max(0, lt - start));
      if (f !== last){ img.src = `seq/${name}/${f}`; last = f; }
    };
  } else ph.play = () => {};
  return ph;
}
function microWM(root, C){
  const wide = C.mode === 'wide';
  const el = mk(root, 'disp', { position:'absolute',
    right:PX(wide ? 44 : 34), top:PX(wide ? 34 : 40),
    fontSize:PX(wide ? 24 : 26), fontWeight:'800', letterSpacing:'-.02em',
    color:'rgb(17 16 9 / .38)', pointerEvents:'none' }, 'skitza.');
  return { el, update(lt){ el.style.opacity = C.clamp(C.P(lt, 0.05, .4, C.E.out)); } };
}
/* montage micro-beat layout: short headline + chip + device, fast */
function microHead(root, C, text){
  const wide = C.mode === 'wide';
  return headline(root, C, { x: wide?150:90, y: wide?330:210, w: wide?840:900,
    size: wide?64:62, lines:[text] });
}

/* =============================== SCENES =============================== */
window.SCENE_BUILDERS = {

hook(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const wide = mode === 'wide';
  root.classList.add('dark');
  root.style.background = '#14130F';
  const colX = wide ? 560 : 90, baseY = wide ? 880 : 1500;
  const MSGS = ['which mix is final... v3 or v4?','can you resend the stems?',
    'wait, are we tomorrow or friday??','did my transfer arrive??',
    "i'll pay after the session, promise"];
  const AT = [0.15, 0.62, 1.08, 1.52, 1.94];
  const fs = wide ? 34 : 40, rowH = fs*1.25 + (wide?40:48) + (wide?18:22);
  const bubbles = MSGS.map((m, i) => ({ at:AT[i], money: i === 4, el: mk(root, '', { position:'absolute', left:PX(colX),
    width:'max-content', maxWidth:PX(wide?800:W-180), padding:`${PX(wide?20:24)} ${PX(wide?28:32)}`,
    background:'rgb(48 46 40)', color:'rgb(238 234 226)', fontSize:PX(fs), fontWeight:'500',
    lineHeight:'1.25', borderRadius:'22px', borderBottomLeftRadius:'6px',
    boxShadow:'0 10px 30px rgb(0 0 0/.35)', willChange:'transform,opacity' }, m) }));
  const badgeWrap = mk(root, '', { position:'absolute', right:PX(wide?170:90), top:PX(wide?120:170),
    display:'flex', alignItems:'center', gap:'16px' });
  mk(badgeWrap, '', { fontSize:PX(wide?26:30), color:'rgb(150 144 134)', fontWeight:'500' }, 'unread');
  const badge = mk(badgeWrap, '', { minWidth:PX(wide?58:66), height:PX(wide?58:66), borderRadius:'999px',
    background:'rgb(220 38 38)', color:'#fff', display:'grid', placeItems:'center',
    fontSize:PX(wide?27:31), fontWeight:'700', padding:'0 14px', willChange:'transform' }, '2');
  const head = headline(root, C, { x:wide?210:90, y:wide?180:420, w:W-(wide?420:180),
    size:wide?92:96, color:'rgb(242 237 230)', lines:['Your DMs are not','a studio.'] });
  return (lt) => {
    let arrived = 0; bubbles.forEach(b => { if (lt >= b.at) arrived++; });
    bubbles.forEach((b, i) => {
      const u = P(lt, b.at, .5, E.spring), slot = arrived - 1 - i;
      // the money bubble stays lit through the slam; the rest dim
      const dim = lt > 2.3 ? (b.money ? .85 : .22) : 1;
      b.el.style.opacity = clamp(u*1.4) * dim;
      b.el.style.top = PX(baseY - slot*rowH);
      b.el.style.transform = `translateY(${PX(lerp(70,0,u))}) scale(${lerp(.92,1,u)})`;
      if (b.money && lt > 2.3) b.el.style.boxShadow = '0 10px 30px rgb(0 0 0/.35), 0 0 0 1.5px rgb(212 150 10/.55)';
    });
    // motion from the very first frames
    const c0 = P(lt, 0.05, .3, E.spring);
    badgeWrap.style.opacity = clamp(c0*1.3) * (lt > 2.3 ? .4 : 1);
    badge.textContent = String([2,4,9,13,17,23][Math.min(5, arrived + (lt >= 0.05 ? 0 : 0))] ?? 2);
    let pop = C.pulse(lt, 0.06, .3, .1, .2);
    bubbles.forEach(b => { pop = Math.max(pop, C.pulse(lt, b.at+.04, .3, .1, .2)); });
    badge.style.transform = `scale(${lerp(.8, 1, c0) + pop*.35})`;
    const amp = lt < 2.3 ? lerp(0, 2.6, clamp(lt/2.2)) : 0;
    root.style.transform = `translate(${PX(Math.sin(lt*53)*amp)}, ${PX(Math.cos(lt*47)*amp*.7)})`;
    head.update(lt, 2.30, { slam:true });
  };
},

turn(root, C){
  const { W, mode, E, clamp, P } = C;
  const g = L(C);
  const wm = microWM(root, C);
  const head = headline(root, C, { x:g.headX, y:g.wide?96:170, w:W-(g.wide?300:180),
    size:g.wide?74:76, lines: g.wide ? ['One link gets you paid.'] : ['One link gets','you paid.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?212:352, w:g.wide?1100:g.subW, size:g.subSize,
    text:'Store, booking, terms and delivery — one address does the chasing.' });
  const pill = mk(root, '', { position:'absolute', left:PX(g.wide?150:90), top:PX(g.wide?282:500),
    height:PX(g.wide?58:72), borderRadius:'999px', background:'rgb(255 255 255)',
    border:'1.5px solid rgb(var(--border-strong))', display:'flex', alignItems:'center',
    padding:'0 26px', boxShadow:'0 14px 34px -14px rgb(90 72 44/.35)' });
  mk(pill, 'dot', { width:'11px', height:'11px', background:AMBER, marginRight:'14px' });
  const url = mk(pill, 'mono', { fontSize:PX(g.wide?25:29), color:INK, fontWeight:'500' }, '');
  const chip = roleChip(root, C, { x:g.wide?400:66, y:g.wide?392:640, side:'artist',
    label:'what your artist sees', size:g.chipSize });
  const card = seqCard(root, C, { name:'store',
    box: g.wide ? { x:390, y:436, w:1180, h:596 } : { x:60, y:700, w:960, h:1020 }, radius:22 });
  return (lt) => {
    wm.update(lt);
    head.update(lt, 0.15);
    sub.update(lt, 0.80);
    const typed = 'skitza.app/join/northline-studio';
    const n = Math.floor(clamp(P(lt, 0.95, 1.15, E.lin)) * typed.length);
    url.textContent = typed.slice(0, n) + (n < typed.length ? '|' : '');
    pill.style.opacity = P(lt, 0.85, .4, E.out);
    pill.style.borderColor = n >= typed.length ? 'rgb(212 150 10)' : 'rgb(var(--border-strong))';
    chip.update(lt, 2.10);
    if (card){
      card.enter(lt, 2.25);
      card.play(lt, 2.25);              // real hover on View service, recorded
      card.dolly(lt - 2.25, 4.2, 1.05, '34%', '30%');
    }
  };
},

book(root, C){
  const { W, mode, E, P } = C;
  const wide = mode === 'wide';
  const wm = microWM(root, C);
  const head = microHead(root, C, wide ? 'They book a session.' : 'They book.');
  const chip = roleChip(root, C, { x:wide?1210:66, y:wide?60:120, side:'artist',
    label:'your artist', size:L(C).chipSize });
  const ph = seqPhone(root, C, wide ? { x:1210, y:112, w:420 } : { x:(W-560)/2, y:400, w:560 }, 'book');
  return (lt) => {
    wm.update(lt);
    head.update(lt, 0.08);
    chip.update(lt, 0.30);
    ph.enter(lt, 0.15);
    ph.play(lt, 0.20);                  // day tap → real slots
  };
},

agree(root, C){
  const { W, mode, E, P } = C;
  const wide = mode === 'wide';
  const wm = microWM(root, C);
  const head = microHead(root, C, wide ? 'They accept exact terms.' : 'Exact terms.');
  const chip = roleChip(root, C, { x:wide?1210:66, y:wide?60:120, side:'artist',
    label:'your artist', size:L(C).chipSize });
  const ph = seqPhone(root, C, wide ? { x:1210, y:112, w:420 } : { x:(W-560)/2, y:400, w:560 }, 'agree');
  mk(root, '', { position:'absolute', left:PX(wide?154:94), top:PX(wide?440:330),
    fontSize:PX(wide?28:30), color:'rgb(var(--fg-muted))', fontWeight:'500' },
    '₪2,400, frozen before the work starts.');
  return (lt) => {
    wm.update(lt);
    head.update(lt, 0.08);
    chip.update(lt, 0.30);
    ph.enter(lt, 0.15);
    ph.play(lt, 0.15);                  // the real agreement scrolling by
  };
},

pay(root, C){
  const { W, mode, E, clamp, lerp, P, cursorPath, setCursor, ripple } = C;
  const wide = mode === 'wide';
  const wm = microWM(root, C);
  const head = microHead(root, C, wide ? 'They pay you direct.' : 'They pay direct.');
  const chip = roleChip(root, C, { x:wide?1210:66, y:wide?60:120, side:'artist',
    label:'your artist', size:L(C).chipSize });
  const ph = seqPhone(root, C, wide ? { x:1210, y:112, w:420 } : { x:(W-560)/2, y:400, w:560 }, 'pay');
  mk(root, '', { position:'absolute', left:PX(wide?154:94), top:PX(wide?440:330),
    fontSize:PX(wide?28:30), color:'rgb(var(--fg-muted))', fontWeight:'500' },
    'Bank, Bit or cash — Skitza keeps the record.');
  const meta = (window.__RECTS || {})['mobile/s9-partial'] || {};
  const t = ph.toStage(meta.click || { x:195, y:557 });
  const rip = mk(root, 'ripple', { opacity:'0' });
  const path = [ { t:0.55, x:t.x - 200, y:t.y + 120 }, { t:1.35, x:t.x, y:t.y }, { t:2.4, x:t.x, y:t.y } ];
  return (lt) => {
    wm.update(lt);
    head.update(lt, 0.08);
    chip.update(lt, 0.30);
    ph.enter(lt, 0.15);
    ph.play(lt, 0.15);
    const p = cursorPath(path, lt);
    setCursor(p.x, p.y, clamp(P(lt, .6, .3, E.out)) * (1 - clamp((lt - 2.05)/.3)),
      lerp(1, .9, C.pulse(lt, 1.46, .22, .06, .14)));
    rip.style.left = PX(t.x); rip.style.top = PX(t.y);
    ripple(rip, lt, 1.50, 150);
  };
},

verify(root, C){
  const { W, mode, E, clamp, lerp, P, cursorPath, setCursor, ripple } = C;
  const g = L(C);
  const wm = microWM(root, C);
  const head = headline(root, C, { x:g.headX, y:g.wide?96:150, w:W-(g.wide?300:180),
    size:g.wide?70:74, lines: g.wide ? ['You verify in one click.'] : ['You verify in','one click.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?208:352, w:g.wide?1050:g.subW, size:g.subSize,
    text:'The proof lands here — not in a screenshot buried in chat.' });
  const chip = roleChip(root, C, { x:g.wide?150:66, y:g.wide?300:436, side:'producer',
    label:'you', size:g.chipSize });
  const card = seqCard(root, C, { name:'verify',
    box: g.wide ? { x:430, y:342, w:1100, h:680 } : { x:65, y:520, w:950, h:1180 }, radius:22 });
  let t = null, rip = null, path = null;
  const gmeta = (window.__RECTS || {})['desktop/gate2-review'] || {};
  if (card && gmeta.click){
    t = card.toStage(gmeta.click);
    rip = mk(root, 'ripple', { opacity:'0' });
    path = [ { t:1.5, x:t.x - 300, y:t.y + 190 }, { t:2.55, x:t.x, y:t.y }, { t:5.4, x:t.x, y:t.y } ];
  }
  const flash = document.getElementById('flash');
  return (lt) => {
    wm.update(lt);
    head.update(lt, 0.12);
    sub.update(lt, 0.72);
    chip.update(lt, 1.00);
    if (card){
      card.enter(lt, 1.05);
      card.play(lt, 1.05);              // recorded hover + genuine press state
      // macro: push toward the button through the beat
      card.dolly(lt - 1.05, 4.35, 1.16, '78%', '46%');
    }
    if (path){
      const p = cursorPath(path, lt);
      setCursor(p.x, p.y, clamp(P(lt, 1.6, .3, E.out)) * (1 - clamp((lt - 4.6)/.4)),
        lerp(1, .9, C.pulse(lt, 2.76, .22, .06, .14)));
      rip.style.left = PX(t.x); rip.style.top = PX(t.y);
      ripple(rip, lt, 2.80, 170);
    }
    if (flash) flash.style.opacity = C.pulse(lt, 3.12, .5, .12, .4) * .10;
  };
},

locked(root, C){
  const { W, mode, E, clamp, lerp, P } = C;
  const g = L(C);
  const wm = microWM(root, C);
  const head = headline(root, C, { x:g.headX, y:g.wide?96:150, w:W-(g.wide?300:180),
    size:g.wide?70:72, lines: g.wide ? ['Locked until you’re paid.'] : ['Locked until','you’re paid.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?208:352, w:g.wide?1050:g.subW, size:g.subSize,
    text:'The master stays locked — ₪1,200 remaining. Notes land on the timestamp.' });
  const chip = roleChip(root, C, { x:g.wide?150:66, y:g.wide?300:436, side:'producer',
    label:'you', size:g.chipSize });
  const card = seqCard(root, C, { name:'locked',
    box: g.wide ? { x:300, y:342, w:1320, h:688 } : { x:60, y:520, w:960, h:1180 }, radius:22 });
  return (lt) => {
    wm.update(lt);
    if (card){
      card.enter(lt, 0.10);
      card.play(lt, 0.35);              // the real drag-scrub sweeps the waveform
      // open INSIDE the waveform, pull back to reveal the locked page
      const pull = P(lt, 0.10, 2.0, E.io);
      const mover = card.el.querySelector('div');
      mover.style.transformOrigin = '32% 48%';
      mover.style.transform = `scale(${lerp(2.55, 1.0, pull) * lerp(1, 1.03, P(lt, 2.4, 3.0, E.io))})`;
    }
    head.update(lt, 1.60);
    sub.update(lt, 2.25);
    chip.update(lt, 2.55);
  };
},

payoff(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const g = L(C);
  const wm = microWM(root, C);
  const head = headline(root, C, { x:g.headX, y:g.wide?96:150, w:W-(g.wide?300:180),
    size:g.wide?76:76, lines: g.wide ? ['Paid in full. Verified.'] : ['Paid in full.','Verified.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?214:356, w:g.wide?820:g.subW, size:g.subSize,
    text:'Downloads unlock only when you are paid.' });
  const chip = roleChip(root, C, { x:g.wide?150:66, y:g.wide?306:428, side:'producer',
    label:'you', size:g.chipSize });
  const box = g.wide ? { x:965, y:300, w:800, h:730 } : { x:100, y:760, w:880, h:1010 };
  const sharedRect = ((window.__RECTS || {})['desktop/s9-partial'] || {}).rect;
  const before = cropCard(root, C, { file:'v3-desktop/s9-partial.png', rectKey:'desktop/s9-partial', box, radius:22 });
  const after  = cropCard(root, C, { file:'v3-desktop/s9-paid.png', rectKey:'desktop/s9-paid',
    rectOverride: sharedRect, box, radius:22 });
  const money = mk(root, '', { position:'absolute', left:PX(g.wide?150:90),
    top:PX(g.wide?380:516), pointerEvents:'none' });
  const amount = mk(money, 'disp', { fontSize:PX(g.wide?150:132), color:AMBER,
    lineHeight:'1', letterSpacing:'-.02em' }, '₪2,400');
  const msub = mk(money, '', { display:'flex', alignItems:'center', gap:'14px', marginTop:'22px' });
  const dot = mk(msub, 'dot', { width:'14px', height:'14px', background:'rgb(34 197 94)' });
  mk(msub, 'mono', { fontSize:PX(g.wide?30:30), color:'rgb(var(--fg-secondary))',
    letterSpacing:'.06em' }, 'verified · on the record');
  return (lt, dur) => {
    wm.update(lt);
    head.update(lt, 0.12);
    sub.update(lt, 0.75);
    chip.update(lt, 1.05);
    if (before){ before.enter(lt, 1.00); before.dolly(lt - 1.0, dur - 1.2, 1.04, '50%', '30%'); }
    if (after){
      after.enter(lt, 1.00);
      const d = P(lt, 2.70, .6, E.io);
      after.el.style.opacity = Math.min(P(lt, 1.00, .7, E.spring) * 1.35, 1) * d;
      after.dolly(lt - 1.0, dur - 1.2, 1.04, '50%', '30%');
    }
    const mu = P(lt, 3.10, .7, E.spring);
    money.style.opacity = clamp(mu * 1.3);
    money.style.transform = `translateY(${PX(lerp(46, 0, mu))})`;
    amount.style.transform = `scale(${lerp(.94, 1, mu) * lerp(1, 1.03, C.pulse(lt, 3.25, .8, .25, .45))})`;
    dot.style.transform = `scale(${1 + C.pulse(lt, 3.35, .6, .2, .35) * .5})`;
  };
},

cta(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const wide = mode === 'wide';
  root.classList.add('dark');
  root.style.background = '#14130F';
  const l1 = headline(root, C, { x:0, y:wide?220:520, w:W, align:'center',
    size:wide?96:92, color:'rgb(242 237 230)', lines:['Stop chasing.'] });
  const l2 = headline(root, C, { x:0, y:wide?350:660, w:W, align:'center',
    size:wide?96:92, color:AMBER, lines:['Start producing.'] });
  const tag = mk(root, '', { position:'absolute', left:'0', right:'0', top:PX(wide?520:840),
    textAlign:'center', fontSize:PX(wide?30:34), fontWeight:'500',
    color:'rgb(178 170 158)', willChange:'transform,opacity' },
    'One link. Both sides. Everything on the record.');
  const wmk = mk(root, '', { position:'absolute', left:'0', right:'0', top:PX(wide?640:1060),
    display:'grid', placeItems:'center', gap:'26px' });
  const wave = mk(wmk, '', { display:'flex', alignItems:'center', gap:'6px', height:'52px' });
  const bars = []; const r = rng(777);
  for (let i = 0; i < (wide?42:30); i++){
    const b = mk(wave, '', { width:'5px', borderRadius:'999px', background:AMBER, opacity:'.5' });
    bars.push({ el:b, h:.15 + Math.pow(r(), 1.6)*.85, ph:r()*6.28 });
  }
  const mark = mk(wmk, 'disp', { fontSize:PX(wide?120:112), color:AMBER, lineHeight:'1' }, 'Skitza');
  const url = mk(wmk, 'mono', { fontSize:PX(wide?32:34), color:'rgb(200 193 182)',
    letterSpacing:'.20em' }, 'skitza.app');
  return (lt) => {
    l1.update(lt, 0.25, { slam:true });
    l2.update(lt, 1.15, { slam:true });
    const tu = P(lt, 2.10, .6, E.out);
    tag.style.opacity = tu * .95;
    tag.style.transform = `translateY(${PX(lerp(16, 0, tu))})`;
    const wu = P(lt, 2.85, .8, E.spring);
    wmk.style.opacity = clamp(wu * 1.3);
    wmk.style.transform = `translateY(${PX(lerp(40, 0, wu))})`;
    bars.forEach(b => { b.el.style.height = PX(b.h * 48 * (0.55 + 0.45*Math.sin(lt*3.4 + b.ph)) * wu); });
    const cu = P(lt, 4.10, .8, E.out);
    url.style.opacity = cu;
    url.style.letterSpacing = PX(lerp(26, 6.4, cu));
  };
},

};
