const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
 for (const [name, url, wait] of [['worldgen-webgl','https://askalice.github.io/threejs-worldgen/demo/scatter.html?webgl',40000],['sylva-webgl','https://token-gremlin.github.io/realistic-forest/',90000]]) {
  const p = await b.newPage({ viewport: { width: 1200, height: 700 } }); await p.goto(url); await p.waitForTimeout(wait);
  const c = await p.context().newCDPSession(p);
  try { const r = await Promise.race([c.send('Page.captureScreenshot',{format:'png'}), new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),120000))]); fs.writeFileSync(`shots2/${name}.png`, Buffer.from(r.data,'base64')); console.log(name,'ok'); } catch (e) { console.log(name, e.message); }
  console.log((await p.evaluate(()=>document.body.innerText).catch(()=>'')).replace(/\s+/g,' ').slice(0,200)); await p.close().catch(()=>{}); }
 await b.close(); })();
