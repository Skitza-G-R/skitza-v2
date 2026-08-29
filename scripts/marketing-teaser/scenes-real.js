/* Skitza teaser — built on real captures of the running app.
   Every product beat is a screenshot of an actual dev-gallery screen
   (real components, real copy, real currency). Only the open and close
   title cards are drawn, because no product screen is a title card.   */

function mk(parent, cls, css, text){
  const d=document.createElement('div');
  if(cls) d.className=cls;
  if(css) Object.assign(d.style,css);
  if(text!=null) d.textContent=text;
  parent.appendChild(d); return d;
}
const PX = v => (typeof v==='number' ? v.toFixed(2)+'px' : v);
function rng(seed){ let s=seed>>>0; return ()=>((s=(s*1664525+1013904223)>>>0)/4294967296); }

const DESK_AR = 945/1512;     // desktop capture aspect
const PHONE_AR = 844/390;     // phone capture aspect

// where the device sits in frame, per aspect and per form
function frameGeom(mode, form){
  if(mode==='wide'){
    if(form==='desktop') return { x:180, y:30,  w:1560, ar:DESK_AR,  chrome:44, phone:false };
    return                      { x:238, y:62, w:442, ar:PHONE_AR, chrome:0, phone:true, split:true };
  }
  return                        { x:(1080-664)/2, y:54, w:664, ar:PHONE_AR, chrome:0, phone:true };
}

// one cream scrim under the caption so text stays readable over any screenshot
function ensureScrim(){
  let s=document.getElementById('scrim');
  if(!s){
    s=document.createElement('div'); s.id='scrim';
    Object.assign(s.style,{ position:'absolute', left:'0', right:'0', bottom:'0',
      zIndex:'65', pointerEvents:'none', opacity:'0' });
    document.getElementById('stage').appendChild(s);
  }
  return s;
}

/* ---------------------------------------------------------------- product beat
   spec: { form, shots:[a,(b)], url, click:{nx,ny,at}, dissolve, focus:{nx,ny}, zoom } */
