---
name: pgmaps-photo-matching
description: Fit a landscape or aircraft photograph to the terrain from its GPS, check the fit against mapped features, and draw proposed blocks or roads into the photo. Use when someone shares a field, helicopter or roadside photo and asks to line it up with the map or terrain, find where it was taken from or which way it faced, check mapped features against it, carry something drawn in the photo onto the map, or show a proposed cutblock or road in the photo (a photo simulation or overlay).
---

# PGMaps photo matching

The bench in `scripts/forestry/photo-matching/` (README there) fits the camera from the photo's GPS and its skyline, checks it against FWA lakes, wetlands, streams, roads and cutblocks, and draws proposals in. The method, its measured accuracy and what others have built are in `docs/research/landscape-photo-matching-2026-11-14.md`. Read the README's case-file table before editing a case file.

## Ground rules

- **Coordinates stay out of the repository.** Case files, photos, outputs and proposal files go beside the photo or in a folder the person names. `match.ts` refuses a cases folder inside the repo. Never commit them, never paste coordinates into docs, and never name a licensee's blocks.
- **No code from GPL or unlicensed tools** (QCALVIEW, moniQue, Pic2Map, MIAS; see the research note). Smapshot's API is BSD-3.
- **Report what was measured.** Overlay figures are about this photo. The share in sight is terrain only, with no canopy screening, and is never a VIA percent alteration. The "after" image is an illustration and says so.

## 1. Run it

```sh
node --import tsx scripts/forestry/photo-matching/match.ts <photo> [--cases <dir>] [--proposal a.geojson …] [--ground]
```

- Takes JPEG, PNG or HEIC straight from the phone; HEIC is converted with macOS `sips`.
- The default is an aircraft photo; use `--ground` for one taken standing on the ground.
- Proposals are map GeoJSON: polygons are blocks, lines are roads, with an optional `roadWidthM` property (default 12).
- It runs read-photo → orient → check, then overlay only if the camera is trustworthy, and prints what to look at.
- Rerunning keeps the case file. Delete its `pose` to search again.

## 2. Judge the camera: always look, never trust a number alone

Read the printed orientation lines, then **open both check images** with the Read tool:
- `check-model-pose.jpg`: the model's view beside the photo
- `check-features-pose.jpg`: mapped features drawn with the camera

Accept the camera only if the model view shows the same ground and the mapped features sit on what the photo shows: lakes on water, wetland outlines round brown fens, roads on roads, recent cutblocks on clearings.

In `orient.jpg`:
- yellow is the photo's skyline as read
- green is the terrain skyline at the fitted camera, and should sit on the photographed ridgeline
- red is the terrain skyline at the recorded heading
- the white circle is where the sun should be

`orient.ts` also prints the **next-best heading at least 15° away**. When that heading fits about as well, it prints **AMBIGUOUS** and the camera is not trustworthy, whatever the column agreement says. A straight ridge traced in one corner fitted 100% and was still wrong.

Things that are normal, not failures:

- **The recorded heading is off by tens or hundreds of degrees.** Phones in aircraft get it wrong (55° and 136° on the trial photos), which is why the search covers all 360°.
- **The sun line says the sun is out of frame,** or where a sun-lit cloud is. Use it as evidence for the heading. When the sun is behind the camera, shadows still point away from it: the sun's azimuth (printed by read-photo) and the direction shadows fall in the photo give a rough heading on their own.
- **The tilt-sensor pitch is ignored when |a| is far from 1 g** (the aircraft was manoeuvring).
- **Mapped features overlap a little.** Small rings near the skyline are distant lakes, drawn in perspective.

Signs the camera is wrong:

- The model view shows a different landform: valley versus flat, the ridge in the wrong place.
- The fit printed **NOT trustworthy** or **AMBIGUOUS**.
- A mapped river, lake or main road crosses ground the photo shows as unbroken forest.
- The skyline overlay (`orient.jpg`, green) runs flat where the photo has peaks.

## 3. When the camera is not trustworthy

1. **Trace the skyline by hand.** A trace can still come back AMBIGUOUS, which is the sign to go to step 2. Read pixels with gridded crops:
   ```sh
   node --import tsx scripts/forestry/photo-matching/crop.ts <case.json> <x> <y> <w> <h> --zoom 2 --grid 20
   ```
   Coordinates are the working frame (the upright photo at 1,050 px wide). Set `skyline: { mode: "trace", points: [[x, y], …] }` with 20 or more points spread across the frame, delete `pose`, and run `orient.ts`.
2. **If the skyline is too small or too straight to fit** (one corner, one ridge), mark regions instead and run `classes.ts`:
   ```json
   "masks": { "fromY": 0, "default": "land", "polygons": [
     { "class": "sky", "points": [[240, 0], [1050, 0], [1050, 250], [245, 15]] },
     { "class": "open", "points": [[850, 730], [1050, 600], [1050, 900], [880, 800]] },
     { "class": "forest", "points": [[330, 260], [600, 260], [800, 1050], [320, 620]] } ] }
   ```
   - Classes are `sky`, `water`, `open` and `forest`. `default: "land"` labels the unmarked rest as any ground but water, for when the photo shows no water.
   - The map classes only out to 6 km (`CLASS_RADIUS`). Ground farther away counts as any ground, so mark distant hazy land as `land` or leave it unmarked.
   - The region search defaults to roll ±30° and pitch −60° to +10°; the skyline search uses roll ±15°.
   - Check each candidate with `check.ts --pose classes-1` (then `-2`, `-3`). Clearings are everywhere, so the region search only proposes candidates; stage 3 decides.
