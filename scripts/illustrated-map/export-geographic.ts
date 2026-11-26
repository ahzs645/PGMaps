/** Export the geographic illustration, its layers and an entirely offline workshop. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  buildElementSheetSvg,
  buildElementSvg,
  buildHatchSwatchSvg,
  buildIllustratedMapSvg,
  ELEMENT_CATALOG,
} from '../../src/lib/illustratedMap/index'
import {
  buildGeographicLandMaskSvg,
  buildGeographicMapSvg,
  GEOGRAPHIC_MAP_RECORD,
} from '../../src/lib/illustratedMap/geographic'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(process.argv[2] ?? join(root, 'tmp/geographic-illustrated-map-export'))
await mkdir(output, { recursive: true })
await cp(join(root, 'public/illustrated-map/notices/geographic'), join(output, 'notices'), { recursive: true })
await cp(join(root, 'docs/illustrated-map-geographic.md'), join(output, 'Construction.md'))
const outputs = [
  ['geographic-map.svg', buildGeographicMapSvg()],
  [
    'geographic-base.svg',
    buildGeographicMapSvg({ layers: { hatching: false, roads: false, symbols: false, labels: false } }),
  ],
  ['geographic-land-mask.svg', buildGeographicLandMaskSvg()],
  ['geographic-province-hatch.svg', buildGeographicMapSvg({ coverage: 'province' })],
  [
    'geographic-forest.svg',
    buildGeographicMapSvg({ transparentBackground: true, layers: { roads: false, symbols: false, labels: false } }),
  ],
  [
    'geographic-roads.svg',
    buildGeographicMapSvg({ transparentBackground: true, layers: { hatching: false, symbols: false, labels: false } }),
  ],
  [
    'geographic-lettering.svg',
    buildGeographicMapSvg({ transparentBackground: true, layers: { hatching: false, roads: false, symbols: false } }),
  ],
  [
    'geographic-illustrations.svg',
    buildGeographicMapSvg({ transparentBackground: true, layers: { hatching: false, roads: false, labels: false } }),
  ],
  ['schematic-reference.svg', buildIllustratedMapSvg()],
  ['elements.svg', buildElementSheetSvg()],
  ['hatch.svg', buildHatchSwatchSvg()],
] as const
await Promise.all(outputs.map(([name, svg]) => writeFile(join(output, name), svg)))
for (const element of ELEMENT_CATALOG) {
  const folder = join(output, 'elements', element.category)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, `${element.id}.svg`), buildElementSvg(element.id))
}
await writeFile(
  join(output, 'Element-inventory.json'),
  JSON.stringify(
    ELEMENT_CATALOG.map(({ svg: _svg, ...element }) => element),
    null,
    2,
  ) + '\n',
)
await writeFile(join(output, 'Geographic-provenance.json'), JSON.stringify(GEOGRAPHIC_MAP_RECORD, null, 2) + '\n')
const bundled = await build({
  absWorkingDir: root,
  stdin: {
    contents:
      "export * from './src/lib/illustratedMap/index'; export * from './src/lib/illustratedMap/geographic'; export * from './src/lib/illustratedMap/preview';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'GeographicWorkshop',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
})
const engine = bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const reference = `data:image/jpeg;base64,${(await readFile(join(root, 'public/illustrated-map/page8-reference.jpg'))).toString('base64')}`
await writeFile(join(output, 'geographic-review.html'), reviewHtml(engine, reference))
await writeFile(
  join(output, 'README.md'),
  `# Rainforest to Rockies — geographic illustration

Open **geographic-review.html** in a browser. It works directly from disk and contains the same drawing engine as PGMaps. Real geography is the default; the schematic reconstruction remains available as the style reference.

## Drawings

- **geographic-map.svg**: the complete geographic illustration, with coastal hatching.
- **geographic-province-hatch.svg**: the same map with hatching across all BC land.
- **geographic-base.svg**: the geographic land and water without illustration layers.
- **geographic-land-mask.svg**: a literal binary mask of dry land, including lake holes and islands.
- **geographic-forest.svg**, **geographic-roads.svg**, **geographic-lettering.svg**, **geographic-illustrations.svg**: separate transparent components.
- **schematic-reference.svg**: the earlier authored layout, with the corrected shield numerals.
- **elements.svg** and **elements/**: the catalogue and all ${ELEMENT_CATALOG.length} individually editable motifs.
- **hatch.svg**: an independent generated swatch.
- **Geographic-provenance.json**: sources, input hashes, projection, route-marker positions and land/water checks.
- **Element-inventory.json**: construction notes, dimensions and source placement boxes for every element.
- **Construction.md** and **notices/**: geographic preparation details, source credits and complete licence notices.

## What is geographic

The shoreline, inland-water holes, province regions, highway lines and place points come from geographic data. All are projected together to NAD83 / BC Albers (EPSG:3005), then fitted with one uniform scale. Highway lines retain their source polylines rather than a decorative spline. Route shields are snapped to the corresponding real centreline.

The visible BC land and the hatch clip reference the **same path**. There is no inward shoreline offset or white coast stroke. A separate broad coastal style region determines the inland extent of the default hatch; choose All BC land to remove that style restriction. The field keeps its own flow and is clipped by land, including water holes.

Trees and activity illustrations are decorative regional motifs, not recorded observations. The coastal hatch area is based on broad biogeoclimatic regions and is a style choice, not a current forest inventory. The title remains a reconstructed study.

## Regenerate

From PGMaps, run:

\`\`\`sh
node --import tsx scripts/illustrated-map/export-geographic.ts /absolute/path/to/output
\`\`\`

The offline geographic preparation script is **scripts/illustrated-map/build-geographic-map.py**. It reads local WGS84 GeoJSON and provenance files; acquisition and full source archives remain outside the illustration module. See the script's --help and source notices for inputs and licensing.
`,
)
console.log(
  JSON.stringify({
    output,
    files: outputs.map(([name]) => name),
    elements: ELEMENT_CATALOG.length,
    review: 'geographic-review.html',
  }),
)

function reviewHtml(engineCode: string, referenceData: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rainforest to Rockies — geographic workshop</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#123e35;background:#f6f7f2;color-scheme:light}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button,select,input[type=number]{border:1px solid #cbd8ce;border-radius:6px;padding:8px 10px;background:white;color:#123e35}button{cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #b0bd36;outline-offset:3px}button[aria-pressed=true],.primary{background:#123e35;color:white;border-color:#123e35}.shell{max-width:1700px;margin:auto;padding:26px 24px 42px}.eyebrow{font-size:11px;letter-spacing:.17em;font-weight:700;text-transform:uppercase;color:#61746a}h1{font-size:34px;letter-spacing:-.025em;margin:7px 0 12px}p{font-size:13px;line-height:1.65;color:#566d61;margin:0}header{display:flex;gap:24px;align-items:center;justify-content:space-between;margin-bottom:22px}header p{max-width:930px}.tabs{display:flex;gap:5px;overflow:auto;margin-bottom:20px;padding:5px;background:#e8eee6;border:1px solid #d2ddd1;border-radius:9px}.tabs button{white-space:nowrap;border-color:transparent;background:transparent}.tabs button[aria-selected=true]{border-color:#cbd8ce;background:white;color:#123e35;font-weight:650}.layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px;align-items:start}.controls{display:grid;gap:14px}.card{background:white;border:1px solid #d2ddd1;border-radius:9px;padding:16px}.card h2{font-size:15px;margin:0 0 12px}label.field{display:grid;gap:7px;margin:14px 0 0;font-size:12px;font-weight:600}label.field:first-child{margin-top:0}.row{display:flex;justify-content:space-between;gap:10px}.switch{display:flex;gap:8px;font-size:12px;margin:12px 0;align-items:center}input[type=range]{width:100%;accent-color:#147061}input[type=checkbox]{accent-color:#147061}select{width:100%}.note{font-size:11px;line-height:1.6;margin-top:10px}.content{min-width:0}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.toolbar .status{margin-left:auto;font-size:12px;color:#61746a}.stage{height:min(73vh,900px);min-height:420px;overflow:auto;background:#e8eeeb;border:1px solid #cbd8ce;border-radius:9px;padding:14px;display:flex;align-items:flex-start}.drawing{display:block;max-width:none;flex-shrink:0;margin:auto;background:white}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:100%;align-items:start}.compare figure{min-width:0;margin:0}.compare figcaption{font-size:12px;font-weight:650;margin-bottom:8px}.compare img{width:100%;height:400px;object-fit:contain;background:white}.caption{margin:12px 0}.foot{margin-top:22px;border-top:1px solid #d2ddd1;padding-top:16px}a{color:#147061}.primary{white-space:nowrap}#element-control[hidden],#coverage-control[hidden]{display:none}
@media(max-width:1000px){.layout{grid-template-columns:1fr}.content{grid-row:1}.controls{grid-template-columns:repeat(3,minmax(0,1fr))}.stage{height:65vh}.compare{grid-template-columns:1fr}.compare img{height:330px}header{align-items:flex-start}.compare figcaption{margin-top:12px}}
@media(max-width:620px){.shell{padding:20px 13px}.controls{grid-template-columns:1fr}header{flex-direction:column;gap:14px}h1{font-size:28px}.stage{height:55vh;min-height:320px;padding:8px}.tabs button{font-size:12px;padding:8px}.toolbar .status{width:100%;margin-left:0}}
</style></head><body><main class="shell">
<header><div><div class="eyebrow">PGMaps / geographic illustration</div><h1>Rainforest to Rockies</h1><p>Real coastline, lakes, highways and place coordinates, drawn with the reconstructed page 8 style. The land fill and its hatch clip share one boundary.</p></div><button class="primary" id="download">Download map SVG</button></header>
<nav class="tabs" role="tablist" aria-label="Review views"><button role="tab" data-view="map" aria-selected="true">Styled map</button><button role="tab" data-view="mask" aria-selected="false" tabindex="-1">Land and water</button><button role="tab" data-view="compare" aria-selected="false" tabindex="-1">Compare style</button><button role="tab" data-view="elements" aria-selected="false" tabindex="-1">Elements</button></nav>
<div class="layout"><aside class="controls">
<section class="card"><h2>Map composition</h2><label class="field">Map geometry<select id="geometry"><option value="geographic">Real geography</option><option value="schematic">Schematic reference</option></select></label><label class="field" id="coverage-control">Hatch coverage<select id="coverage"><option value="coastal">Coastal style</option><option value="province">All BC land</option></select></label><p class="note">Coastal style keeps an inland ecological-region boundary. At the coast, both choices use the actual land mask.</p><label class="field"><span class="row">White label outline<output id="out-labelHalo">1.8 px</output></span><input id="labelHalo" type="range" min="0" max="5" step=".2" value="1.8"></label><label class="switch"><input id="allowIllustrationOverlap" type="checkbox" checked>Allow illustration overlap</label><button id="reset-composition">Reset composition</button></section>
<section class="card"><h2>Forest texture</h2><label class="field"><span class="row">Stroke spacing<output id="out-spacing"></output></span><input id="spacing" type="range" min="1.5" max="12" step=".1" data-hatch="spacing"></label><label class="field"><span class="row">Band height<output id="out-bandHeight"></output></span><input id="bandHeight" type="range" min="8" max="40" step=".5" data-hatch="bandHeight"></label><label class="field"><span class="row">Stroke width<output id="out-strokeWidth"></output></span><input id="strokeWidth" type="range" min=".3" max="2.4" step=".05" data-hatch="strokeWidth"></label><label class="field"><span class="row">Band curvature<output id="out-curvature"></output></span><input id="curvature" type="range" min="0" max="24" step=".5" data-hatch="curvature"></label><label class="field">Pattern seed<input id="seed" type="number" min="0" max="999999" step="1" data-hatch="seed"></label><button id="reset-hatch" style="margin-top:14px">Reset texture</button></section>
<section class="card"><h2>Layers</h2><label class="switch"><input type="checkbox" data-layer="hatching" checked>Forest hatching</label><label class="switch"><input type="checkbox" data-layer="roads" checked>Highways</label><label class="switch"><input type="checkbox" data-layer="symbols" checked>Illustrations and markers</label><label class="switch"><input type="checkbox" data-layer="labels" checked>Place names and title</label><p class="note">Highway lines and destination points use geographic coordinates. Trees and activity drawings are regional motifs. Coastal hatch is a style treatment, not a current forest inventory.</p><p class="note">Projection: NAD83 / BC Albers (EPSG:3005).</p></section>
</aside><section class="content"><div class="toolbar"><button id="fit" aria-pressed="true">Fit</button><button data-zoom="1" aria-pressed="false">1×</button><button data-zoom="2" aria-pressed="false">2×</button><button data-zoom="4" aria-pressed="false">4×</button><span class="status" id="status">Real geography</span></div><label class="field" id="element-control" hidden>Inspect an element<select id="element"><option value="all">All 64 elements</option></select></label><div class="stage" id="stage" role="region" aria-label="Vector preview" tabindex="0"></div><p class="caption" id="caption"></p></section></div>
<div class="foot"><p>The geographic map is compared side by side with the source and schematic; their positions are intentionally different. The downloadable drawings contain editable vectors. The separate title is a reconstructed study.</p><p><a href="#" id="save-record">Sources and projection record</a> · <a href="#" id="save-geographic">Geographic SVG</a> · <a href="#" id="save-mask">Dry-land mask</a> · <a href="#" id="save-schematic">Schematic reference</a></p></div>
</main><script>${engineCode}</script><script>
const E=GeographicWorkshop,reference=${JSON.stringify(referenceData)},$=id=>document.getElementById(id),state={view:'map',geometry:'geographic',coverage:'coastal',hatch:{...E.DEFAULT_HATCH_OPTIONS},composition:{...E.DEFAULT_COMPOSITION_OPTIONS},layers:{hatching:true,roads:true,symbols:true,labels:true},element:'all',zoom:null};let currentSvg='',filename='',pending=0,previewUrls=[];
for(const element of E.ELEMENT_CATALOG){const option=document.createElement('option');option.value=element.id;option.textContent=element.title;$('element').append(option)}
function image(svg,title){const i=document.createElement('img'),url=URL.createObjectURL(new Blob([E.buildPreviewSvg(svg)],{type:'image/svg+xml;charset=utf-8'}));previewUrls.push(url);i.src=url;i.alt=title;i.draggable=false;return i}
function options(){return{hatch:state.hatch,composition:state.composition,layers:state.layers,coverage:state.coverage}}
function sync(){for(const input of document.querySelectorAll('[data-hatch]')){const key=input.dataset.hatch;input.value=state.hatch[key];if($('out-'+key))$('out-'+key).textContent=state.hatch[key]+(key==='curvature'?'':' px')}$('labelHalo').value=state.composition.labelHalo;$('out-labelHalo').textContent=state.composition.labelHalo+' px';$('allowIllustrationOverlap').checked=state.composition.allowIllustrationOverlap;$('coverage').value=state.coverage;$('coverage-control').hidden=state.geometry!=='geographic';$('element-control').hidden=state.view!=='elements';for(const button of document.querySelectorAll('[data-view]')){const selected=button.dataset.view===state.view;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1}for(const b of document.querySelectorAll('[data-zoom]'))b.setAttribute('aria-pressed',String(state.zoom===Number(b.dataset.zoom)));$('fit').setAttribute('aria-pressed',String(state.zoom===null));$('status').textContent=state.view==='mask'?'Geographic dry-land mask':state.geometry==='geographic'?'Real geography':'Schematic reference'}
function sizeDrawing(){const drawing=$('stage').querySelector('.drawing');if(!drawing)return;const view=drawing.dataset.viewBox.split(' ').map(Number),padding=innerWidth<620?16:28;const factor=state.zoom??Math.min(($('stage').clientWidth-padding)/view[2],($('stage').clientHeight-padding)/view[3]);drawing.style.width=view[2]*factor+'px';drawing.style.height=view[3]*factor+'px'}
function render(){clearTimeout(pending);pending=0;const previousUrls=previewUrls;previewUrls=[];sync();const o=options();currentSvg=state.geometry==='geographic'?E.buildGeographicMapSvg(o):E.buildIllustratedMapSvg(o);filename=state.geometry==='geographic'?'geographic-map.svg':'schematic-reference.svg';$('caption').textContent=state.geometry==='geographic'?'All geographic features share one projection and uniform scale. The forest is clipped to the same land geometry that is painted beneath it.':'The authored schematic is retained as the style reference, with corrected shield numerals.';
 if(state.view==='mask'){currentSvg=E.buildGeographicLandMaskSvg();filename='geographic-land-mask.svg';$('caption').textContent='Black is dry land; white is ocean or inland water. Islands and lake holes remain part of the geographic mask. There is no inward shoreline offset.'}
 if(state.view==='elements'){const element=E.ELEMENT_CATALOG.find(e=>e.id===state.element);currentSvg=element?E.buildElementSvg(element.id):E.buildElementSheetSvg();filename=element?element.id+'.svg':'elements.svg';$('caption').textContent=element?element.construction:'The complete catalogue of reconstructed, individually editable vector elements.'}
 if(state.view==='compare'){const panel=document.createElement('div');panel.className='compare';const source=document.createElement('img');source.src=reference;source.alt='Original page 8 style reference';for(const [title,picture]of [['Source / page 8',source],['Schematic reference',image(E.buildIllustratedMapSvg(o),'Schematic reconstruction')],['Real geography',image(E.buildGeographicMapSvg(o),'Geographic illustration')]]){const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=title;figure.append(caption,picture);panel.append(figure)}$('stage').replaceChildren(panel);$('caption').textContent='Compare the illustration language across three maps. The real map keeps actual geographic positions, so an aligned overlay would be misleading.'}
 else{const documentSvg=new DOMParser().parseFromString(currentSvg,'image/svg+xml').documentElement;const picture=image(currentSvg,state.view==='mask'?'Geographic land mask':'Current vector drawing');picture.className='drawing';picture.dataset.viewBox=documentSvg.getAttribute('viewBox');$('stage').replaceChildren(picture);sizeDrawing()}
 $('download').textContent='Download '+(state.view==='mask'?'land mask':state.view==='elements'?'element':'map')+' SVG';for(const b of document.querySelectorAll('[data-zoom],#fit'))b.disabled=state.view==='compare';for(const url of previousUrls)URL.revokeObjectURL(url);}
function schedule(){clearTimeout(pending);pending=setTimeout(render,70)}
for(const tab of document.querySelectorAll('[data-view]'))tab.addEventListener('click',()=>{state.view=tab.dataset.view;state.zoom=null;render()});document.querySelector('.tabs').addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-view]')],i=tabs.indexOf(document.activeElement);if(i<0)return;let j=i;if(event.key==='ArrowRight')j=(i+1)%tabs.length;else if(event.key==='ArrowLeft')j=(i+tabs.length-1)%tabs.length;else if(event.key==='Home')j=0;else if(event.key==='End')j=tabs.length-1;else return;event.preventDefault();tabs[j].click();tabs[j].focus()});
$('geometry').addEventListener('change',event=>{state.geometry=event.target.value;state.zoom=null;render()});$('coverage').addEventListener('change',event=>{state.coverage=event.target.value;render()});$('element').addEventListener('change',event=>{state.element=event.target.value;state.zoom=null;render()});for(const input of document.querySelectorAll('[data-hatch]'))input.addEventListener('input',()=>{if(!input.value.trim())return;const value=Number(input.value);if(!Number.isFinite(value))return;state.hatch[input.dataset.hatch]=Math.max(Number(input.min),Math.min(Number(input.max),value));schedule()});$('labelHalo').addEventListener('input',event=>{state.composition.labelHalo=Number(event.target.value);schedule()});$('allowIllustrationOverlap').addEventListener('change',event=>{state.composition.allowIllustrationOverlap=event.target.checked;render()});for(const input of document.querySelectorAll('[data-layer]'))input.addEventListener('change',()=>{state.layers[input.dataset.layer]=input.checked;render()});$('reset-hatch').addEventListener('click',()=>{state.hatch={...E.DEFAULT_HATCH_OPTIONS};render()});$('reset-composition').addEventListener('click',()=>{state.composition={...E.DEFAULT_COMPOSITION_OPTIONS};state.coverage='coastal';render()});for(const b of document.querySelectorAll('[data-zoom]'))b.addEventListener('click',()=>{state.zoom=Number(b.dataset.zoom);sync();sizeDrawing()});$('fit').addEventListener('click',()=>{state.zoom=null;sync();sizeDrawing()});window.addEventListener('resize',()=>{if(state.zoom===null)sizeDrawing()});function save(body,name,type='image/svg+xml;charset=utf-8'){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}$('download').addEventListener('click',()=>{if(pending)render();save(currentSvg,filename)});for(const [id,name,make,type]of [['save-record','Geographic-provenance.json',()=>JSON.stringify(E.GEOGRAPHIC_MAP_RECORD,null,2),'application/json'],['save-geographic','geographic-map.svg',()=>E.buildGeographicMapSvg(options())],['save-mask','geographic-land-mask.svg',()=>E.buildGeographicLandMaskSvg()],['save-schematic','schematic-reference.svg',()=>E.buildIllustratedMapSvg(options())]])$(id).addEventListener('click',event=>{event.preventDefault();save(make(),name,type)});window.addEventListener('pagehide',()=>{for(const url of previewUrls)URL.revokeObjectURL(url)});render();
</script></body></html>`
}
