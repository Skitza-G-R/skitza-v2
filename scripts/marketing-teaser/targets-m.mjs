import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';
const WANT = {
  's4':                ['Accept exact agreement','Accept exact'],
  'sk75-proof-flow':   ['Send proof','Take a photo'],
  'artist-store':      ['View service'],
  'gate2-review':      ['Confirm'],
  'sk94-artist-ready': ['Approve this version'],
};
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--hide-scrollbars'] });
const out = {};
for (const [screen, texts] of Object.entries(WANT)){
  const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:1, isMobile:true, hasTouch:true });
  await p.goto(`http://localhost:3000/dev/screens/${screen}`, { waitUntil:'networkidle', timeout:180000 });
  await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(400);
  const hit = await p.evaluate((texts)=>{
    const els=[...document.querySelectorAll('button,a,[role="button"],label')];
    for(const w of texts){
      const el=els.find(e=>(e.textContent||'').trim().toLowerCase().includes(w.toLowerCase()));
      if(el){ const r=el.getBoundingClientRect();
        if(r.width>0&&r.height>0&&r.y>=0&&r.y<innerHeight)
          return {text:(el.textContent||'').trim().slice(0,34), nx:(r.x+r.width/2)/innerWidth, ny:(r.y+r.height/2)/innerHeight}; }
    }
    return null;
  }, texts);
  out[screen]=hit;
  console.log(hit?`  ok ${screen}: "${hit.text}" @ ${(hit.nx*100).toFixed(1)}%,${(hit.ny*100).toFixed(1)}%`:`  x  ${screen}: none in viewport`);
  await p.close();
}
await b.close();
writeFileSync('targets-mobile.json', JSON.stringify(out,null,2));
