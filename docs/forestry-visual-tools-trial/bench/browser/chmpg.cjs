const { chromium } = require('playwright');
(async()=>{ const b=await chromium.launch({args:['--enable-unsafe-swiftshader']}); const p=await b.newPage({viewport:{width:1400,height:850}});
 const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,200))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
 await p.goto('http://localhost:5201/index.html'); await p.waitForTimeout(40000); await p.screenshot({path:'shots/chm-pg.png'}); console.log(errs); await b.close(); })();
