# Photo matching bench

Scripts that fit a landscape or aircraft photograph to the terrain, check the fit against mapped features, and carry outlines between the photo and the map. They are the method in `docs/research/landscape-photo-matching-2026-11-14.md`, rebuilt as a bench to test against before any of it moves into the page.

They call the page's own modules unchanged: `photoPose.ts`, `skylineFit.ts`, `exifPose.ts` and `terrain.ts`. Their data comes from:
- AWS Terrarium terrain tiles
- Esri World Imagery tiles (the satellite basemap PGMaps uses)
- DataBC's WFS: FWA streams, lakes, rivers and wetlands; FTEN road sections; the Digital Road Atlas; consolidated cutblocks

Nothing here is wired into the app, and nothing is DOM-bound.

## Case files

Each photo has a case file: local JSON kept **outside the repository**, because it records where the photo was taken. Paths in it are relative to the case file. The scripts read it, add their results, and write their images into its `out` folder.

```json
{
  "photo": "../IMG_0001.png",
  "out": "out-0001",
  "platform": "air",
  "skyline": { "mode": "auto" }
}
```

Pixel coordinates in a case file are in the **working frame**: the upright photo scaled to 1,050 px wide.

Photos can come straight from the phone. The decoder applies a JPEG's rotation flag itself. `match.ts` turns a HEIC into PNG with macOS `sips` beside the case and records the original as `metadata`, from which the scripts read the EXIF and the rotation that `sips` drops.

## Quick start

```sh
node --import tsx scripts/forestry/photo-matching/match.ts <photo> [--cases <dir>] [--proposal a.geojson …] [--ground]
```

This creates the case file (default `<photo folder>/photo-matching/`; a folder inside the repository is refused) and runs stages 1–3. If proposals are given and the camera is trustworthy, it then runs stage 6. It ends by printing what to look at and what is left for a person. The skill `.agents/skills/pgmaps-photo-matching/SKILL.md` is the full workflow: how to judge the check images, and what to do when a camera is not trustworthy or the near ground sits off.

