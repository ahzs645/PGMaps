const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{ const [,,url,prefix,wait='180000']=process.argv;
 const b=await chromium.launch({args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist']}); const p=await b.newPage({viewport:{width:1200,height:1000}});
 p.on('console',m=>{ if(['error','warning'].includes(m.type())) console.log('[console]',m.text().slice(0,300))}); p.on('pageerror',e=>console.log('[pageerror]',(e.stack||String(e)).slice(0,700)));
 await p.goto(url); await p.waitForFunction(()=>window.__results&&window.__results.done,null,{timeout:+wait,polling:1000}).catch(e=>console.log('timeout'));
 const r=await p.evaluate(()=>window.__results); const shots=await p.evaluate(()=>window.__shots||{});
 for (const [k,v] of Object.entries(shots)) fs.writeFileSync(`${prefix}-${k}.png`, Buffer.from(v.split(',')[1],'base64'));
 await p.screenshot({path:prefix+'-page.png'}); console.log(JSON.stringify(r,null,1)); await b.close(); })();
