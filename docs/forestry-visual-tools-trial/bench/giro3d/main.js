import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import ColorMap, { ColorMapMode } from '@giro3d/giro3d/core/ColorMap.js';
import CoordinateSystem from '@giro3d/giro3d/core/geographic/CoordinateSystem.js';
import Extent from '@giro3d/giro3d/core/geographic/Extent.js';
import Instance from '@giro3d/giro3d/core/Instance.js';
import ElevationLayer from '@giro3d/giro3d/core/layer/ElevationLayer.js';
import ColorLayer from '@giro3d/giro3d/core/layer/ColorLayer.js';
import Map from '@giro3d/giro3d/entities/Map.js';
import GeoTIFFSource from '@giro3d/giro3d/sources/GeoTIFFSource.js';
const R = window.__results = { steps: [] }; window.__shots = {};
const log = (s) => { R.steps.push(s); console.warn(s); };
const q = new URLSearchParams(location.search); const which = q.get('surface') || 'dem';
const crs = CoordinateSystem.register('EPSG:3157', '+proj=utm +zone=10 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const extent = new Extent(crs, 516407, 518084, 5972410, 5973836);
const instance = new Instance({ target: 'view', crs, renderer: { preserveDrawingBuffer: true } });
const t0 = performance.now();
const map = new Map({ extent, backgroundColor: '#888', lighting: { enabled: true, mode: 'light-based' }, subdivisionThreshold: 0.5 });
instance.add(map);
instance.scene.add(new THREE.HemisphereLight(0xdfefff, 0x404020, 1.2)); const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(518500, 5971500, 3000); sun.target.position.set(517200, 5973100, 600); instance.scene.add(sun, sun.target);
const source = new GeoTIFFSource({ url: q.get("plain") ? `/${which}-plain.tif` : `/data/${which}.tif`, crs, ...(q.get('workers')==='0' ? { enableWorkers: false } : {}), ...(q.get('block') ? { blockSize: +q.get('block') } : {}) });
const ramp = []; for (let i = 0; i < 256; i++) { const t = i/255; ramp.push(new THREE.Color().setHSL(0.28 - 0.18*t, 0.35, 0.28 + 0.4*t)); }
await map.addLayer(new ElevationLayer({ name: which, extent, source, minmax: { min: 560, max: 720 } }));
await map.addLayer(new ColorLayer({ name: 'c', extent, source, colorMap: new ColorMap({ colors: ramp, min: 560, max: 720, mode: ColorMapMode.Elevation }) }));
log('layers added in ' + (performance.now() - t0).toFixed(0) + ' ms');
const cam = instance.view.camera;
const views = { oblique: [[516900, 5971900, 900], [517300, 5973000, 600]], low: [[517700, 5972600, 640], [517100, 5973300, 610]] };
const controls = new MapControls(cam, instance.domElement); instance.view.setControls(controls);
for (const [name, [p, t]] of Object.entries(views)) {
  cam.position.set(...p); controls.target.set(...t); controls.update(); instance.notifyChange(cam);
  await new Promise(r => setTimeout(r, 20000));
  instance.renderingOptions && null; instance.notifyChange(cam, { immediate: true }); await new Promise(r => setTimeout(r, 2000));
  window.__shots[name] = instance.domElement.querySelector('canvas')?.toDataURL() || instance.renderer.domElement.toDataURL();
  const e = map.getElevation ? map.getElevation({ coordinates: new (await import('@giro3d/giro3d/core/geographic/Coordinates.js')).default(crs, 517200, 5973100, 0) }) : null;
  log(name + ' rendered; elevation sample ' + JSON.stringify(e?.samples?.[0]?.elevation ?? null));
}
R.memory = instance.renderer.info.memory; R.done = true;