| Field | Used by | Meaning |
| ----- | ------- | ------- |
| `platform` | all | `air` puts the eye at GPS altitude; `ground` puts it at the terrain plus `eyeHeight` (1.7 m). |
| `skyline` | orient, solve | `auto` uses `photoSkyline` (blue sky or white cloud). `luma` with `from` (a fraction of the height known to be sky) uses a brightness drop, for haze and sunsets. `trace` with `points` uses a skyline traced by hand. Leave it out and `orient.ts` tries `auto`, then `luma` from 0.2, 0.3 and 0.4, keeps the best trustworthy fit, and writes the reader it used here. |
| `orientation` | orient, classes | Optional search ranges: `roll`, `pitch` (each `[min, max]`) and heading `span` (± degrees; 180 searches every heading). |
| `sunPixel` | orient | Where the sun or a sun-lit cloud edge shows, to check the heading. |
| `masks` | classes | Photo regions marked `sky`, `water`, `open`, `forest` or `land` (any ground but water). `default` labels the unmarked rest from row `fromY`. |
| `controls` | solve, check | `points` (a `pixel` with a `lngLat`, or `peakNear: true` for a summit) and `lines` (a `layer` of `streams`, `ftenRoads`, `draRoads`, `lakes`, `wetlands` or `cutblocks`, and the `pixels` that lie on it). |
| `metadata` | all | The original file when `photo` is a converted copy (HEIC → PNG); EXIF and rotation come from it. |
| `proposals` | overlay | `[{ "file": "proposal.geojson", "roadWidthM": 12 }]`: map GeoJSON, where polygons are blocks and lines are roads (a feature's own `roadWidthM` wins). |
| `traces` | trace | Outlines drawn in the photo, with optional `compareTo` (`wetlands`, `cutblocks` or `lakes`). |
| `views` | trace | Other viewpoints: `lng`/`lat` (default the camera), `agl` or `dAlt`, `bearing` and `pitch` (degrees, or `"toward"` the first trace), and `hfov`. |

## Stages

Run from the repository root; each takes the case file.

```sh
node --import tsx scripts/forestry/photo-matching/read-photo.ts case.json   # 1. what the file knows
node --import tsx scripts/forestry/photo-matching/orient.ts case.json       # 2. heading/pitch/roll from the skyline
node --import tsx scripts/forestry/photo-matching/classes.ts case.json      # 2b. … or from marked regions (classes)
node --import tsx scripts/forestry/photo-matching/check.ts case.json [--pose classes-1] [--no-render]  # 3. near-ground check
node --import tsx scripts/forestry/photo-matching/solve.ts case.json [--hold hfov] [--use]  # 4. camera from skyline + controls, with hold-outs
node --import tsx scripts/forestry/photo-matching/trace.ts case.json       # 5. photo → map → photo, other viewpoints
node --import tsx scripts/forestry/photo-matching/overlay.ts case.json [proposal.geojson …]  # 6. proposals drawn into the photo
node --import tsx scripts/forestry/photo-matching/crop.ts case.json x y w h [--zoom 2] [--grid 20]  # read pixels exactly
```

1. **`read-photo.ts`** writes `observation`, the ground under the camera and the sun at the GPS time:
   - position, GPS altitude and the stated horizontal error
   - recorded heading and its reference
   - lens (35 mm equivalent, which already includes digital zoom)
   - camera clock and GPS fix time, and how much older the fix is than the shutter
   - Apple's maker-note acceleration vector, read as pitch and roll and flagged when it is not near 1 g
2. **`orient.ts`** writes `pose` and `orient.jpg`:
   - a coarse search in angles: each skyline column becomes a ray compared with a 90 km terrain profile
   - pitch is centred on the tilt sensor when its reading is near 1 g; heading searches 360° from the air
   - then `fitSkyline` at quarter-degree rolls
   - it reports agreement, the recorded heading's error, and where the sun should appear
   - it also reports the best heading at least 15° from the winner; when that fits within `AMBIGUOUS_LOSS_GAP` (0.1° mean loss per column, provisional, from four cases), the camera is **not trustworthy** whatever `fitSkyline` says. A straight ridge traced in one corner fitted 100% and was wrong.
   - in `orient.jpg`, yellow is the skyline as read, green the terrain skyline at the fit, red the terrain skyline at the recorded heading, and the white circle the sun
2b. **`classes.ts`** is for photos with too little skyline:
   - every viewing direction is cast once from the fixed camera and classed from the map: lakes and rivers are water; cutblocks from the last six years, wetlands and brown imagery are open; any other ground is forest
   - heading, pitch and roll are scored by balanced agreement over the marked regions
   - the five best poses at least 10° apart go to `results.poses`
   - weak on its own: clearings are everywhere, so check every candidate with `check.ts`
   - the map classes only out to `CLASS_RADIUS` (6 km). Ground farther away matches any ground label, so leave distant hazy land unmarked or mark it `land`.
   - defaults are roll ±30° and pitch −60° to +10°, wider than `orient.ts`'s roll ±15°, because photos with little skyline are often steep and banked
3. **`check.ts`** writes `check-model-*.jpg` (the model's view beside the photo) and `check-features-*.jpg` (mapped features drawn by the same camera, solid where in sight and dotted where terrain hides them). It also measures `controls.lines`. `--no-render` skips the model view, the slow half (about 20 s).
4. **`solve.ts`** runs Levenberg–Marquardt over seven values: position, height, heading, pitch, roll and field of view.
   - Evidence: the skyline, the controls, and a weak GPS prior (σ 25 m across, 30 m up).
   - Each control group is left out in turn and measured, which is the accuracy to report.
   - Errors are given in pixels and in metres across the view; near the camera a large pixel error can be a few metres.
   - The skyline term is re-read at 40 columns, measured against the terrain at each trial position and clipped at 15 px, so its median differs from `orient.ts`'s, which counts only columns within `fitSkyline`'s band.
   - `--hold hfov` (or any of `east,north,up,heading,pitch,roll,hfov`) keeps values fixed. Hold the lens unless the controls are spread across the frame and in depth; a near shore at the frame's edge otherwise narrows it.
   - `--use` adopts the solved camera.
5. **`trace.ts`** ray-casts each traced outline to the ground and writes `traces.geojson`.
   - It compares each outline with the named layer: the traced area's share inside it, and intersection over union.
   - It draws the outlines back into the photo, filled only where the camera sees their ground (`trace-photo.jpg`), and renders `views` (`trace-view-N.jpg`).

6. **`overlay.ts`** draws proposals with the case's camera:
   - `overlay-outline.jpg`: solid where the camera sees the ground, dotted where terrain hides it, with seen ground filled; the caption names the camera's source and held-out accuracy
   - `overlay-after.jpg`: an illustration, with seen ground toned to cleared ground or gravel and the photo's shading kept
   - `overlay-compare.jpg`: the photo and the illustration side by side

   It prints each proposal's area, its share in sight (terrain only, no canopy), its distance and its share of the frame. These are figures about the photo, not a VIA percent alteration.
- **`crop.ts`** (a helper) writes a zoomed crop with a grid labelled in working-frame pixels, for reading skyline traces, region corners and control points exactly.

## Experimental camera transfer from overlapping photos

Give the bench two cases from the same flight. The reference needs a camera pose.
Install OpenCV in a Python environment (for example, `python3 -m pip install opencv-python-headless` in a venv).
Set `PHOTO_MATCH_PYTHON` to that environment's interpreter if it differs from `python3`.

```sh
node --import tsx scripts/forestry/photo-matching/overlap.ts /path/reference.json /path/target.json
node --import tsx scripts/forestry/photo-matching/overlap.ts /path/reference.json /path/target.json --reviewed-reference --candidate /path/target-overlap.json
```

The first command compares the target's starting camera, a rotation fit at the
starting GPS fix, and a fit with bounded position adjustments. The target can
start with a skyline pose or with GPS and lens metadata. Reciprocal SIFT matches
are screened with image geometry, spread across both images, and projected onto
the DEM through the reference camera. The fitter leaves out whole parts of the
overlapping image, keeps the lens fixed, and reports median and 90th-percentile
pixel errors at 1,050 px width. Explicit target `controls.points` with
`lngLat` are checked separately and never enter the fit. A null error means
the model could not predict a visible point or a held-out fit failed.

After inspecting the reference against mapped features, use the second command
to write a new provisional case beside the photos. Run `check.ts` on that case
and inspect the model and mapped features. The visual-quality page reads it
through **Camera → Adjust → Use a matched camera** and flags it for independent
landmark review before acceptance.

### Archive experiment

A sweep of 91 possible pairs from 14 helicopter photos found three strong
overlaps. SIFT retained more correspondences than ORB on two of those pairs.
Testing both skyline hypotheses in both directions gave 12 terrain-transfer
trials. Three directions across two pairs passed the spatial hold-out checks.
Allowing bounded GPS adjustment reduced median held-out error from 4.0–19.7 px
at the starting GPS position to 1.8–4.4 px. Wider initial rejection thresholds
of 24 and 36 px did not bring in the third pair, so the bench uses 12 px.

The only photo that passed the earlier skyline check had no strong overlap.
The ground matches in the successful trials came from provisional reference
poses. Independent satellite previews gave mixed support, although one proposed
camera clearly put the prominent clearing closer to where it appears in the
photo. The tests establish relative alignment on those overlaps, while absolute
geographic accuracy still needs independently identified landmarks.

Run the synthetic geometry tests with
`node --import tsx --test scripts/forestry/photo-matching/lib/overlap.test.ts`.

### Compare an archive's results

Run the image geometry check on all pairs of upright 1,050 px working frames.
Select `sift`, `rootsift`, `contrast-rootsift`, `multiscale-rootsift` or `orb`
with `--method` here or with `--descriptor` on `overlap.ts`. Multiscale
RootSIFT tries larger and smaller working frames and uses a looser ratio test
with a minimum spread in both frames. Review the resulting image links before
using them for a terrain fit.

```sh
python3 scripts/forestry/photo-matching/lib/overlap_features.py --all-pairs --method contrast-rootsift /path/to/frames/*.jpg
node --import tsx scripts/forestry/photo-matching/scorecard.ts /path/to/results.json
```

Put one entry per photo in the results array, including photos with no solution.
Use `passed`, `ambiguous`, `weak` or `unmeasured` for `skyline`. For a selected
provisional overlap candidate, copy `medianPx` and `p90Px` from the selected
model's (`fixed` or `adjusted`) hold-out results into `overlap`. Record each
mapped checkpoint as a `landmarks` entry with its feature `group` and `errorPx`
at 1,050 px width. Use `null` for a failed projection. Include only landmarks
excluded from the camera fit.

```json
[
  {
    "id": "photo-a",
    "skyline": "ambiguous",
    "overlap": { "medianPx": 2.1, "p90Px": 6.1 },
    "landmarks": [
      { "group": "road bend", "errorPx": 8 },
      { "group": "shoreline tip", "errorPx": 10 },
      { "group": "pond edge", "errorPx": 6 }
    ]
  },
  { "id": "photo-b", "skyline": "weak" }
]
```

Review coverage counts both skyline passes and overlap candidates once per photo.
Read the [14-photo scorecard](../../../docs/research/photo-alignment-scorecard-2026-11-17.md)
for the benchmark and related projects.

## In the visual-quality page

`/dev/forestry/visual-quality` reads a case file directly: open the photo with *Line up a photo of my own* in step 2's Field photo panel, then *Use a matched camera…* and pick the case file. The road view then stands at the matched position and altitude, facing the matched heading, pitch and roll, with the photo laid over it (`src/pages/dev-forestry/matchedCamera.ts`).

## Notes

- **Warning.** Every run prints tsx's `DeprecationWarning: module.register() is deprecated`; it is harmless, and `match.ts` hides it.

- **Cache.** Tiles and WFS answers are cached in `$PHOTO_MATCH_CACHE`, which defaults to the system temp folder. Delete it to fetch fresh layers.
- **Licensing.** Do not commit photographs, case files or their outputs. Licensee block names and coordinates stay out of the repository, as for the other forestry research.
- **Terrain.** Terrarium is z13 near the camera (about 11 m posts here) and z10 out to the skyline. A summit reads a few pixels low. Where published LiDAR exists, a finer DEM would sharpen the near ground.
- **Recorded heading.** Never trust it from an aircraft: on the two trial photos that could be solved it was 55° and 136° out. A search centred on it found a convincing false skyline match. Search every heading, and check the answer with the sun or the near ground.
