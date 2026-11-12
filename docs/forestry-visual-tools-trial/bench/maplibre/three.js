import * as maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { ThreeDManager } from 'maplibre-gl-three';
import { Tree } from '@dgreenheck/ez-tree';
const R = window.__results = { steps: [] }; window.__shots = {};
const log = (s) => { R.steps.push(s); console.warn(s); };
const eye = [-122.6055, 53.9035], target = [-122.6055, 53.9075];
const map = new maplibregl.Map({ container:'map', canvasContextAttributes:{ preserveDrawingBuffer:true, antialias:true }, maxPitch: 89.9, terrainSkirtLength:'none',
  style:{ version:8, sources:{ dem:{ type:'raster-dem', tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding:'terrarium', tileSize:256, maxzoom:14 }, hs:{ type:'raster-dem', tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding:'terrarium', tileSize:256, maxzoom:14 } },
    terrain:{ source:'dem' }, sky:{ 'sky-color':'#9cc0e0', 'horizon-color':'#dde8ee' },
    layers:[{ id:'bg', type:'background', paint:{ 'background-color':'#a8a578' } }, { id:'h', type:'hillshade', source:'hs' }] },
  center: target, zoom: 15, pitch: 70 });
const mgr = new ThreeDManager();
try { await mgr.init(); log('ThreeDManager.init ok'); } catch (e) { log('init failed: ' + e); }
const layer = mgr.createLayer();
map.on('load', async () => {
  map.addLayer(layer); log('layer added');
  await new Promise(r => setTimeout(r, 8000));
  const scene = layer.three.getScene();
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x404020, 1.4)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(1,1,1); scene.add(sun);
  const t = new Tree(); t.loadPreset('Pine Medium'); t.options.seed = 3; t.generate();
  const bs = new THREE.Box3().setFromObject(t).getSize(new THREE.Vector3());
  const leafMat = new THREE.MeshLambertMaterial({ map: t.leavesMesh.material.map, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xb8c8a0 });
  const barkMat = new THREE.MeshLambertMaterial({ map: t.branchesMesh.material.map });
  // a row of trees 60-400 m in front of the eye, on the terrain
  const placed = [];
  for (let i = 0; i < 160; i++) {
    const lng = target[0] + (Math.random() - 0.5) * 0.008, lat = eye[1] + 0.0006 + Math.random() * 0.003;
    const h = map.queryTerrainElevation([lng, lat]); if (h == null) continue;
    placed.push({ lng, lat, h });
  }
  log('terrain elevations sampled: ' + placed.length + ' e.g. ' + placed.slice(0,3).map(p=>p.h.toFixed(1)).join(','));
  for (const [geom, mat] of [[t.branchesMesh.geometry, barkMat], [t.leavesMesh.geometry, leafMat]]) {
    const anchor = { point: [target[0], eye[1] + 0.002], height: placed[0].h };
    const group = new THREE.Group(); group.applyMatrix4(mgr.getEcefMatrix(anchor));
    const im = new THREE.InstancedMesh(geom, mat, placed.length); const M = new THREE.Matrix4();
    placed.forEach((p, i) => {
      const ecef = mgr.lngLatAltToEcef({ point:[p.lng, p.lat], height:p.h });
      const inv = group.matrix.clone().invert(); const loc = ecef.clone().applyMatrix4(inv);
      const k = 22 / bs.y, kw = 3.6 / Math.max(bs.x, bs.z);
      M.compose(loc, new THREE.Quaternion(), new THREE.Vector3(kw, k, kw)); im.setMatrixAt(i, M); });
    group.add(im); scene.add(group);
  }
  log('instanced trees added');
  // eye-level camera 1.6 m above the drawn ground
  const ground = map.queryTerrainElevation(eye);
  const cam = map.calculateCameraOptionsFromTo(new maplibregl.LngLat(...eye), ground + 1.6, new maplibregl.LngLat(...target), ground + 6);
  map.jumpTo(cam); log('eye camera: ' + JSON.stringify({ zoom: cam.zoom?.toFixed?.(2), pitch: cam.pitch?.toFixed?.(1), ground }));
  layer.requestRepaint(); await new Promise(r => setTimeout(r, 15000)); map.triggerRepaint(); await new Promise(r => map.once('render', r));
  window.__shots.eye = map.getCanvas().toDataURL();
  map.jumpTo({ center: [target[0], eye[1] + 0.002], zoom: 16.3, pitch: 60, bearing: 20 }); await new Promise(r => setTimeout(r, 12000)); map.triggerRepaint(); await new Promise(r => map.once('render', r));
  window.__shots.oblique = map.getCanvas().toDataURL();
  R.done = true;
});
