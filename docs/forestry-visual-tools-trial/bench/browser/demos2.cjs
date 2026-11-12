const { chromium } = require('playwright');
const demos = [
 ['openworldgen','https://true2456.github.io/OpenWorldGen-SDK/',45000],
 ['inkwell','https://siliconjungle.github.io/inkwell-webgpu-trees/',40000],
 ['vegetation','https://yomotsu.github.io/vegetation/',40000],
 ['worldgen-scatter','https://askalice.github.io/threejs-worldgen/demo/scatter.html',45000],
 ['worldgen-water','https://askalice.github.io/threejs-worldgen/demo/water.html',45000],
 ['nanite','https://victorzakharov.github.io/threejs-nanites/',60000],
 ['bvl','https://samg-coder.github.io/BakedVoxelLighting/',60000],
 ['vista','https://0xe25f.github.io/vistawasm/demo/',60000],
 ['sylva','https://token-gremlin.github.io/realistic-forest/',45000],
 ['assetscatter','https://barthpaleologue.github.io/AssetScattering/',40000],
 ['bevy-aqua','https://sayhisam1.github.io/bevy-aqua/',40000],
];
const OLD = [
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
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-unsafe-webgpu'] });
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
    const text = (await p.evaluate(()=>document.body.innerText).catch(()=>'' )).replace(/\s+/g,' ').slice(0,500);
    try { const c = await p.context().newCDPSession(p); const r = await Promise.race([c.send('Page.captureScreenshot',{format:'png'}), new Promise((_,j)=>setTimeout(()=>j(new Error('shot timeout')),20000))]); require('fs').writeFileSync(`shots2/${name}.png`, Buffer.from(r.data,'base64')); } catch(e) { errs.push('SHOT '+e.message); }
    console.log(JSON.stringify({name, loadMs:tl, fps:+fps.toFixed?.(1), canvases, reqs, MB:+(bytes/1e6).toFixed(1), errs:[...new Set(errs)].slice(0,6), text}));
    await p.close().catch(()=>{});
  }
  await b.close();
})();
