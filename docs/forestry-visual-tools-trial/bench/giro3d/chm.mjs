import { fromFile } from 'geotiff';
const r = {};
for (const f of ['dem','dsm']) { const t = await fromFile('public/data/'+f+'.tif'); const i = await t.getImage();
  r[f] = { img: i, data: (await i.readRasters())[0], nd: +i.getGDALNoData() };
  console.log(f, i.getWidth(), i.getHeight(), i.getBoundingBox().map(v=>v.toFixed(0)).join(','), JSON.stringify(i.getGeoKeys()), 'nodata', i.getGDALNoData()); }
const a = r.dem.data, b = r.dsm.data; const h = [];
let valid = 0, over2 = 0;
for (let k = 0; k < a.length; k++) { if (a[k] === r.dem.nd || b[k] === r.dsm.nd || a[k] < -1000 || b[k] < -1000) continue; const d = b[k]-a[k]; valid++; h.push(d); if (d > 2) over2++; }
h.sort((x,y)=>x-y); const q = p => h[Math.floor(p*(h.length-1))].toFixed(1);
const ground = []; for (const v of a) if (v > -1000 && v !== r.dem.nd) ground.push(v); ground.sort((x,y)=>x-y);
console.log(JSON.stringify({ validCells: valid, canopyCoverOver2m: +(over2/valid).toFixed(3), chmP50: q(.5), chmP75: q(.75), chmP90: q(.9), chmP99: q(.99), chmMax: h.at(-1).toFixed(1), groundMin: ground[0].toFixed(1), groundMax: ground.at(-1).toFixed(1) }));
