import fs from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2),
  value = (name) => args[args.indexOf(name) + 1]
if (!args.includes('--audit') || !args.includes('--output'))
  throw new Error('Usage: node scripts/build-network-comparison.mjs --audit DIR --output DIR')
const audit = path.resolve(value('--audit')),
  output = path.resolve(value('--output'))
const read = async (file) => JSON.parse(await fs.readFile(path.join(audit, file), 'utf8'))
const pixels = await read('pixel-comparison.json'),
  renders = await read('rendered/rendered-comparison.json')
const archives = await read('archive-comparison.json'),
  vectors = await read('native-vector-comparison.json')
const native = await read('native-rendered/native-browser-comparison.json')
if (pixels.files !== pixels.expectedFiles || pixels.changedFiles || pixels.sourceFileMismatches || pixels.decodeErrors)
  throw new Error('Pixel audit failed or incomplete')
if (
  renders.cases !== pixels.levels.length ||
  renders.browserErrors.length ||
  renders.results.some((r) => !r.cameraUnchanged || !r.grid.allRGBA || r.maxChannelDifference > 1)
)
  throw new Error('Rendered comparison failed or incomplete')
if (
  archives.mismatches.length ||
  archives.jsonErrors.length ||
  archives.backups.some((r) => r.tileMismatches.length) ||
  vectors.failures.length ||
  [...vectors.telus, ...vectors.crtc].some((r) => r.badCoordinates)
)
  throw new Error('Archive/vector validation failed')
if (
  native.crtc.length !== vectors.crtc.length ||
  native.telus.length !== vectors.telus.length ||
  native.errors.length ||
  native.crtc.some((r) => !r.sourceMatchesArchive || !r.gridMatchesArchive) ||
  native.telus.some((r) => !r.unchanged)
)
  throw new Error('Native browser comparison failed or incomplete')