function productBeat(spec){
  return function(root, C){
    const { W, H, mode, E, clamp, lerp, P, px, cursorPath, setCursor, ripple } = C;
    const g = frameGeom(mode, spec.form || 'desktop');
    const tall = (mode === 'tall');
    const dir = g.phone ? 'caps-mobile' : 'caps-desktop';
    const shots = (tall && spec.shotsTall) ? spec.shotsTall : spec.shots;
    const click = (tall && spec.clickTall !== undefined) ? spec.clickTall
                : (tall && spec.click && !spec.clickTall) ? null
                : spec.click;
    const focusSpec = (tall && spec.focusTall) ? spec.focusTall : spec.focus;
    const contentH = g.w * g.ar;

    const scrim = ensureScrim();
    scrim.style.height = PX(mode==='wide' ? 300 : 560);
    scrim.style.background = mode==='wide'
      ? 'linear-gradient(to top, rgb(242 237 230) 34%, rgb(242 237 230 / .86) 62%, rgb(242 237 230 / 0) 100%)'
      : 'linear-gradient(to top, rgb(242 237 230) 46%, rgb(242 237 230 / .88) 72%, rgb(242 237 230 / 0) 100%)';

    // warm glow behind a phone so it doesn't float on flat cream
    if(g.phone){
      mk(root,'',{ position:'absolute', left:PX(g.x + g.w/2 - g.w*1.5), top:PX(g.y + contentH/2 - g.w*1.5),
        width:PX(g.w*3), height:PX(g.w*3), borderRadius:'999px', pointerEvents:'none',
        background:'radial-gradient(circle, rgb(212 150 10 / .16) 0%, rgb(212 150 10 / .05) 42%, rgb(212 150 10 / 0) 68%)' });
    }

    // device shell
    const dev = mk(root,'',{ position:'absolute', left:PX(g.x), top:PX(g.y), width:PX(g.w),
      height:PX(contentH + g.chrome), borderRadius: g.phone?PX(Math.round(g.w*0.115)):'20px',
      overflow:'hidden', background:'rgb(var(--bg-elevated))',
      border: g.phone ? PX(Math.max(7, g.w*0.017))+' solid #14130F' : '1px solid rgb(var(--border-subtle))',
      boxShadow: g.phone
        ? '0 3px 6px rgb(60 46 22/.14), 0 46px 90px -28px rgb(60 46 22/.46)'
        : '0 2px 5px rgb(120 100 70/.07), 0 52px 96px -34px rgb(70 55 30/.42)' });

    if(!g.phone){
      const tb = mk(dev,'',{ height:PX(g.chrome), background:'rgb(var(--bg-overlay))',
        borderBottom:'1px solid rgb(var(--border-subtle))', display:'flex', alignItems:'center',
        gap:'9px', padding:'0 16px' });
      ['#ef6a5e','#f5bd4f','#61c454'].forEach(c=>mk(tb,'dot',{width:'11px',height:'11px',background:c}));
      const pill = mk(tb,'',{ flex:'1', height:PX(g.chrome-20), marginLeft:'8px', borderRadius:'999px',
        background:'rgb(var(--bg-elevated))', border:'1px solid rgb(var(--border-subtle))',
        display:'flex', alignItems:'center', padding:'0 14px' });
      mk(pill,'mono',{ fontSize:'15px', color:'rgb(var(--fg-muted))' }, spec.url || 'skitza.app');
    }

    // the capture(s) — a second shot is the genuine after-state, cross-dissolved
    const view = mk(dev,'',{ position:'absolute', left:'0', top:PX(g.chrome),
      width:PX(g.w), height:PX(contentH), overflow:'hidden' });
    const layers = (shots||[]).map((name,i)=>{
      const im = document.createElement('img');
      im.src = `${dir}/${name}.png`;
      Object.assign(im.style,{ position:'absolute', left:'0', top:'0', width:'100%', height:'100%',
        objectFit:'cover', objectPosition:'top center', opacity: i===0?'1':'0', willChange:'opacity,transform' });
      view.appendChild(im); return im;
    });

    // click target, in content coordinates
    const tgt = click ? { x: click.nx * g.w, y: click.ny * contentH } : null;
    const focus = focusSpec ? { x: focusSpec.nx*g.w, y: focusSpec.ny*contentH }
                             : (tgt || { x:g.w/2, y:contentH*0.42 });
    layers.forEach(im => { im.style.transformOrigin = `${PX(focus.x)} ${PX(focus.y)}`; });

    const rip = tgt ? mk(root,'ripple',{opacity:'0'}) : null;
    // stage coords of the target (fixed under scaling, since we scale about it)
    const sx = g.x + (g.phone? (g.w - g.w)/2 : 0) + focus.x, sy = g.y + g.chrome + focus.y;
    const tx = g.x + (tgt? tgt.x : 0), ty = g.y + g.chrome + (tgt? tgt.y : 0);

    const path = tgt ? [
      { t: Math.max(0, (click.at||2.0) - 1.55), x: tx - g.w*0.26, y: ty + contentH*0.20 },
      { t: (click.at||2.0) - 0.18,              x: tx,            y: ty },
      { t: 99,                                        x: tx,            y: ty },
    ] : null;

    const z0 = 1.0, z1 = spec.zoom != null ? spec.zoom : 1.055;

    return (lt, dur) => {
      if(g.split){
        // caption sits beside the phone, so nothing covers the control being tapped
        window.__capOverride = { left: 812, width: 940, top: 402 };
        scrim.style.opacity = 0;
      } else {
        scrim.style.opacity = (mode === 'tall') ? 0 : 1;
      }
      const k = clamp(lt/dur);
      const s = lerp(z0, z1, E.io(k));           // slow push-in across the whole beat
      layers.forEach(im => { im.style.transform = `scale(${s.toFixed(4)})`; });

      if(layers[1]){
        const d = P(lt, spec.dissolve != null ? spec.dissolve : 2.0, 0.42, E.io);
        layers[1].style.opacity = d;
      }

      if(tgt){
        const at = click.at || 2.0;
        const p = cursorPath(path, lt);
        const show = clamp(P(lt, Math.max(0,at-1.62), .3, E.out)) * (1 - clamp((lt-(at+1.25))/.4));
        setCursor(p.x, p.y, show, lerp(1,.92,C.pulse(lt, at-0.04, .22, .06, .14)));
        rip.style.left = PX(tx); rip.style.top = PX(ty);
        ripple(rip, lt, at, g.phone?150:180);
      }
    };
  };
}

