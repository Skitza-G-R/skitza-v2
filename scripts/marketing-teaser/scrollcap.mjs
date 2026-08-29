import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const CLEAN=`*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}
nextjs-portal,[data-nextjs-dev-tools-button]{display:none!important}`;
const RECEIPT='data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="440"><rect width="760" height="440" fill="#F7F3EB"/><rect x="30" y="26" width="700" height="388" rx="20" fill="#fff" stroke="#E8E1D4" stroke-width="2"/><circle cx="380" cy="104" r="34" fill="#22C55E"/><path d="M366 104 l10 10 l19 -20" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><text x="380" y="172" font-family="sans-serif" font-size="27" font-weight="600" fill="#111009" text-anchor="middle">Transfer completed</text><text x="380" y="222" font-family="sans-serif" font-size="46" font-weight="800" fill="#111009" text-anchor="middle">&#8362;1,200.00</text><line x1="70" y1="258" x2="690" y2="258" stroke="#E8E1D4" stroke-width="2"/><text x="70" y="296" font-family="sans-serif" font-size="19" fill="#6B6359">To</text><text x="690" y="296" font-family="sans-serif" font-size="19" font-weight="600" fill="#111009" text-anchor="end">Northline Studio</text><text x="70" y="336" font-family="sans-serif" font-size="19" fill="#6B6359">Date</text><text x="690" y="336" font-family="sans-serif" font-size="19" font-weight="600" fill="#111009" text-anchor="end">11 Jul 2026, 16:30</text><text x="70" y="376" font-family="sans-serif" font-size="19" fill="#6B6359">Reference</text><text x="690" y="376" font-family="monospace" font-size="19" font-weight="600" fill="#111009" text-anchor="end">TRF-7F3QK2-01</text></svg>`).toString('base64');

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--hide-scrollbars','--force-color-profile=srgb','--font-render-hinting=none']});
const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
await p.goto('http://localhost:3000/dev/screens/gate2-review',{waitUntil:'networkidle',timeout:180000});
await p.addStyleTag({content:CLEAN});
await p.evaluate(()=>document.fonts.ready);
await p.evaluate((r)=>{ for(const el of [...document.body.children]){
    if(['MAIN','SECTION','SCRIPT','STYLE','AUDIO'].includes(el.tagName))continue;
    const cs=getComputedStyle(el),bb=el.getBoundingClientRect();
    if(cs.position==='fixed'&&bb.width<140&&bb.height<140) el.remove(); }
  for(const i of document.images){ if(!i.complete||i.naturalWidth===0){ i.src=r; i.srcset=''; i.style.width='100%'; i.style.height='auto'; i.style.borderRadius='10px'; } } }, RECEIPT);
// bring the Confirm control into view, then note where it lands
const info = await p.evaluate(()=>{
  const el=[...document.querySelectorAll('button,[role="button"]')].find(e=>(e.textContent||'').includes('Confirm'));
  if(!el) return null;
  el.scrollIntoView({block:'center'});
  return new Promise(res=>setTimeout(()=>{ const r=el.getBoundingClientRect();
    res({ nx:(r.x+r.width/2)/innerWidth, ny:(r.y+r.height/2)/innerHeight, y:Math.round(scrollY) }); },350));
});
await p.waitForTimeout(700);
await p.screenshot({path:'caps-mobile/gate2-review-scrolled.png'});
console.log('scrolled capture:', JSON.stringify(info));
const t=existsSync('targets-mobile.json')?JSON.parse(readFileSync('targets-mobile.json','utf8')):{};
t['gate2-review-scrolled']=info;
writeFileSync('targets-mobile.json',JSON.stringify(t,null,2));
await b.close();