const levels = pixels.levels.map((row) => {
  const rendered = renders.results.find(
    (r) => r.provider === row.provider && r.layer === row.layer && r.zoom === row.zoom,
  )
  if (!rendered) throw new Error('Missing rendered case')
  return {
    ...row,
    label: rendered.label,
    visualTile: `${rendered.zoom}/${rendered.x}/${rendered.y}`,
    screenshotPixels: rendered.screenshotPixels,
    changedScreenshotPixels: rendered.changedPixels,
    maxScreenshotChannelDifference: rendered.maxChannelDifference,
  }
})
const report = {
  date: '2026-10-06',
  scope: 'All files in the five saved Network archives in the shared Drive folder; no live-provider refresh.',
  rasters: {
    files: pixels.files,
    pixels: pixels.pixels,
    bands: new Set(levels.map((r) => r.provider + '/' + r.layer)).size,
    bandLevels: levels.length,
    changedFiles: pixels.changedFiles,
    changedSourceFiles: pixels.sourceFileMismatches,
    decodeErrors: pixels.decodeErrors,
    maxCoordinateErrorMetres: Math.max(...levels.map((r) => r.maxCoordinateErrorMetres)),
    levels,
  },
  rendered: {
    cases: renders.cases,
    exactCases: renders.results.filter((r) => !r.changedPixels).length,
    roundedCases: renders.results.filter((r) => r.changedPixels).length,
    changedPixels: renders.results.reduce((n, r) => n + r.changedPixels, 0),
    screenshotPixels: renders.results.reduce((n, r) => n + r.screenshotPixels, 0),
    maxChannelDifference: Math.max(...renders.results.map((r) => r.maxChannelDifference)),
    browserErrors: renders.browserErrors,
  },
  native: { telus: vectors.telus, crtc: vectors.crtc, browser: native },
  otherArchiveFiles: {
    files: archives.files,
    mismatches: archives.mismatches,
    jsonErrors: archives.jsonErrors,
    backupTiles: archives.backups.reduce((n, r) => n + r.mvtTiles, 0),
    backupTileMismatches: archives.backups.flatMap((r) => r.tileMismatches),
  },
  references:
    'Videotron LTE and Freedom nationwide/extended LTE are links only, with no saved imagery. TELUS tar backups duplicate the same 352 vector tiles. Seven legacy Bell polygon files are validated source/debug artifacts and omit levels 9–10.',
}
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'network-comparison.json'), JSON.stringify(report, null, 2) + '\n')
const columns = [
  'provider',
  'layer',
  'label',
  'zoom',
  'files',
  'pixels',
  'changedFiles',
  'decodeErrors',
  'visualTile',
  'changedScreenshotPixels',
  'maxScreenshotChannelDifference',
]
await fs.writeFile(
  path.join(output, 'network-comparison.csv'),
  columns.join(',') + '\n' + levels.map((r) => columns.map((k) => JSON.stringify(r[k])).join(',')).join('\n') + '\n',
)
const cases = await Promise.all(
  renders.results.map(async (r) => ({
    ...r,
    audit: levels.find((l) => l.provider === r.provider && l.layer === r.layer && l.zoom === r.zoom),
    images: await Promise.all(
      [r.sourceImage, r.gridImage, r.differenceImage].map(
        async (file) =>
          'data:image/png;base64,' + (await fs.readFile(path.join(audit, 'rendered', file))).toString('base64'),
      ),
    ),
  })),
)
const safeJson = (o) => JSON.stringify(o).replaceAll('<', '\\u003c')
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Network source and grid comparison · all saved bands and levels</title>
<style>
[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#142c3c;font:15px/1.5 system-ui,sans-serif}main{max-width:1220px;margin:auto;padding:32px 24px}h1{font-size:30px;margin:0 0 8px}h2{font-size:21px;margin:0 0 8px}p{margin:0 0 16px;color:#445e6f}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.stat,section{background:white;border:1px solid #d8e0e7;border-radius:12px;padding:18px}.stat strong{display:block;font-size:25px}.stat span{font-size:13px;color:#445e6f}section{margin:20px 0}.controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:14px 0}label{font-weight:600;font-size:13px;display:grid;gap:5px}select,button{font:inherit;padding:8px;border:1px solid #b8c6d1;border-radius:6px;background:#fff;color:#142c3c}button{cursor:pointer}button:hover,button:focus-visible{outline:2px solid #2974a2}button[aria-pressed=true]{background:#173f5b;color:#fff}.views{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}figcaption{font-weight:600;margin-bottom:8px}.views img,.wipe img{display:block;width:100%;image-rendering:pixelated}.wipe{position:relative;max-width:680px;margin:auto}.wipe #wipeGrid{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}.wipe label{margin:12px 0}.wipe input{width:100%}.diff{display:block;width:min(100%,512px);margin:auto;image-rendering:pixelated}#detail{margin:12px 0 0;font-size:13px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:7px 8px;border-bottom:1px solid #e4eaf0;text-align:left;white-space:nowrap}td button{width:100%;padding:5px;font-size:12px;background:#e7f5ef;border-color:#9fcbb6}td button.round{background:#fff2d5;border-color:#d9b970}.legend{font-size:13px}.missing{color:#9ba9b2}.badge{display:inline-block;border-radius:4px;padding:2px 7px;background:#e7f5ef;color:#21583d}.native{display:grid;grid-template-columns:1fr 1fr;gap:16px}.native ul{padding-left:20px;margin:8px 0}.muted{font-size:13px}footer{color:#526777;font-size:13px;margin:20px 0}@media(max-width:700px){main{padding:18px 12px}.stats{grid-template-columns:1fr 1fr}.views,.native{grid-template-columns:1fr}h1{font-size:24px}}
</style><main>
<h1>Original coverage → reusable pixel boxes</h1>
<p>Every saved raster band and level · shared Drive Network archives · 6 October 2026</p>
<div class="stats"><div class="stat"><strong>169,687</strong><span>PNG files checked against original archives</span></div><div class="stat"><strong>11.12 billion</strong><span>source pixels preserved exactly</span></div><div class="stat"><strong>16 bands / 121 levels</strong><span>all saved Bell and Rogers combinations</span></div><div class="stat"><strong>0 changes</strong><span>original colour and alpha values</span></div></div>
<section><h2>Compare a source image with its box grid</h2><p>Same camera, source level, opacity and background. One box per original pixel; no outlines. Classification changes only the hover label.</p>
<div class="controls"><label>Band<select id="band"></select></label><label>Saved level<select id="level"></select></label><button id="side" aria-pressed="true">Side by side</button><button id="slider" aria-pressed="false">Swipe</button><button id="difference" aria-pressed="false">Difference</button></div>
<div id="sideView" class="views"><figure><figcaption>Original source image</figcaption><img id="source" alt="Original rendered coverage tile"></figure><figure><figcaption>Original-pixel box grid</figcaption><img id="grid" alt="Converted coverage, one box per pixel"></figure></div>
<div id="wipeView" class="wipe" hidden><img id="wipeSource" alt="Original source image"><img id="wipeGrid" alt="Box grid revealed by slider"><label>Reveal box grid<input id="reveal" type="range" min="0" max="100" value="50"></label></div>
<div id="diffView" hidden><p class="muted">Red marks every screenshot pixel with any channel difference. Pale background means exact rendered agreement. Differences here are at most 1/255; stored source RGBA remains exact.</p><img id="diff" class="diff" alt="Screenshot differences marked red"></div><p id="detail"></p></section>
<section><h2>Every saved band and level</h2><p class="legend">Each cell opens a rendered comparison. Green: exact screenshots. Amber: at most 1/255 rounding. All 169,687 files were numerically checked; each visual comparison shows one selected tile from that band/level. A dash means that level was not saved.</p><div class="table-wrap"><table id="matrix"></table></div></section>
<section><h2>Native vector sources</h2><p>TELUS and CRTC retain their original vector geometry. Switching raster comparison modes leaves their data unchanged.</p><div class="native"><div><h3>TELUS</h3><p>352 saved MVT tiles · 6 bands · 37 band/level combinations · 729,655 features. Every tile matches its original archive; all geometries parse successfully.</p><ul id="telus"></ul></div><div><h3>CRTC</h3><p>15 GeoJSON layers · 169,100 features. Every file matches the archive; every layer was loaded in both comparison modes. Large road layers use worker tiling with simplification disabled.</p><ul id="crtc"></ul></div></div><p class="muted">Also checked: all 415 remaining archive files, JSON metadata, TELUS backup duplicates and seven legacy Bell polygon artifacts. Videotron and Freedom are source links only; their imagery is absent from these archives.</p></section>
<footer>Preserves the saved source quality, including transparency, small gaps and unknown colours. The saved levels end at Bell/Rogers 10; TELUS 5, with a partial LTE level 6. Missing tiles remain missing. Optional 4×4 and 8×8 boxes are simplified views and are outside this lossless comparison. No live-provider refresh or deployment is included.</footer></main>
<script>
const cases=${safeJson(cases)}, report=${safeJson(report)};
const $=id=>document.getElementById(id), bands=[...new Map(cases.map(c=>[c.provider+'/'+c.layer,c.label])).entries()];
for(const [value,label] of bands)$('band').add(new Option(label,value));
function updateLevels(){const old=$('level').value;$('level').replaceChildren();for(const c of cases.filter(c=>c.provider+'/'+c.layer===$('band').value))$('level').add(new Option('Level '+c.zoom,c.zoom));if([...$('level').options].some(o=>o.value===old))$('level').value=old;else $('level').value=$('level').options[$('level').options.length-1].value;render()}
function render(){const c=cases.find(c=>c.provider+'/'+c.layer===$('band').value&&c.zoom===Number($('level').value));$('source').src=$('wipeSource').src=c.images[0];$('grid').src=$('wipeGrid').src=c.images[1];$('diff').src=c.images[2];$('detail').textContent=c.label+' · source tile '+c.zoom+'/'+c.x+'/'+c.y+' · '+c.audit.files.toLocaleString()+' files / '+c.audit.pixels.toLocaleString()+' original pixels checked at this level, zero source changes. Rendered screenshot: '+c.changedPixels+' / '+c.screenshotPixels.toLocaleString()+' pixels differ; maximum channel difference '+c.maxChannelDifference+'/255.';for(const b of document.querySelectorAll('#matrix button'))b.setAttribute('aria-pressed',String(b.dataset.band===$('band').value&&Number(b.dataset.level)===c.zoom))}
$('band').onchange=updateLevels;$('level').onchange=render;
for(const [button,view] of [['side','sideView'],['slider','wipeView'],['difference','diffView']])$(button).onclick=()=>{for(const [b,v] of [['side','sideView'],['slider','wipeView'],['difference','diffView']]){$(b).setAttribute('aria-pressed',String(b===button));$(v).hidden=v!==view}};
$('reveal').oninput=()=>{$('wipeGrid').style.clipPath='inset(0 '+(100-Number($('reveal').value))+'% 0 0)'};
const header=document.createElement('tr');for(const title of ['Band',...Array.from({length:8},(_,i)=>'z'+(i+3))]){const th=document.createElement('th');th.textContent=title;header.append(th)}$('matrix').append(header);
for(const [band,label] of bands){const tr=document.createElement('tr'),name=document.createElement('th');name.textContent=label;tr.append(name);for(let z=3;z<=10;z++){const td=document.createElement('td'),c=cases.find(c=>c.provider+'/'+c.layer===band&&c.zoom===z);if(c){const b=document.createElement('button');b.textContent=c.changedPixels?'1/255':'Exact';b.className=c.changedPixels?'round':'';b.dataset.band=band;b.dataset.level=z;b.title=label+', level '+z+', '+c.audit.files.toLocaleString()+' files checked';b.onclick=()=>{$('band').value=band;updateLevels();$('level').value=z;render()};td.append(b)}else{td.textContent='—';td.className='missing'}tr.append(td)}$('matrix').append(tr)}
const telusGroups=new Map();for(const r of report.native.telus){const group=telusGroups.get(r.layer)||[];group.push(r.zoom);telusGroups.set(r.layer,group)}for(const [band,zooms] of telusGroups){const li=document.createElement('li');li.textContent=band.replace('telus-','').toUpperCase()+' · levels '+zooms.join(', ');$('telus').append(li)}for(const r of report.native.crtc){const li=document.createElement('li');li.textContent=r.file.replace('.geojson.gz','')+' · '+r.features.toLocaleString()+' features';$('crtc').append(li)}
$('band').value='rogers/4g5g-only';updateLevels();$('level').value='10';render();
</script></html>`
await fs.writeFile(path.join(output, 'source-vs-grid.html'), html)
console.log(
  JSON.stringify({
    output,
    bands: report.rasters.bands,
    levels: levels.length,
    files: pixels.files,
    exactRendered: report.rendered.exactCases,
    roundedRendered: report.rendered.roundedCases,
  }),
)
