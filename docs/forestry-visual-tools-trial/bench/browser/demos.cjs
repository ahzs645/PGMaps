const { chromium } = require('playwright');
const demos = [
 ['eztree','https://www.eztree.dev/', 25000],
 ['landmarks','https://am2222.github.io/maplibre-landmarks/demo/', 30000],
 ['chm','https://openforest4d.github.io/chm-3d-visualizer/', 40000],
 ['piero','https://piero.giro3d.org/', 25000],
 ['giro3d-oriented','https://giro3d.org/examples/oriented-image-collection.html', 40000],
 ['fora','https://fora-platform.github.io/fora/', 20000],
 ['virtualforest','https://www.virtualforest.org/', 45000],
 ['arcgis-viewshed','https://developers.arcgis.com/javascript/latest/sample-code/analysis-viewshed/live/', 45000],
];
(async () => {
  const only = process.argv[2];
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  for (const [name,url,wait] of demos) {
    if (only && only!==name) continue;
    const p = await b.newPage({ viewport:{width:1400,height:850} });
    const errs=[]; let reqs=0, bytes=0;
    p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,200)); });
    p.on('pageerror', e => errs.push('PAGEERR '+String(e).slice(0,200)));
    p.on('response', async r => { reqs++; const l=+r.headers()['content-length']||0; bytes+=l; });
    const t0=Date.now();
    try { await p.goto(url,{waitUntil:'load',timeout:60000}); } catch(e){ errs.push('GOTO '+e.message.slice(0,100)); }
    const tl=Date.now()-t0;
    await p.waitForTimeout(wait);
    const fps = await p.evaluate(() => new Promise(res => { let n=0; const s=performance.now(); function f(){ n++; if(performance.now()-s<3000) requestAnimationFrame(f); else res(n/3);} requestAnimationFrame(f); })).catch(()=>-1);
    const canvases = await p.evaluate(() => [...document.querySelectorAll('canvas')].map(c=>c.width+'x'+c.height)).catch(()=>[]);
    const text = (await p.evaluate(()=>document.body.innerText).catch(()=>'' )).replace(/\s+/g,' ').slice(0,300);
    await p.screenshot({ path:`shots/${name}.png` });
    console.log(JSON.stringify({name, loadMs:tl, fps:+fps.toFixed?.(1), canvases, reqs, MB:+(bytes/1e6).toFixed(1), errs:[...new Set(errs)].slice(0,6), text}));
    await p.close();
  }
  await b.close();
})();
