import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { roadsideTreeMesh } from './pgTree.js';
const out = (o) => { window.__results = o; document.getElementById('out').textContent = JSON.stringify(o, null, 1); };
const presets = ['Pine Small','Pine Medium','Pine Large','Aspen Small','Aspen Medium','Aspen Large','Ash Medium','Oak Medium'];
const res = { presets: [] };
// PGMaps crownWidthForClosure(45%, 600 sph)
const CROWN = 2*Math.sqrt(-Math.log(1-0.45)/(Math.PI*0.06)); res.crownWidthM = +CROWN.toFixed(2);
function stats(tree) {
  const g1 = tree.branchesMesh.geometry, g2 = tree.leavesMesh.geometry;
  const box = new THREE.Box3().setFromObject(tree);
  const s = box.getSize(new THREE.Vector3());
  // crown = leaf bbox
  const lb = new THREE.Box3().setFromBufferAttribute(g2.attributes.position);
  const ls = lb.getSize(new THREE.Vector3());
  return { branchTris: g1.index.count/3, leafCards: g2.index.count/6, height: +s.y.toFixed(1), width: +Math.max(s.x,s.z).toFixed(1),
    crownWidthToHeight: +(Math.max(ls.x, ls.z)/s.y).toFixed(2), crownBaseFrac: +(lb.min.y/s.y).toFixed(2), verts: g1.attributes.position.count };
}
for (const p of presets) {
  const t = new Tree(); t.loadPreset(p);
  const t0 = performance.now(); t.generate(); const ms = performance.now()-t0;
  res.presets.push({ preset: p, buildMs: +ms.toFixed(0), ...stats(t) });
}
// simplified LOD: fewer sections/segments/leaves
function makeTree(preset, lod, seed) {
  const t = new Tree(); t.loadPreset(preset); t.options.seed = seed;
  if (lod >= 1) { for (const k in t.options.branch.sections) t.options.branch.sections[k] = Math.max(2, Math.round(t.options.branch.sections[k]/2)); for (const k in t.options.branch.segments) t.options.branch.segments[k] = Math.max(3, Math.round(t.options.branch.segments[k]/2)); t.options.leaves.count = Math.round(t.options.leaves.count/2); t.options.leaves.size *= 1.35; }
  if (lod >= 2) { t.options.branch.levels = Math.min(1, t.options.branch.levels); t.options.leaves.count = Math.max(4, Math.round(t.options.leaves.count/2)); t.options.leaves.size *= 1.3; }
  t.generate(); return t;
}
res.lods = [0,1,2].map(l => { const t = makeTree('Pine Medium', l, 1); return { lod: l, ...stats(t) }; });