3. **If no candidate passes, say so.** Ask for control points from someone who knows the ground, the flight track, or frames shot just before and after. Never present an unchecked camera.

## 4. Pin the near ground

Within about 1 km of the camera, a GPS fix tens of metres off shows as offset outlines: a lake shore drawn above the water. Fix it with controls, not by nudging outlines.

**Do this when** the check image shows mapped features offset from the photo, or when proposals or reported features lie within about 1.5 km of the camera. Past about 2 km the GPS offset moves outlines only a few pixels: the fresh-agent test pinned the near ground of a photo whose proposals were 2–3 km away, and they moved about 10 m. Skip it there unless the check image shows offsets.

1. **Pick two or three mapped features at different distances with crisp edges.** Good: lake and pond shores, a wetland's brown opening, a road, a recent block edge. A stream is good where its water shows.
2. **Read the photo pixels on each edge from crops,** 6–13 points per feature. Put the water's edge exactly, not the beach. Each entry needs a `name`, which is how the hold-out results label it:
   ```json
   "controls": {
     "points": [{ "name": "summit", "pixel": [613, 482.5], "peakNear": true }],
     "lines": [
       { "name": "near lake shore", "layer": "lakes", "pixels": [[646, 1360], [682, 1318], [800, 1323], [960, 1351]] },
       { "name": "fen opening edge", "layer": "wetlands", "pixels": [[603, 828], [668, 832], [672, 855], [607, 858]] } ] }
   ```
   Layers are `lakes` (lakes and rivers), `wetlands`, `streams`, `ftenRoads`, `draRoads` and `cutblocks`. A point needs a `lngLat`, or `peakNear: true` for the highest ground near where its pixel lands.
3. **Solve with the lens held:**
   ```sh
   node --import tsx scripts/forestry/photo-matching/solve.ts <case.json> --hold hfov
   ```
4. **Read the held-out column.** Each group is measured with the camera solved without it, and that is the accuracy to report.
   - Judge near features in metres (the last column), not pixels.
   - Accept when the move is tens of metres (more is suspect) and the held-out errors are a few metres to about 15 m.
   - If one group stays far off when held out, its pixels or its layer are wrong; check it before blaming the camera.
5. **Adopt the camera,** then rerun `check.ts` and `overlay.ts`:
   ```sh
   node --import tsx scripts/forestry/photo-matching/solve.ts <case.json> --hold hfov --use
   ```

Never pick a control's map position automatically: a "sharpest nearby bend" pick once matched the wrong hairpin and moved the camera 750 m.

## 5. Proposals and traces

- **`overlay.ts <case.json> [proposal.geojson …]`** writes three images:
  - `overlay-outline.jpg`: solid where the camera sees the ground, dotted where terrain hides it, with the camera's provenance and held-out accuracy in the caption
  - `overlay-after.jpg`: the illustration
  - `overlay-compare.jpg`: the photo and the illustration side by side

  It also prints each proposal's area, its share in sight, its distance, and its share of the frame.
- **`trace.ts`** carries outlines drawn in the photo (`traces`) to the map as `traces.geojson`. With `compareTo` it measures them against a mapped layer, and with `views` it renders them from other viewpoints.

## 6. Compare in the visual-quality page

The page can now find the camera itself: **Find the camera (all headings)** runs the same search in the browser (`src/pages/dev-forestry/wideOrientation.ts`), with the sun shown for both candidate headings. It does not do controls, regions or the near-ground pinning; use the bench for those, then **Use a matched camera…**.

`/dev/forestry/visual-quality` can stand its road view at the matched camera:
1. In step 2's Field photo panel, choose **Line up a photo of my own** and open the photo.
2. Choose **Use a matched camera…** and pick the case file. Position, altitude, heading, pitch, roll and lens come from it, with the held-out accuracy and any warnings. A case made for another photo, a camera more than 300 m from the photo's GPS fix, and an untrusted fit are each flagged.
3. **Line up my photo** stands the road view there, with the photo over it.

Without a case file, **Taken from the air** puts the eye at the photo's GPS altitude. The heading still comes from the phone, though, so run the bench for a camera to trust. The road view walks at most 2 km off the scene's road line: draw the road or viewpoint near where the aircraft was. Nothing is uploaded; the page reads both files in the browser.

## 7. Report back

Give the person a short table:
- the camera (heading, pitch, roll) and how it was found (which skyline reader, regions or controls)
- the recorded heading's error and the sun check
- the held-out accuracy in metres
- each proposal's figures

Show the check and overlay images. Name what is still uncertain: trees in front are not modelled; the satellite imagery can predate recent harvest, and the cutblock layer is the better record of it; the near ground's accuracy depends on the controls.

## Known limits (measured)

| Situation | What happens | Do |
| --------- | ------------ | -- |
| Sunset or haze sky | The automatic reader fails; `orient.ts` falls back to a brightness drop | Nothing, or trace the skyline |
| Search centred on the recorded heading | A false skyline match can score 90% | Always the 360° default from the air |
| One straight ridge or only a corner of sky | Many cameras fit; the region search gives near-ties | Controls from someone who knows the ground, or neighbouring frames |
| Near ground (< 1 km) | GPS offset of 10–30 m is visible | Section 4, with the lens held |
| Free lens with controls at one edge | The lens narrows to chase one feature | `--hold hfov` |
| Brown openings | Mostly fens (FWA wetlands) or recent harvest, not always cutblocks | Check against both layers |
