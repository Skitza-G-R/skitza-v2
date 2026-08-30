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

/* =============================== SCENES =============================== */
window.SCENE_BUILDERS = {

hook(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const wide = mode === 'wide';
  root.classList.add('dark');
  root.style.background = '#14130F';
  const colX = wide ? 560 : 90, baseY = wide ? 880 : 1500;
  const MSGS = ['did my transfer arrive??','which mix is final... v3 or v4?','can you resend the stems?',
    "i'll pay after the session, promise",'wait, are we tomorrow or friday??'];
  const AT = [0.15, 0.62, 1.08, 1.52, 1.94];
  const fs = wide ? 34 : 40, rowH = fs*1.25 + (wide?40:48) + (wide?18:22);
  const bubbles = MSGS.map((m, i) => ({ at:AT[i], el: mk(root, '', { position:'absolute', left:PX(colX),
    width:'max-content', maxWidth:PX(wide?800:W-180), padding:`${PX(wide?20:24)} ${PX(wide?28:32)}`,
    background:'rgb(48 46 40)', color:'rgb(238 234 226)', fontSize:PX(fs), fontWeight:'500',
    lineHeight:'1.25', borderRadius:'22px', borderBottomLeftRadius:'6px',
    boxShadow:'0 10px 30px rgb(0 0 0/.35)', willChange:'transform,opacity' }, m) }));
  const badgeWrap = mk(root, '', { position:'absolute', right:PX(wide?170:90), top:PX(wide?120:170),
    display:'flex', alignItems:'center', gap:'16px' });
  mk(badgeWrap, '', { fontSize:PX(wide?26:30), color:'rgb(150 144 134)', fontWeight:'500' }, 'unread');
  const badge = mk(badgeWrap, '', { minWidth:PX(wide?58:66), height:PX(wide?58:66), borderRadius:'999px',
    background:'rgb(220 38 38)', color:'#fff', display:'grid', placeItems:'center',
    fontSize:PX(wide?27:31), fontWeight:'700', padding:'0 14px', willChange:'transform' }, '4');
  const head = headline(root, C, { x:wide?210:90, y:wide?180:420, w:W-(wide?420:180),
    size:wide?92:96, color:'rgb(242 237 230)', lines:['Your DMs are not','a studio.'] });
  return (lt) => {
    let arrived = 0; bubbles.forEach(b => { if (lt >= b.at) arrived++; });
    bubbles.forEach((b, i) => {
      const u = P(lt, b.at, .5, E.spring), slot = arrived - 1 - i;
      b.el.style.opacity = clamp(u*1.4) * (lt > 2.3 ? .30 : 1);
      b.el.style.top = PX(baseY - slot*rowH);
      b.el.style.transform = `translateY(${PX(lerp(70,0,u))}) scale(${lerp(.92,1,u)})`;
    });
    badge.textContent = String([4,9,13,17,23][Math.max(0, Math.min(4, arrived-1))]);
    let pop = 0; bubbles.forEach(b => { pop = Math.max(pop, C.pulse(lt, b.at+.04, .3, .1, .2)); });
    badge.style.transform = `scale(${1 + pop*.35})`;
    badgeWrap.style.opacity = clamp(P(lt,.1,.4,E.out)) * (lt > 2.3 ? .38 : 1);
    const amp = lt < 2.3 ? lerp(0, 2.6, clamp(lt/2.2)) : 0;
    root.style.transform = `translate(${PX(Math.sin(lt*53)*amp)}, ${PX(Math.cos(lt*47)*amp*.7)})`;
    head.update(lt, 2.30, { slam:true });
  };
},

turn(root, C){
  const { W, mode, E, clamp, P } = C;
  const g = L(C);
  const head = headline(root, C, { x:g.headX, y:g.wide?96:170, w:W-(g.wide?300:180),
    size:g.wide?70:72, lines: g.wide ? ['One link runs the whole studio.']
                                     : ['One link runs the','whole studio.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?208:372, w:g.wide?1100:g.subW,
    size:g.subSize, text:'Your store, your prices, your booking — one address you send once.' });
  const pill = mk(root, '', { position:'absolute', left:PX(g.wide?150:90), top:PX(g.wide?272:520),
    height:PX(g.wide?60:74), borderRadius:'999px', background:'rgb(255 255 255)',
    border:'1.5px solid rgb(var(--border-strong))', display:'flex', alignItems:'center',
    padding:'0 28px', boxShadow:'0 14px 34px -14px rgb(90 72 44/.35)' });
  mk(pill, 'dot', { width:'11px', height:'11px', background:AMBER, marginRight:'15px' });
  const url = mk(pill, 'mono', { fontSize:PX(g.wide?26:30), color:INK, fontWeight:'500' }, '');
  const chip = roleChip(root, C, { x:g.wide?400:66, y:g.wide?382:660, side:'artist',
    label:'what your artist sees', size:g.chipSize });
  const card = cropCard(root, C, { file:'v3-desktop/artist-store.png', rectKey:'desktop/artist-store',
    box: g.wide ? { x:390, y:430, w:1180, h:600 } : { x:60, y:716, w:960, h:1010 }, radius:22 });
  return (lt) => {
    head.update(lt, 0.15);
    sub.update(lt, 0.85);
    const typed = 'skitza.app/join/northline-studio';
    const n = Math.floor(clamp(P(lt, 1.05, 1.30, E.lin)) * typed.length);
    url.textContent = typed.slice(0, n) + (n < typed.length ? '|' : '');
    pill.style.opacity = P(lt, 0.95, .4, E.out);
    pill.style.borderColor = n >= typed.length ? 'rgb(212 150 10)' : 'rgb(var(--border-strong))';
    chip.update(lt, 2.30);
    if (card){ card.enter(lt, 2.45); card.dolly(lt - 2.45, 4.4, 1.06, '34%', '26%'); }
  };
},

book(root, C){
  const { W, mode, E, P } = C;
  const g = L(C);
  const head = headline(root, C, { x:g.headX, y:g.wide?300:150, w:g.wide?880:g.headW,
    size:g.wide?76:78, lines:['They book','themselves.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?560:352, w:g.wide?820:g.subW, size:g.subSize,
    text:'Slots come from your calendar — Google sync included. No "are we tomorrow or friday??"' });
  const chip = roleChip(root, C, { x:g.wide?1210:66, y:g.wide?52:498, side:'artist',
    label:'your artist', size:g.chipSize });
  const ph = phone(root, C, g.wide ? { x:1210, y:104, w:426, file:'v3-mobile/artist-book.png' }
                                   : { x:(W-560)/2, y:576, w:560, file:'v3-mobile/artist-book.png' });
  return (lt) => {
    head.update(lt, 0.15);
    sub.update(lt, 0.85);
    chip.update(lt, 1.20);
    ph.enter(lt, 1.35);
    ph.dev.style.transform += ` translateY(${PX(Math.sin(lt*0.9)*3)})`;
  };
},

agree(root, C){
  const { W, mode, E, clamp, lerp, P, cursorPath, setCursor, ripple } = C;
  const g = L(C);
  const head = headline(root, C, { x:g.headX, y:g.wide?300:150, w:g.wide?880:g.headW,
    size:g.wide?76:78, lines:['They agree to','exact terms.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?560:352, w:g.wide?820:g.subW, size:g.subSize,
    text:'₪2,400 locked before you touch a fader.' });
  const chip = roleChip(root, C, { x:g.wide?1210:66, y:g.wide?52:498, side:'artist',
    label:'your artist', size:g.chipSize });
  const ph = phone(root, C, g.wide ? { x:1210, y:104, w:426, file:'v3-mobile/s4.png' }
                                   : { x:(W-560)/2, y:576, w:560, file:'v3-mobile/s4.png' });
  const meta = (window.__RECTS || {})['mobile/s4'] || {};
  const t = ph.toStage(meta.click || { x:195, y:793 });
  const rip = mk(root, 'ripple', { opacity:'0' });
  const path = [
    { t:1.60, x:t.x - 240, y:t.y + 130 },
    { t:2.84, x:t.x, y:t.y },
    { t:4.8,  x:t.x, y:t.y } ];
  return (lt) => {
    head.update(lt, 0.15);
    sub.update(lt, 0.85);
    chip.update(lt, 1.10);
    ph.enter(lt, 1.20);
    const p = cursorPath(path, lt);
    setCursor(p.x, p.y, clamp(P(lt, 1.7, .3, E.out)) * (1 - clamp((lt - 4.1)/.4)),
      lerp(1, .9, C.pulse(lt, 2.96, .22, .06, .14)));
    rip.style.left = PX(t.x); rip.style.top = PX(t.y);
    ripple(rip, lt, 3.00, 150);
  };
},

pay(root, C){
  const { W, mode, E, clamp, lerp, P, cursorPath, setCursor, ripple } = C;
  const g = L(C);
  const head = headline(root, C, { x:g.headX, y:g.wide?300:150, w:g.wide?880:g.headW,
    size:g.wide?76:78, lines:['They pay you','direct.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?560:352, w:g.wide?820:g.subW, size:g.subSize,
    text:'Bank, Bit or cash — no processor in the middle. Skitza keeps the record.' });
  const chip = roleChip(root, C, { x:g.wide?1210:66, y:g.wide?52:498, side:'artist',
    label:'your artist', size:g.chipSize });
  const ph = phone(root, C, g.wide ? { x:1210, y:104, w:426, file:'v3-mobile/s9-partial.png' }
                                   : { x:(W-560)/2, y:576, w:560, file:'v3-mobile/s9-partial.png' });
  const meta = (window.__RECTS || {})['mobile/s9-partial'] || {};
  const t = ph.toStage(meta.click || { x:195, y:557 });
  const rip = mk(root, 'ripple', { opacity:'0' });
  const path = [
    { t:1.60, x:t.x - 240, y:t.y + 150 },
    { t:2.84, x:t.x, y:t.y },
    { t:4.8,  x:t.x, y:t.y } ];
  return (lt) => {
    head.update(lt, 0.15);
    sub.update(lt, 0.85);
    chip.update(lt, 1.10);
    ph.enter(lt, 1.20);
    const p = cursorPath(path, lt);
    setCursor(p.x, p.y, clamp(P(lt, 1.7, .3, E.out)) * (1 - clamp((lt - 4.1)/.4)),
      lerp(1, .9, C.pulse(lt, 2.96, .22, .06, .14)));
    rip.style.left = PX(t.x); rip.style.top = PX(t.y);
    ripple(rip, lt, 3.00, 150);
  };
},

project(root, C){
  const { W, mode, E, P } = C;
  const g = L(C);
  const head = headline(root, C, { x:g.headX, y:g.wide?96:150, w:W-(g.wide?300:180),
    size:g.wide?70:76, lines:['Your side is already set up.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?208:(150+2*84+26), w:g.wide?1050:g.subW, size:g.subSize,
    text:'The booking became a client, a project and a payment plan — you did nothing.' });
  const chip = roleChip(root, C, { x:g.wide?150:66, y:g.wide?300:520, side:'producer',
    label:'you', size:g.chipSize });
  const card = cropCard(root, C, { file:'v3-desktop/clients-projects.png', rectKey:'desktop/clients-projects',
    box: g.wide ? { x:170, y:372, w:1580, h:640 } : { x:60, y:600, w:960, h:1100 }, radius:22 });
  const glow = card ? mk(card.el, '', { position:'absolute', left:'1%', width:'98%', top:'70%',
    height:'15%', borderRadius:'12px', opacity:'0', pointerEvents:'none',
    background:'linear-gradient(90deg, rgb(212 150 10/.16), rgb(212 150 10/.05))' }) : null;
  return (lt) => {
    head.update(lt, 0.12);
    sub.update(lt, 0.72);
    chip.update(lt, 1.00);
    if (card){
      card.enter(lt, 1.10);
      card.dolly(lt - 1.1, 2.5, 1.045, '42%', '68%');
      if (glow) glow.style.opacity = C.pulse(lt, 1.65, 1.5, .35, .55) * .95;
    }
  };
},

verify(root, C){
  const { W, mode, E, clamp, lerp, P, cursorPath, setCursor, ripple } = C;
  const g = L(C);
  const head = headline(root, C, { x:g.headX, y:g.wide?96:150, w:W-(g.wide?300:180),
    size:g.wide?70:74, lines: g.wide ? ['You verify in one click.'] : ['You verify in','one click.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?208:352, w:g.wide?1050:g.subW, size:g.subSize,
    text:'The proof lands here — not in a screenshot buried in chat.' });
  const chip = roleChip(root, C, { x:g.wide?150:66, y:g.wide?300:436, side:'producer',
    label:'you', size:g.chipSize });
  const card = cropCard(root, C, { file:'v3-desktop/gate2-review.png', rectKey:'desktop/gate2-review',
    box: g.wide ? { x:430, y:342, w:1100, h:680 } : { x:65, y:520, w:950, h:1180 }, radius:22 });
  let t = null, rip = null, path = null;
  if (card && card.click){
    t = card.toStage(card.click);
    rip = mk(root, 'ripple', { opacity:'0' });
    path = [ { t:1.7, x:t.x - 320, y:t.y + 200 }, { t:2.82, x:t.x, y:t.y }, { t:4.8, x:t.x, y:t.y } ];
  }
  const flash = document.getElementById('flash');
  return (lt) => {
    head.update(lt, 0.12);
    sub.update(lt, 0.72);
    chip.update(lt, 1.00);
    if (card){ card.enter(lt, 1.10); card.dolly(lt - 1.1, 3.7, 1.045, '78%', '46%'); }
    if (path){
      const p = cursorPath(path, lt);
      setCursor(p.x, p.y, clamp(P(lt, 1.8, .3, E.out)) * (1 - clamp((lt - 4.15)/.4)),
        lerp(1, .9, C.pulse(lt, 2.96, .22, .06, .14)));
      rip.style.left = PX(t.x); rip.style.top = PX(t.y);
      ripple(rip, lt, 3.00, 170);
    }
    if (flash) flash.style.opacity = C.pulse(lt, 3.30, .5, .12, .4) * .10;
  };
},

work(root, C){
  const { W, mode, E, P } = C;
  const g = L(C);
  const head = headline(root, C, { x:g.headX, y:g.wide?86:150, w:W-(g.wide?240:180),
    size:g.wide?62:64, lines: g.wide ? ['Every version.','Notes on the timestamp.']
                                     : ['Every version.','Timestamped notes.'] });
  const sub = subline(root, C, { x:g.subX, y:g.wide?250:320, w:g.wide?1050:g.subW, size:g.subSize,
    text:'"Which mix is final?" — answered, forever.' });
  const chip = roleChip(root, C, { x:g.wide?150:66, y:g.wide?306:376, side:'producer',
    label:'you', size:g.chipSize });
  const card = cropCard(root, C, { file:'v3-desktop/sk217-guest.png', rectKey:'desktop/sk217-guest',
    box: g.wide ? { x:300, y:362, w:1320, h:668 } : { x:60, y:600, w:960, h:1130 }, radius:22 });
  return (lt) => {
    head.update(lt, 0.12);
    sub.update(lt, 0.72);
    chip.update(lt, 1.00);
    if (card){
      card.enter(lt, 1.10);
      // settle, then drift toward the notes rail
      card.dolly(lt - 1.1, 3.7, 1.075, '82%', '52%');
    }
  };
},

payoff(root, C){
  const { W, H, mode, E, clamp, lerp, P } = C;
  const g = L(C);
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
  return (lt) => {
    head.update(lt, 0.12);
    sub.update(lt, 0.72);
    chip.update(lt, 1.00);
    if (before){ before.enter(lt, 1.05); before.dolly(lt - 1.05, 3.75, 1.04, '50%', '30%'); }
    if (after){
      after.enter(lt, 1.05);
      const d = P(lt, 2.35, .55, E.io);
      after.el.style.opacity = Math.min(P(lt, 1.05, .7, E.spring) * 1.35, 1) * d;
      after.dolly(lt - 1.05, 3.75, 1.04, '50%', '30%');
    }
    const mu = P(lt, 2.65, .7, E.spring);
    money.style.opacity = clamp(mu * 1.3);
    money.style.transform = `translateY(${PX(lerp(46, 0, mu))})`;
    amount.style.transform = `scale(${lerp(.94, 1, mu) * lerp(1, 1.03, C.pulse(lt, 2.8, .8, .25, .45))})`;
    dot.style.transform = `scale(${1 + C.pulse(lt, 2.9, .6, .2, .35) * .5})`;
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
  const wm = mk(root, '', { position:'absolute', left:'0', right:'0', top:PX(wide?640:1060),
    display:'grid', placeItems:'center', gap:'26px' });
  const wave = mk(wm, '', { display:'flex', alignItems:'center', gap:'6px', height:'52px' });
  const bars = []; const r = rng(777);
  for (let i = 0; i < (wide?42:30); i++){
    const b = mk(wave, '', { width:'5px', borderRadius:'999px', background:AMBER, opacity:'.5' });
    bars.push({ el:b, h:.15 + Math.pow(r(), 1.6)*.85, ph:r()*6.28 });
  }
  const mark = mk(wm, 'disp', { fontSize:PX(wide?120:112), color:AMBER, lineHeight:'1' }, 'Skitza');
  const url = mk(wm, 'mono', { fontSize:PX(wide?32:34), color:'rgb(200 193 182)',
    letterSpacing:'.20em' }, 'skitza.app');
  return (lt) => {
    l1.update(lt, 0.20, { slam:true });
    l2.update(lt, 1.05, { slam:true });
    const tu = P(lt, 1.95, .6, E.out);
    tag.style.opacity = tu * .95;
    tag.style.transform = `translateY(${PX(lerp(16, 0, tu))})`;
    const wu = P(lt, 2.60, .8, E.spring);
    wm.style.opacity = clamp(wu * 1.3);
    wm.style.transform = `translateY(${PX(lerp(40, 0, wu))})`;
    bars.forEach(b => { b.el.style.height = PX(b.h * 48 * (0.55 + 0.45*Math.sin(lt*3.4 + b.ph)) * wu); });
    const cu = P(lt, 3.90, .8, E.out);
    url.style.opacity = cu;
    url.style.letterSpacing = PX(lerp(26, 6.4, cu));
  };
},

};