// ---- scene: roadside stand at eye level, left = PGMaps mesh, right = EZ-Tree
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1200, 600, false); renderer.setScissorTest(true);
function standScene(kind, mode) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(mode === 'mask' ? 0x000000 : 0xbcd3e6);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x404020, 1.3)); const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(30, 60, -20); scene.add(sun);
  if (mode !== 'mask') { const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000,2000), new THREE.MeshLambertMaterial({ color: 0x6b6a4a })); ground.rotation.x = -Math.PI/2; scene.add(ground); }
  // stand: 600 stems/ha, 40 m deep x 200 m wide, starting 12 m from the road; seeded jitter
  let s = 7; const rnd = () => (s = (s*16807)%2147483647)/2147483647;
  const spacing = Math.sqrt(10000/600); const pts = [];
  for (let x=-100; x<100; x+=spacing) for (let z=12; z<52; z+=spacing) pts.push([x+(rnd()-.5)*spacing, z+(rnd()-.5)*spacing, 22*(0.55+rnd()*0.75), rnd()*6.28]);
  const maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  if (kind === 'pg') {
    const m = roadsideTreeMesh('pine'); const g = new THREE.BufferGeometry();
    // PG mesh is z-up unit height, x/y in crown-width units
    const p = m.attributes.positions.value, q = new Float32Array(p.length);
    for (let i=0;i<p.length;i+=3){ q[i]=p[i]; q[i+1]=p[i+2]; q[i+2]=p[i+1]; }
    g.setAttribute('position', new THREE.BufferAttribute(q,3)); g.setIndex(new THREE.BufferAttribute(m.indices.value,1)); g.computeVertexNormals();
    const bark = m.attributes.bark.value, cols = new Float32Array(q.length); for (let i=0;i<bark.length;i++){ const c = bark[i] ? [0.29,0.23,0.17] : [0.18,0.30,0.16]; cols.set(c, i*3); }
    g.setAttribute('color', new THREE.BufferAttribute(cols,3));
    const mat = mode==='mask'? maskMat : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(g, mat, pts.length); const M = new THREE.Matrix4();
    // crown width = 0.14 * height * CONE_BASE_DIAMETER-ish (PGMaps scales x by crown width)
    pts.forEach((p,i)=>{ const h=p[2], w=CROWN*(0.85+((i*7919)%100)/333)/1.12; M.compose(new THREE.Vector3(p[0],0,p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p[3]), new THREE.Vector3(w,h,w)); im.setMatrixAt(i,M); });
    scene.add(im); res['tris_'+kind] = (g.index.count/3)*pts.length;
  } else {
    const variants = [1,2,3].map(seed => makeTree('Pine Medium', 1, seed));
    let tris = 0;
    variants.forEach((t, vi) => {
      const mine = pts.filter((_,i)=>i%3===vi); const bs = new THREE.Box3().setFromObject(t).getSize(new THREE.Vector3()); const H = bs.y, Wd = Math.max(bs.x,bs.z);
      for (const src of [t.branchesMesh, t.leavesMesh]) {
        const leaf = src===t.leavesMesh;
        const mat = mode==='mask' ? (leaf ? new THREE.MeshBasicMaterial({ color:0xffffff, map: src.material.map, alphaTest: 0.5, side:THREE.DoubleSide }) : maskMat)
          : (leaf ? new THREE.MeshLambertMaterial({ map: src.material.map, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xb8c8a0 }) : new THREE.MeshLambertMaterial({ map: src.material.map, color: 0xffffff }));
        if (mode==='mask' && leaf) { mat.onBeforeCompile = (sh)=>{ sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'diffuseColor.a = texture2D( map, vMapUv ).a;'); }; }
        const im = new THREE.InstancedMesh(src.geometry, mat, mine.length); const M = new THREE.Matrix4();
        mine.forEach((p,i)=>{ const k=p[2]/H; const kw = kind==='ezc' ? CROWN*(0.85+((i*7919)%100)/333)/Wd : k; M.compose(new THREE.Vector3(p[0],0,p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p[3]), new THREE.Vector3(kw,k,kw)); im.setMatrixAt(i,M); });
        scene.add(im); tris += src.geometry.index.count/3*mine.length;
      }
    });
    res['tris_'+kind] = tris;
  }
  res.stems = pts.length;
  return scene;
}
const cam = new THREE.PerspectiveCamera(60, 2, 0.5, 3000); cam.position.set(0, 1.6, 0); cam.lookAt(0, 9, 40);
const scenes = {}; for (const k of ['pg','ez','ezc']) { scenes[k]=standScene(k,'color'); scenes[k+'Mask']=standScene(k,'mask'); }
function draw(a, b) {
  cam.aspect = 1; cam.updateProjectionMatrix();
  renderer.setViewport(0,0,600,600); renderer.setScissor(0,0,600,600); renderer.render(scenes[a], cam);
  renderer.setViewport(600,0,600,600); renderer.setScissor(600,0,600,600); renderer.render(scenes[b], cam);
}
// wait for textures
await new Promise(r => setTimeout(r, 3000));
const gl = renderer.getContext(); res.screenCover = {}; window.__shots = {};
for (const k of ['pg','ez','ezc']) { cam.aspect=2; cam.updateProjectionMatrix(); renderer.setViewport(0,0,1200,600); renderer.setScissor(0,0,1200,600); renderer.render(scenes[k+'Mask'], cam);
 const px = new Uint8Array(1200*600*4); gl.readPixels(0,0,1200,600,gl.RGBA,gl.UNSIGNED_BYTE,px); let a=0; for (let i=0;i<px.length;i+=4) a += px[i]>127; res.screenCover[k] = +(a/720000).toFixed(3);
 window.__shots[k+'Mask'] = renderer.domElement.toDataURL();
 renderer.render(scenes[k], cam); window.__shots[k] = renderer.domElement.toDataURL(); }
// frame timing
for (const k of ['pg','ez','ezc']) { const t0=performance.now(); for (let i=0;i<5;i++){ renderer.setViewport(0,0,1200,600); renderer.setScissor(0,0,1200,600); renderer.render(scenes[k], cam); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4)); } res['frameMs_'+k] = +((performance.now()-t0)/5).toFixed(0); }
res.done = true; out(Object.fromEntries(Object.entries(res).filter(([k])=>k!=='maskPng')));
