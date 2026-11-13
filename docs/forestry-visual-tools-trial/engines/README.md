# Other renderers, fed PGMaps' own scene

Trial only. Nothing here is imported by the app, bundled or deployed.

The road view on `/dev/forestry/visual-quality` can write its scene out as a file:
Sidebar → **3D scene for other renderers** → `forestry-scene-package.json`
(`src/pages/dev-forestry/scenePackage.ts`, format `pgmaps-forest-scene` v1).
Each engine below gets a small adapter that reads that file, so every engine
draws the **same evidence**: the same stems, species, heights and crown widths
as the road view, the same ground, harvested openings, slash and road scars, the
same eye and lens. Changing renderer costs an adapter, not a rewrite.

## The package, in one paragraph

Local metres from the ground under the eye: `x` east, `y` north, `z` up, heights
absolute. `terrain` is a regular grid, row-major from the south row, `null` where
the source DEM has no value. `trees.data` is flat, 7 numbers a stem
(`x, y, z, species, height, crownWidth, tone`), `species` indexing
`trees.species`. `debris.data` is 4 a pile (`x, y, z, footprint`). `openings` and
`roadScars` are rings. `camera` is `position`, `bearingDegrees` (clockwise from
north), `pitchDegrees` (up from level) and `verticalFovDegrees`. `models` holds
each species' own detailed mesh (`detailedTreeMesh`), unit height and unit crown
width, non-indexed, with `bark` 1 on wood and 0 on foliage: PGMaps' own
geometry, so no third-party tree asset is involved. `parseScenePackage` checks a
file; `scenePackage.test.ts` pins that the stems are the road view's own.

## The engines

| Folder              | Upstream                                                                                             | Licence                                          | What the adapter does                                                                                                                                                                                                                                  | Status here                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threejs-worldgen/` | [AskAlice/threejs-worldgen](https://github.com/AskAlice/threejs-worldgen) at `BASE_COMMIT`           | Apache-2.0                                       | `scatter`: layers may carry **fixed instances** (x, z, yaw, width, height) instead of blue-noise placement; `example/pgmaps-scene.*` builds the package's ground, species from worldgen's presets tuned to ours, the package's stems, slash and camera | **Renders** (WebGL2, `?webgl`): 15,945 stems, the road view's frame, `evidence/scene-package-pgmaps-vs-worldgen.jpg`. Distant impostors show as grey posts on SwiftShader; check on a GPU |
| `threejs-nanites/`  | [VictorZakharov/threejs-nanites](https://github.com/VictorZakharov/threejs-nanites) at `BASE_COMMIT` | MIT (its Lucy model is non-commercial; not used) | `examples/pgmaps-scene.*`: the package's ground, one Nanite type per species built from the package's own models (bark and foliage coloured, opaque), stems as instances, the package's eye                                                            | **Typechecks; runs its frame loop** (1,257 frames in 45 s) but SwiftShader's WebGPU canvas reads back blank and GPU stats never return, as with Nanite's own examples. Needs a real GPU   |
| `vistawasm/`        | `@vista-wasm/vista-wasm` 2.0.0 from npm                                                              | **AGPL-3.0**                                     | `main.ts`: package ground through `loadRawHeightmap`, our models through `setTreeModel`, stems through `setTreeInstances`, camera through `setCamera`. Our file only calls its public API                                                              | **API accepted the data; WebGPU device lost on SwiftShader**. Needs a real GPU                                                                                                            |

**13 November.** On a real GPU (M4 Pro) both now draw the package, and the road
view can show either in place of its own drawing (View options → *Renderer*;
trial doc §13). Each folder's `0002-*.diff` holds the fixes and the road view's
`postMessage` bridge on top of the patch: `git apply` it after `git am`. Then run
each engine's dev server where the road view looks for it in development —
worldgen on `127.0.0.1:8460` (`npm run dev`), Nanite with
`npx vite --port 8461 --host 127.0.0.1` — or set `VITE_FORESTRY_WORLDGEN_URL`
and `VITE_FORESTRY_NANITE_URL` to their pages with `?embed`.

**Later on 13 November** each folder gained a `0003-*.diff`, cumulative from the
pinned commit after `git am` (it **replaces** `0002`: apply one or the other).
worldgen grows its stand from `threejs-trees`, lights it with `threejs-sky`,
draws the package's `water` with `threejs-water` and snow and rain with
`threejs-weathering`, and adds opt-in view culling to scatter. Nanite draws the
repository demo's look: ez-tree trees with leaf cards (three crown-width classes
per species), shadows, god rays, TAA, its textured floor, reflective water and
the same weather. Both read the `pgmaps-environment` message (trial doc §14).
**Nanite's version uses ez-tree's bark and leaf images, whose sources are
unstated**: it is a local trial, never deployed from or bundled into PGMaps.

The worldgen and Nanite folders are **patches** against a pinned upstream commit,
because these are forks of other projects and this session could not create
GitHub forks. VistaWASM is not forked or patched at all.

### Applying a fork patch

```bash
git clone https://github.com/AskAlice/threejs-worldgen && cd threejs-worldgen
git checkout $(cat ../PGMaps/docs/forestry-visual-tools-trial/engines/threejs-worldgen/BASE_COMMIT)
git am ../PGMaps/docs/forestry-visual-tools-trial/engines/threejs-worldgen/*.patch
npm ci && npm run dev
```

Then open `pgmaps-scene.html?scene=<url of the package>` (or pick the file).
Add `&webgl` to force WebGL2, `&still` to stop once every instance is in.
Nanite is the same with `threejs-nanites/` and `examples/pgmaps-scene.html`;
it needs WebGPU.

To keep them as real forks: fork both upstreams on GitHub (e.g.
`ahzs645/threejs-worldgen`, `ahzs645/threejs-nanites`), apply the patch on a
branch `pgmaps-scene-package`, and push. The patches are the source of truth
until then.

### VistaWASM: a trial, not part of PGMaps

VistaWASM is the only engine that takes a real DEM and our own tree list out of
the box, which makes it the best comparison. It is AGPL-3.0 and PGMaps is MIT,
so it stays at arm's length:

- It is installed by `npm install` **inside this folder only**; `node_modules`
  is never committed. The app's `package.json` does not list it and nothing in
  `src/` imports it.
- `main.ts`, `index.html` and `package.json` here are ours (MIT) and only call
  its documented API.
- Nothing built from this folder is deployed. Serving it publicly, or modifying
  VistaWASM itself, would bring AGPL's source-offer obligations; whether PGMaps
  ever ships it is an owner decision
  (`docs/forestry-road-design/reference-repo-licensing-and-conversion.md`).
  Routes if it is wanted: ask the author for a separate licence, run it as a
  separately served AGPL tool fed the package file, or keep it as a local bench.

```bash
cd docs/forestry-visual-tools-trial/engines/vistawasm
npm install
npm run dev
```

Then open `/?scene=<url of the package>`, or pick the file. Needs WebGPU.
