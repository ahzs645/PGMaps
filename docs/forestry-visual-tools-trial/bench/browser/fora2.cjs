const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=8192'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const log = [];
  p.on('pageerror', (e) => log.push('PE ' + String(e).slice(0, 200)));
  p.on('console', (m) => log.push(m.type() + ' ' + m.text().slice(0, 200)));
  p.on('dialog', (d) => { log.push('dialog ' + d.message().slice(0, 200)); d.accept(); });
  await p.goto('https://fora-platform.github.io/fora/');
  await p.waitForTimeout(2000);
  const t0 = Date.now();
  await (await p.$('input[type=file]')).setInputFiles(process.argv[2]);
  await p.waitForFunction(() => document.body.innerText.includes('Normalize'), null, { timeout: 180000 });
  console.log('loaded', (Date.now() - t0) / 1000);
  const listButtons = () => p.$$eval('button', (bs) => bs.map((x) => (x.innerText || x.title || '').trim()).filter(Boolean));
  console.log('buttons', JSON.stringify(await listButtons()).slice(0, 1500));
  const click = async (label) => {
    for (const x of await p.$$('button')) {
      const t = (await x.innerText()).trim();
      if (t === label) { await x.click(); return t; }
    }
    return null;
  };
  const t1 = Date.now();
  console.log('clicked', await click('Normalize'));
  await p.waitForTimeout(20000);
  await p.screenshot({ path: 'shots/fora-norm.png' });
  console.log('normalize ~', (Date.now() - t1) / 1000, (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400));
  console.log('clicked', await click('Seg'));
  await p.waitForTimeout(4000);
  await p.screenshot({ path: 'shots/fora-seg-panel.png' });
  console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 900));
  console.log('buttons2', JSON.stringify(await listButtons()).slice(0, 1500));
  const t2 = Date.now();
  console.log('clicked', await click('▶ Run'));
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(10000);
    const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const m = txt.match(/(\d[\d,.]*)\s*(trees|tree)/i);
    console.log(((Date.now() - t2) / 1000).toFixed(0) + 's', m ? m[0] : '', txt.slice(txt.indexOf('SEGMENTATION'), txt.indexOf('SEGMENTATION') + 500));
    await p.screenshot({ path: 'shots/fora-seg.png' });
    if (m) break;
  }
  const clickCsv = async () => { for (const x of await p.$$('button')) { if ((await x.innerText()).includes('CSV')) { await x.click(); break; } } };
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), clickCsv()]);
  await dl.saveAs('fora-trees.csv');
  console.log('csv saved', dl.suggestedFilename());
  await b.close();
})();