window.SCENE_BUILDERS = {

/* ------------------------------- COLD OPEN ------------------------------- */
open(root, C){
  const { W, H, mode, E, clamp, lerp, P, px } = C;
  const wide = mode==='wide';
  ensureScrim();
  root.classList.add('dark');
  const wrap = mk(root,'',{ position:'absolute', inset:'0', display:'grid',
    placeContent:'center', justifyItems:'center', gap: wide?'26px':'34px' });

  const wave = mk(wrap,'',{ position:'absolute', left:'50%', top:'50%',
    transform:'translate(-50%,-50%)', display:'flex', alignItems:'center',
    gap: wide?'7px':'8px', opacity:'.16' });
  const bars=[], NB=wide?76:52, r=rng(4242);
  for(let i=0;i<NB;i++){
    const b=mk(wave,'',{ width:wide?'5px':'6px', borderRadius:'999px', background:'rgb(var(--brand-primary))' });
    bars.push({el:b, h:0.12+Math.pow(r(),1.7)*0.88, ph:r()*6.28});
  }
  const mark = mk(wrap,'disp',{ fontSize:px(wide?168:150), color:'rgb(var(--brand-primary))',
    lineHeight:'1', display:'flex', position:'relative' });
  const letters='SKITZA'.split('').map(ch=>mk(mark,'',{display:'inline-block'},ch));
  const sub = mk(wrap,'',{ fontSize:px(wide?34:38), fontWeight:'400', letterSpacing:'.34em',
    textTransform:'uppercase', color:'rgb(178 170 158)', position:'relative', paddingLeft:'.34em' },
    'for solo producers');

  return (lt) => {
    document.getElementById('scrim').style.opacity = 0;
    letters.forEach((el,i)=>{
      const u=P(lt, 0.10+i*0.070, 0.70, E.spring);
      el.style.opacity=clamp(u*1.25);
      el.style.transform=`translateY(${px(lerp(58,0,u))}) scale(${lerp(.9,1,u)})`;
    });
    const su=P(lt,0.80,0.66,E.out);
    sub.style.opacity=su*(1-clamp((lt-2.40)/.40));
    sub.style.letterSpacing=px(lerp(22,11,su));
    const wu=P(lt,0.05,1.05,E.out);
    bars.forEach(b=>{ b.el.style.height=px(b.h*(0.62+0.38*Math.sin(lt*3.1+b.ph))*(mode==='wide'?150:130)*wu); });
    wave.style.opacity=0.16*wu*(1-clamp((lt-2.45)/.35));
  };
},

/* ----------------------------- PRODUCT BEATS ----------------------------- */
store: productBeat({ form:'desktop', shots:['artist-store'],
  url:'skitza.app/join/northline-studio',
  click:{ nx:0.3303, ny:0.4610, at:2.15 },
  clickTall:{ nx:0.2340, ny:0.5720, at:2.15 }, zoom:1.06 }),

purchase: productBeat({ form:'desktop', shots:['clients-projects'],
  url:'skitza.app/dashboard/clients-projects',
  focus:{ nx:0.30, ny:0.30 }, zoom:1.075 }),

agreement: productBeat({ form:'phone', shots:['s4'],
  click:{ nx:0.500, ny:0.940, at:2.10 },
  clickTall:{ nx:0.500, ny:0.940, at:2.10 }, zoom:1.05 }),

proofsend: productBeat({ form:'phone', shots:['sk75-proof-flow'],
  focus:{ nx:0.50, ny:0.62 }, zoom:1.07 }),

proofverify: productBeat({ form:'desktop', shots:['gate2-review'],
  url:'skitza.app/dashboard/payments',
  click:{ nx:0.7106, ny:0.4450, at:2.30 },
  shotsTall:['gate2-review-scrolled'],
  clickTall:{ nx:0.5000, ny:0.5152, at:2.30 }, zoom:1.07 }),

work: productBeat({ form:'desktop', shots:['project-space'],
  url:'skitza.app/dashboard/music',
  focus:{ nx:0.42, ny:0.46 }, zoom:1.065 }),

approval: productBeat({ form:'desktop', shots:['sk94-artist-ready','sk94-artist-approved'],
  url:'skitza.app/artist/music', dissolve:2.18,
  click:{ nx:0.4090, ny:0.2450, at:2.05 },
  clickTall:{ nx:0.6930, ny:0.2750, at:2.05 }, zoom:1.06 }),

delivery: productBeat({ form:'desktop', shots:['s9-partial','s9-paid'],
  url:'skitza.app/artist/payments', dissolve:1.85,
  focus:{ nx:0.44, ny:0.30 }, zoom:1.07 }),

/* -------------------------------- CLOSE -------------------------------- */
close(root, C){
  const { mode, E, clamp, lerp, P, px } = C;
  const wide = mode==='wide';
  ensureScrim();
  root.classList.add('dark');
  const wrap = mk(root,'',{ position:'absolute', inset:'0', display:'grid',
    placeContent:'center', justifyItems:'center', gap:px(wide?30:38) });
  const mark = mk(wrap,'disp',{ fontSize:px(wide?120:112), color:'rgb(var(--brand-primary))', lineHeight:'1' }, 'Skitza');
  const line = mk(wrap,'disp',{ fontSize:px(wide?54:50), color:'rgb(var(--fg-inverse))',
    display:'flex', gap:'.36em', letterSpacing:'-.02em', flexWrap:'wrap', justifyContent:'center' });
  const words = ['One link.','Every step.','One place.'].map(w=>mk(line,'',{},w));
  const rule = mk(wrap,'',{ height:'2px', width:'0px', background:'rgb(var(--brand-primary))' });
  const cta = mk(wrap,'mono',{ fontSize:px(wide?30:34), color:'rgb(178 170 158)', letterSpacing:'.18em' }, 'skitza.app');

  return (lt) => {
    document.getElementById('scrim').style.opacity = 0;
    const mu=P(lt,.10,.8,E.spring);
    mark.style.opacity=clamp(mu*1.3);
    mark.style.transform=`translateY(${px(lerp(34,0,mu))}) scale(${lerp(.94,1,mu)})`;
    words.forEach((w,i)=>{ const u=P(lt,.78+i*.30,.7,E.spring);
      w.style.opacity=clamp(u*1.3); w.style.transform=`translateY(${px(lerp(26,0,u))})`; });
    rule.style.width=px(lerp(0, wide?260:220, P(lt,1.95,.8,E.out)));
    const cu=P(lt,2.25,.7,E.out);
    cta.style.opacity=cu*.95; cta.style.letterSpacing=px(lerp(26,5.4,cu));
  };
},

};
