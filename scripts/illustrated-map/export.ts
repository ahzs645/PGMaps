/** Export the same drawings used by /dev/illustrated-map, including an offline HTML review. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  buildElementSheetSvg,
  buildElementSvg,
  buildHatchSwatchSvg,
  buildIllustratedMapSvg,
  DEFAULT_HATCH_OPTIONS,
  ELEMENT_CATALOG,
} from '../../src/lib/illustratedMap/index'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(process.argv[2] ?? join(root, 'tmp/illustrated-map-export'))
await mkdir(output, { recursive: true })

const outputs = [
  ['map.svg', buildIllustratedMapSvg()],
  ['overlay.svg', buildIllustratedMapSvg({ transparentBackground: true })],
  ['elements.svg', buildElementSheetSvg()],
  ['hatch.svg', buildHatchSwatchSvg()],
  ['terrain.svg', buildIllustratedMapSvg({ layers: { hatching: false, roads: false, symbols: false, labels: false } })],
  [
    'routes.svg',
    buildIllustratedMapSvg({
      transparentBackground: true,
      layers: { hatching: false, roads: true, symbols: false, labels: false },
    }),
  ],
  [
    'lettering.svg',
    buildIllustratedMapSvg({
      transparentBackground: true,
      layers: { hatching: false, roads: false, symbols: false, labels: true },
    }),
  ],
  [
    'scenery.svg',
    buildIllustratedMapSvg({
      transparentBackground: true,
      layers: { hatching: false, roads: false, symbols: true, labels: false },
    }),
  ],
  [
    'forest.svg',
    buildIllustratedMapSvg({
      transparentBackground: true,
      layers: { hatching: true, roads: false, symbols: false, labels: false },
    }),
  ],
] as const
await Promise.all(outputs.map(([name, svg]) => writeFile(join(output, name), svg)))
for (const element of ELEMENT_CATALOG) {
  const folder = join(output, 'elements', element.category)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, `${element.id}.svg`), buildElementSvg(element.id))
}
await writeFile(
  join(output, 'elements.json'),
  JSON.stringify(
    {
      generator: 'PGMaps illustrated map',
      sourcePage: 8,
      coordinates: 'schematic-artboard',
      hatch: DEFAULT_HATCH_OPTIONS,
      elements: ELEMENT_CATALOG.map(({ svg: _svg, ...element }) => element),
    },
    null,
    2,
  ) + '\n',
)

const bundled = await build({
  absWorkingDir: root,
  entryPoints: ['src/lib/illustratedMap/index.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'IllustratedMap',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
})
const engine = bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const reference = `data:image/jpeg;base64,${(await readFile(join(root, 'public/illustrated-map/page8-reference.jpg'))).toString('base64')}`
await writeFile(join(output, 'review.html'), reviewHtml(engine, reference))
await writeFile(
  join(output, 'README.md'),
  `# Rainforest to Rockies vector reconstruction\n\nOpen **review.html** in a browser. It works directly from disk, without a server or an internet connection. Its inline engine is the same source used by PGMaps at /dev/illustrated-map.\n\n- **map.svg**: full reconstructed schematic map.\n- **overlay.svg**: drawing ink without the land and ocean fills, for comparison.\n- **elements.svg**: contact sheet of ${ELEMENT_CATALOG.length} constructed elements.\n- **hatch.svg**: the procedural forest pattern at its default settings.\n- **terrain.svg**, **routes.svg**, **lettering.svg**, **scenery.svg**, and **forest.svg**: separate map components. All except terrain have transparent backgrounds.\n- **elements/**: every element as its own SVG, grouped by category.\n- **elements.json**: dimensions, construction notes, and reference placement boxes.\n\nThe map uses illustration coordinates rather than a geographic projection. The reference image embedded in review.html comes from page 8 of the supplied Destination BC guidelines. The reconstructed SVG files contain editable geometry; they do not embed that reference image. Lettering comes from the supplied Great Forest glyphs. The title is a reconstructed study rather than an official logo master.\n\n## Regenerate from the repository\n\nInstall the repository's dependencies, then run:\n\n\`\`\`sh\nnode --import tsx scripts/illustrated-map/export.ts /absolute/path/to/output\n\`\`\`\n\nOmit the output argument to write to tmp/illustrated-map-export. The exporter requires the repository's public/illustrated-map/page8-reference.jpg for the comparison page. It overwrites the named files and leaves other files in the output folder alone.\n`,
)
console.log(
  JSON.stringify({
    output,
    elements: ELEMENT_CATALOG.length,
    drawings: outputs.map(([name]) => name),
    review: 'review.html',
  }),
)

function reviewHtml(engineCode: string, referenceData: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rainforest to Rockies — vector workshop</title>
<style>
:root{color-scheme:light;--ink:#00392f;--paper:#f7f8f2;--line:#d7dfd8;--moss:#b0bd36;--muted:#5a6c63;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper)}
*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button,select{border:1px solid var(--line);border-radius:7px;background:white;color:var(--ink);padding:9px 12px}button{cursor:pointer}button:hover{background:#eef2e7}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #b0bd36;outline-offset:2px}.shell{max-width:1640px;margin:auto;padding:28px 24px 40px}header{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:20px}h1{font-size:32px;line-height:1.15;margin:6px 0 12px;letter-spacing:-.025em}.eyebrow{text-transform:uppercase;font-size:11px;letter-spacing:.18em;color:var(--muted);font-weight:700}p{font-size:14px;line-height:1.65;margin:0;color:var(--muted)}header p{max-width:880px}.primary{background:var(--ink);color:white;border-color:var(--ink);white-space:nowrap}.primary:hover{background:#15564a}.tabs{display:flex;gap:5px;padding:5px;border:1px solid var(--line);border-radius:9px;background:#eaf0e8;margin-bottom:20px;overflow:auto}.tabs button{border-color:transparent;background:transparent;white-space:nowrap}.tabs button[aria-selected=true]{background:white;border-color:var(--line);font-weight:650}.layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px;align-items:start}aside{display:grid;gap:16px}.card{border:1px solid var(--line);border-radius:10px;background:white;padding:17px}.card h2{font-size:16px;margin:0 0 10px}.card p{font-size:12px;margin-bottom:16px}.control{display:block;margin-top:16px;font-size:13px}.control .line{display:flex;justify-content:space-between;gap:12px}.control input[type=range]{display:block;width:100%;margin-top:8px;accent-color:var(--ink)}.control input[type=number]{width:100%;margin-top:7px;padding:8px;border:1px solid var(--line);border-radius:7px}.switch{display:flex;align-items:center;gap:9px;font-size:13px;margin:12px 0}.switch input{accent-color:var(--ink)}#reset{margin-top:16px;font-size:12px}.content{min-width:0}.view-tools{display:flex;align-items:center;gap:14px;margin-bottom:12px;flex-wrap:wrap}.view-tools select{max-width:100%}.view-tools label{font-size:13px}.drawing{border:1px solid var(--line);border-radius:10px;background:#edf1ed;overflow:auto;min-height:300px;height:min(72vh,860px);padding:12px;display:flex;align-items:center;justify-content:center}.drawing>svg{width:100%;height:100%;display:block}.overlay{width:100%;height:100%;position:relative}.overlay img,.overlay>svg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.description{margin:12px 0 16px}.note{margin-top:14px;font-size:12px}#comparison-control{width:min(100%,430px);margin:0}#element-tools[hidden],#comparison-control[hidden]{display:none}.source{margin-top:20px;font-size:12px;border-top:1px solid var(--line);padding-top:16px}
@media(max-width:900px){.layout{grid-template-columns:1fr}.content{grid-row:1}aside{grid-template-columns:repeat(2,minmax(0,1fr))}header{align-items:flex-start;flex-direction:column;gap:15px}.drawing{height:58vh;min-height:300px}}
@media(max-width:520px){.shell{padding:22px 14px}h1{font-size:28px}aside{grid-template-columns:1fr}.drawing{height:350px;padding:7px}.tabs button{padding:8px 10px;font-size:13px}}
</style></head><body><div class="shell">
<header><div><div class="eyebrow">PGMaps · constructed vectors · page 8 study</div><h1>Rainforest to Rockies</h1><p>An editable map assembled from curves, shapes, lettering and a generated forest texture. Inspect each element and compare its placement with the supplied reference.</p></div><button class="primary" id="download">Download map SVG</button></header>
<nav class="tabs" role="tablist" aria-label="Drawing views"><button role="tab" id="tab-map" data-view="map" aria-controls="drawing-panel" aria-selected="true">Map</button><button role="tab" id="tab-elements" data-view="elements" aria-controls="drawing-panel" aria-selected="false" tabindex="-1">Elements</button><button role="tab" id="tab-hatching" data-view="hatching" aria-controls="drawing-panel" aria-selected="false" tabindex="-1">Hatching</button><button role="tab" id="tab-compare" data-view="compare" aria-controls="drawing-panel" aria-selected="false" tabindex="-1">Compare page 8</button></nav>
<div class="layout"><aside><section class="card"><h2>Forest hatching</h2><p>Short curved strokes sit between flowing bands. The same settings and seed reproduce the same drawing.</p>
<label class="control"><span class="line">Stroke spacing <output id="out-spacing"></output></span><input id="spacing" type="range" min="1.5" max="12" step=".1" data-hatch="spacing"></label>
<label class="control"><span class="line">Band height <output id="out-bandHeight"></output></span><input id="bandHeight" type="range" min="8" max="40" step=".5" data-hatch="bandHeight"></label>
<label class="control"><span class="line">Stroke width <output id="out-strokeWidth"></output></span><input id="strokeWidth" type="range" min=".3" max="2.4" step=".05" data-hatch="strokeWidth"></label>
<label class="control"><span class="line">Band curvature <output id="out-curvature"></output></span><input id="curvature" type="range" min="0" max="24" step=".5" data-hatch="curvature"></label>
<label class="control">Pattern seed<input id="seed" type="number" min="0" max="999999" step="1" data-hatch="seed"></label><button id="reset">Reset hatching</button></section>
<section class="card"><h2>Map layers</h2><label class="switch"><input type="checkbox" data-layer="hatching" checked>Forest hatching</label><label class="switch"><input type="checkbox" data-layer="roads" checked>Highways and connections</label><label class="switch"><input type="checkbox" data-layer="symbols" checked>Illustrations and markers</label><label class="switch"><input type="checkbox" data-layer="labels" checked>Place names and title</label><p class="note">Layer choices apply to the map and its SVG download.</p></section></aside>
<main class="content" id="drawing-panel" role="tabpanel" aria-labelledby="tab-map"><div class="view-tools"><label id="element-tools" hidden>Inspect an element <select id="element"><option value="all">All elements — contact sheet</option></select></label><label class="control" id="comparison-control" hidden><span class="line">Reconstructed ink opacity <output id="opacity-output">50%</output></span><input id="opacity" type="range" min="0" max="100" value="50"></label></div><p class="description" id="description"></p><div class="drawing" id="stage" aria-label="Reconstructed map preview"></div><p class="note" id="caption"></p></main></div>
<p class="source">Reference: Destination BC, <em>Rainforest to Rockies Industry Brand Guidelines</em>, page 8. This is schematic artwork in illustration coordinates, not a georeferenced map. The reconstructed title is a study, not an official logo master. The original raster appears only in the comparison; downloaded SVGs contain the constructed vectors.</p>
</div><script>${engineCode}</script><script>
const E=IllustratedMap,ref=${JSON.stringify(referenceData)},state={view:'map',element:'all',hatch:{...E.DEFAULT_HATCH_OPTIONS},layers:{hatching:true,roads:true,symbols:true,labels:true},opacity:50};
const $=id=>document.getElementById(id);let downloadSvg='',downloadName='map.svg',queued=false;
const descriptions={map:'The complete reconstructed illustration. Download the SVG to edit its named layers and individual shapes.',hatching:'A generated swatch using the same stroke field as the map. Adjust the controls to change its density and rhythm.',compare:'The source image with reconstructed ink overlaid. Reduce opacity to inspect the original; increase it to compare shape and placement.'};
const categories={illustration:'Landscape and activities',navigation:'Navigation and destinations',tree:'Trees',drafting:'Lines and drafting'};
for(const [key,title]of Object.entries(categories)){const group=document.createElement('optgroup');group.label=title;for(const e of E.ELEMENT_CATALOG.filter(x=>x.category===key)){const option=document.createElement('option');option.value=e.id;option.textContent=e.title;group.append(option)}$('element').append(group)}
document.querySelector('[data-view="elements"]').textContent='Elements ('+E.ELEMENT_CATALOG.length+')';
function syncControls(){for(const input of document.querySelectorAll('[data-hatch]'))input.value=state.hatch[input.dataset.hatch];for(const key of ['spacing','bandHeight','strokeWidth','curvature'])$('out-'+key).textContent=state.hatch[key]+(key==='curvature'?'':' px')}
function render(){queued=false;syncControls();$('element-tools').hidden=state.view!=='elements';$('comparison-control').hidden=state.view!=='compare';$('drawing-panel').setAttribute('aria-labelledby','tab-'+state.view);for(const tab of document.querySelectorAll('[data-view]')){const active=tab.dataset.view===state.view;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1}const options={hatch:state.hatch,layers:state.layers};let svg;
 if(state.view==='elements'){const element=E.ELEMENT_CATALOG.find(e=>e.id===state.element);svg=element?E.buildElementSvg(element.id):E.buildElementSheetSvg();downloadName=element?element.id+'.svg':'elements.svg';$('description').textContent=element?element.title+' — '+element.construction:'Every constructed element, arranged by category. Pick one to inspect its geometry and construction notes.';}
 else if(state.view==='hatching'){svg=E.buildHatchSwatchSvg(state.hatch);downloadName='hatch.svg';$('description').textContent=descriptions.hatching;}
 else{svg=E.buildIllustratedMapSvg(options);downloadName='map.svg';$('description').textContent=descriptions[state.view];}
 downloadSvg=svg;$('download').textContent='Download '+(state.view==='elements'?'element':state.view==='hatching'?'hatch':'map')+' SVG';
 if(state.view==='compare'){const overlay=document.createElement('div');overlay.className='overlay';const img=document.createElement('img');img.src=ref;img.alt='Original raster extracted from page 8';overlay.append(img);const drawing=document.createElement('div');drawing.innerHTML=E.buildIllustratedMapSvg({...options,transparentBackground:true});const ink=drawing.firstElementChild;ink.id='overlay-ink';ink.style.opacity=String(state.opacity/100);overlay.append(ink);$('stage').replaceChildren(overlay);$('caption').textContent='The original remains beneath the reconstructed ink. Downloads contain the full reconstructed map.';}
 else{$('stage').innerHTML=svg;$('caption').textContent='Editable SVG generated from the PGMaps drawing engine. No external files or internet connection are needed.';}
}
function schedule(){if(!queued){queued=true;requestAnimationFrame(render)}}
for(const tab of document.querySelectorAll('[data-view]'))tab.addEventListener('click',()=>{state.view=tab.dataset.view;render()});
document.querySelector('.tabs').addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-view]')],i=tabs.indexOf(document.activeElement);if(i<0)return;let j=i;if(event.key==='ArrowRight')j=(i+1)%tabs.length;else if(event.key==='ArrowLeft')j=(i+tabs.length-1)%tabs.length;else if(event.key==='Home')j=0;else if(event.key==='End')j=tabs.length-1;else return;event.preventDefault();tabs[j].click();tabs[j].focus()});
for(const input of document.querySelectorAll('[data-hatch]'))input.addEventListener('input',()=>{if(!input.value.trim())return;const value=Number(input.value);if(!Number.isFinite(value))return;state.hatch[input.dataset.hatch]=Math.max(Number(input.min),Math.min(Number(input.max),value));schedule()});
for(const input of document.querySelectorAll('[data-layer]'))input.addEventListener('change',()=>{state.layers[input.dataset.layer]=input.checked;render()});
$('element').addEventListener('change',event=>{state.element=event.target.value;render()});$('reset').addEventListener('click',()=>{state.hatch={...E.DEFAULT_HATCH_OPTIONS};render()});$('opacity').addEventListener('input',event=>{state.opacity=Number(event.target.value);$('opacity-output').textContent=state.opacity+'%';if($('overlay-ink'))$('overlay-ink').style.opacity=String(state.opacity/100)});
$('download').addEventListener('click',()=>{if(queued)render();const url=URL.createObjectURL(new Blob([downloadSvg],{type:'image/svg+xml;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=downloadName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)});render();
</script></body></html>`
}
