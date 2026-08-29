import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FFMPEG = execSync('python3 -c "import imageio_ffmpeg,sys; sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())"').toString().trim();
const arg=(k,d)=>{const a=process.argv.find(s=>s.startsWith(`--${k}=`));return a?a.split('=')[1]:d;};

const MODE   = arg('mode','wide');
const HTML   = arg('html','teaser-real.html');
const TLF    = arg('timeline','timeline-real.json');
const MB     = Math.max(1, parseInt(arg('mblur','1'),10));   // temporal supersampling factor
const STILLS = process.argv.includes('--stills');
const OUT    = arg('out', path.join(DIR, `skitza-real-${MODE}.mp4`));
const TL     = JSON.parse(readFileSync(path.join(DIR,TLF),'utf8'));
const FPS    = TL.fps;

const W = MODE==='wide'?1920:1080, H = MODE==='wide'?1080:1920;
const browser = await chromium.launch({ executablePath:CHROME,
  args:['--no-sandbox','--disable-lcd-text','--force-color-profile=srgb',
        '--font-render-hinting=none','--hide-scrollbars'] });
const page = await browser.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:1 });

const errs=[];
page.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });

await page.goto('file://'+path.join(DIR,HTML), { waitUntil:'load' });
await page.evaluate(()=>document.fonts.ready);
const meta = await page.evaluate(({tl,mode})=>{ window.__TIMELINE=tl; return window.__build(mode); }, {tl:TL, mode:MODE});
// captures are large PNGs — make sure every one is decoded before the first frame
const imgs = await page.evaluate(async ()=>{
  const list=[...document.images];
  await Promise.all(list.map(i=>i.decode().catch(()=>{})));
  return { total:list.length, broken:list.filter(i=>!i.complete||i.naturalWidth===0).length };
});
console.log(`mode=${MODE} ${W}x${H} total=${meta.total}s images=${imgs.total} broken=${imgs.broken} mblur=${MB}x`);
if(imgs.broken) console.error(`  !! ${imgs.broken} capture(s) failed to load`);
if(errs.length){ console.error(errs.slice(0,6).join('\n')); await browser.close(); process.exit(1); }

if(STILLS){
  const dir=path.join(DIR,`stills-real-${MODE}`); mkdirSync(dir,{recursive:true});
  let i=0;
  for(const b of TL.beats){
    await page.evaluate(t=>window.__render(t), b.start + b.dur*0.74);
    await page.screenshot({ path:path.join(dir,`${String(i).padStart(2,'0')}-${b.id}.png`) });
    i++;
  }
  console.log('stills ->', dir);
  await browser.close(); process.exit(0);
}

const NF = Math.round(meta.total*FPS)*MB;      // sub-frames
const vf = MB>1 ? `tmix=frames=${MB}:weights='${Array(MB).fill(1).join(' ')}',framestep=${MB}` : null;
const args = ['-y','-f','image2pipe','-r',String(FPS*MB),'-i','-'];
if(vf) args.push('-vf', vf);
args.push('-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p',
          '-movflags','+faststart','-r',String(FPS), OUT);
const ff = spawn(FFMPEG, args, { stdio:['pipe','ignore','pipe'] });
let fe=''; ff.stderr.on('data',d=>fe+=d);

const t0=Date.now();
for(let f=0; f<NF; f++){
  await page.evaluate(t=>window.__render(t), f/(FPS*MB));
  const buf = await page.screenshot({ type:'jpeg', quality:95 });
  if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
  if(f % (120*MB) === 0) process.stdout.write(`  ${f}/${NF} (${((Date.now()-t0)/1000).toFixed(0)}s)\n`);
}
ff.stdin.end();
await new Promise((res,rej)=>ff.on('close',c=>c===0?res():rej(new Error('ffmpeg '+c+'\n'+fe.slice(-1200)))));
await browser.close();
if(errs.length) console.error('page errors:\n'+errs.slice(0,5).join('\n'));
console.log('wrote', OUT);
