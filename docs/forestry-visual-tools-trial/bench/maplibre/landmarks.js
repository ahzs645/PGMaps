import * as maplibregl from 'maplibre-gl';
import { TreesLayer } from 'maplibre-landmarks';
const q = new URLSearchParams(location.search);
const strict = q.get('mode') === 'strict', terrain = q.get('terrain') !== '0';
// 2 km x 1.2 km forest polygon north of a road near Prince George (synthetic test polygon)
const [x0,y0] = [-122.62, 53.905], dx = 0.03, dy = 0.011;
const forest = { type:'FeatureCollection', features:[{ type:'Feature', properties:{ kind:'forest' }, geometry:{ type:'Polygon', coordinates:[[[x0,y0],[x0+dx,y0],[x0+dx,y0+dy],[x0,y0+dy],[x0,y0]]] } }] };
const map = new maplibregl.Map({ container:'map', canvasContextAttributes:{ preserveDrawingBuffer:true, antialias:true }, maxPitch: 85,
  style:{ version:8, sources:{ forest:{ type:'geojson', data:forest }, dem:{ type:'raster-dem', tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding:'terrarium', tileSize:256, maxzoom:14 } },
    layers:[{ id:'bg', type:'background', paint:{ 'background-color':'#c9c7a6' } }, { id:'hs', type:'hillshade', source:'dem' }, { id:'f', type:'fill', source:'forest', paint:{ 'fill-color':'#5c7a4a', 'fill-opacity':0.35 } }] },
  center:[x0+dx/2, y0-0.0008], zoom: 17.2, pitch: 84, bearing: 0 });
if (terrain) map.on('load', () => map.setTerrain({ source:'dem', exaggeration:1 }));
const opts = strict ? { farCutoff:false, thinBeyondM:Infinity, maxTrees:200000, density:1, fullDensityZoom:0, minZoom:10, scatter:{ forest: 600/10000 } }
                    : { scatter:{ forest: 600/10000 } };
const trees = new TreesLayer({ id:'trees', source:'forest', sourceLayers:{ points:'', polygons:'', water:'' }, wind:{ strength:0 }, riseMs:0, onError:(e,c)=>console.error('trees', c, String(e)), ...opts });
map.on('load', () => map.addLayer(trees));
const views = (q.get('only')==='eye') ? [['eye', { center:[x0+dx/2, y0-0.0008], zoom:17.2, pitch:84 }]] : [ ['eye', { center:[x0+dx/2, y0-0.0008], zoom:17.2, pitch:84 }], ['oblique', { center:[x0+dx/2, y0+dy/2], zoom:15, pitch:60 }], ['plan', { center:[x0+dx/2, y0+dy/2], zoom:14.3, pitch:0 }] ];
window.__results = { mode: strict ? 'strict' : 'default', terrain, views:{} }; window.__shots = {};
map.once('load', async () => { await new Promise(r => setTimeout(r, 8000));
  for (const [name, v] of views) {
    map.jumpTo(v); const t0=performance.now(); await new Promise(r => setTimeout(r, 25000)); map.triggerRepaint(); await new Promise(r => map.once('render', r));
    window.__results.views[name] = { ...trees.getStats(), zoom: map.getZoom(), pitch: map.getPitch() };
    window.__shots[name] = map.getCanvas().toDataURL(); console.warn('view', name, JSON.stringify(window.__results.views[name]));
  }
  window.__results.done = true;
});
