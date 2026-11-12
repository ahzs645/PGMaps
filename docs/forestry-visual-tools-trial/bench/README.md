# Visual tools trial — bench

Scripts behind `docs/forestry-visual-tools-trial-2026-11-12.md`. They are
standalone (not part of the PGMaps build) and each folder installs its own
packages, because Giro3D needs three 0.180 and the MapLibre add-ons need 0.186.

Screenshots and readings come from headless Chromium driven by Playwright
(`shoot2.cjs <url> <out-prefix> [timeout-ms]`), which waits for
`window.__results.done` and saves every data URL in `window.__shots`.

## maplibre/ — EZ-Tree, maplibre-landmarks, maplibre-gl-three

```bash
cd docs/forestry-visual-tools-trial/bench/maplibre && npm install && ./make-pgtree.sh && npm run dev
```

- `eztree.html` — preset stats, then one stand drawn three ways (PGMaps mesh,
  EZ-Tree width-constrained, EZ-Tree raw) with colour and coverage-mask renders.
- `landmarks.html?mode=default|strict[&only=eye]` — TreesLayer on a 240 ha
  polygon with terrain; `getStats()` per view.
- `three.html` — EZ-Tree pines on terrain through maplibre-gl-three, eye-level
  camera.

`make-pgtree.sh` writes `pgTree.js`, a plain-JS copy of
`src/pages/dev-forestry/treeGeometry.ts`.

## giro3d/ — LidarBC DEM and DSM

Download tile `093g097_1_2_1` (2024) DEM and DSM into `public/data/dem.tif` and
`public/data/dsm.tif` (URLs from the LidarBC index, layers 5 and 1). The
originals do not load in Giro3D (see the trial note); write uncompressed
copies to `public/dem-plain.tif` / `public/dsm-plain.tif` (or convert to COG
with GDAL), then open `/?surface=dem&plain=1` and `/?surface=dsm&plain=1`.
`chm.mjs` prints canopy height statistics from the two rasters.

## browser/ — hosted demos

- `demos.cjs [name]` — loads each public demo, records load time, requests,
  console errors and a screenshot.
- `fora2.cjs <file.laz>` — loads a LAZ into the hosted FORA app, runs
  segmentation and saves the tree CSV; `fora_stats.py` summarises it.
- `chmpg.cjs` — screenshots a local copy of the OpenForest4D viewer serving a
  PG CHM tile on port 5201.
