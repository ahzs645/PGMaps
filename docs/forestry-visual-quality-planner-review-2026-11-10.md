# Visual quality: planner review, November 2026

What a BCTS planner asked of `/dev/forestry/visual-quality` in a recorded
walkthrough on 9 November 2026, measured against what the page does now. The
planner showed their own workflow: block shapefiles in ArcGIS, EVQO polygons
coloured by class, Google Earth for the eye-level screenshot, and an Excel block
report whose "Other Considerations" sheet carries a hand-written **Visuals**
paragraph. They supplied twelve of those reports (CHU_26_1–4, ML_26_1–6,
SL15_14, Summit23_4) and two block shapefiles. The reports, shapefiles and
transcript are the planner's and are not committed.

The contract for each feature is [`forestry-visual-quality.md`](forestry-visual-quality.md);
this page is the checklist against the conversation, and the list of what is
left.

## What they asked for, and where it stands

| Asked for in the walkthrough | Status | Where |
| --- | --- | --- |
| Load block shapefiles | Done. `Block_ID` in any case now names the block (it imported as "Polygon 1"), and block, licence, permit and opening are kept for the note's header | `shapeImport.ts` `planningIds` |
| Fill the block white, as in their Google Earth screenshots | Done, plus a colour per block | Step 2 *Road view → Block colours* and *Note screenshot look* (moved from step 1, 10 Nov: chosen where the screenshot is composed) |
| EVQO polygons coloured by class ("brown is partial retention, blue is retention") | Done in the road view | Step 2 *Show → EVQO polygons*; `EVQO_COLORS` |
| Stand at the viewpoint, face the block, move along the road "over the hump" | Done: drive, face a block, walk off the road, stand at a BC viewpoint or rec site | Road view bar; W A S D; *Stand here* |
| Look up a little | Done: tilt to +20° | Arrow keys, drag |
| Screenshots "going north" and "coming from the south" | Done: saved views and images are captioned that way | `viewCaption` |
| Each layer of mountain seen from the road is one landform | Done as a candidate the reviewer adopts | Step 1 *From the terrain → Ridge layer seen*; `ridgeLayers.ts` |
| The percentage of that landform the block takes up, from the view | Done: perspective alteration of the adopted landform | Step 3 run; Step 4 |
| "You can't just consider one section of the highway; as you're driving by" | Done: the run and the ridge layer read every station along the road | Corridor runs; ridge layer unions up to 8 stations |
| BCGW viewpoints and viewing-direction arrows | Done on the plan map, ranked, checked and standable | Step 1 *Viewpoints and rec sites*; `viewpointInventory.ts` |
| Weigh a viewpoint by its arrow, but consider the whole situation | Done: an aimed arrow raises a viewpoint, an aimed-away one does not drop it | `viewpointsNearBlock` |
| Several viewpoints per block (a rec site as well as the highway) | Done: the paragraph names up to two more that see the block | Step 5 paragraph |
| Roadside trees hide a lot along the highway | Done: timber screening in the run, and "may not be visible … due to screening" | Run settings; `occludedBy` |
| Old cutblocks (RESULTS openings) loaded | Done via the inventory lookup; adjacent openings are named in the paragraph | Step 1 lookup |
| The Visuals paragraph written from choices, updating as they change | Done for **Visuals**, fitted to their eight paragraphs | Step 5; `visualsNarrative.ts` |
| Adjustable eye height | Partly: a single observer height in the run settings; no standing/driver presets | Run settings |
| Report like the one a GIS person ran at Canfor: map from the viewpoint, block, licence, permit, explanation, % of the landform | Done, as Excel (their workbook's layout) or PDF (Canfor-style page) | Step 5 *Download Excel* / *Download PDF*; `blockNote.ts` |
| The route card tool assessment (constraint overlaps, Y / N / within 200 m) | **Not built** | See *Left to do* |
| Red flags as the block moves into a constraint (a fisheries-sensitive watershed) | **Not built** | See *Left to do* |
| Old Forest, Patch Size, Watershed, Arch, Migratory Bird, Fisher paragraphs | **Not built**; Old Forest and Patch Size need the LOWG analysis tables | See *Left to do* |
| Google Earth's elevation exaggeration | **Not built, on purpose**: the run and the view are 1×, so a screenshot is never steeper than the ground | — |
| Sun direction / time of day | **Not in this tool** (the viewshed page has it) | See *Left to do* |
| Screenshot before and after a redesign | Partly: design alternatives exist in step 3, but a saved view is not tied to one | See *Left to do* |
| Run ahead of time rather than loading from the ministry each time | Partly: EVQO polygons come from the bcdatamapper snapshot; viewpoints, arrows, rec sites, screenings and tenure roads are live WFS | See *Left to do* |

## How the view compares with what a person sees

- **Lens.** The road view uses MapLibre's default 36.9° vertical field of view,
  about a 35 mm lens on a 35 mm frame. A "normal" 50 mm lens is 27° vertical, so
  a block looks about 28% smaller here than in a 50 mm photograph, and Google
  Earth's default is wider still. Confirm the lens the VIA handbook prescribes
  for viewpoint photographs before adding presets.
- **Eye height.** 1.6 m, a person standing. A car driver's eye is about 1.1 m,
  which sees less over roadside screening.
- **Terrain.** AWS terrain, which in BC is about 20 m CDEM: smooth ridgelines,
  lumpy foreground. An imported LiDAR DEM changes the run's numbers but not the
  drawn ground.
- **Imagery.** Esri World Imagery to z18. Clear at middle and long range,
  blurred underfoot, as in Google Earth. The 3D timber is what makes the near
  view read as forest.
- **Haze.** Real air fades each ridge a little more than the one in front, which
  is what lets the eye pick out the layers of a mountain. *Distance haze* (off by
  default) now does this; see below.

## Distance haze

A toggle in the road view's *Show* row, off by default, and display only. Rings
draped on the ground around the eye are each faded by Koschmieder's law, haze
`= 1 − exp(−3.912 d / V)` with `V = 60 km` (`HAZE_VISIBILITY_METERS`): about 28%
at 5 km, 48% at 10 km, capped at 85%. They redraw as the eye moves about 50 m
(`hazeRings`, `driveMath.ts`).

MapLibre's sky fog was tried first and cannot do this. Its fog depth uses a
perspective matrix whose near plane is `cameraToSeaLevelDistance`, about
11.5 × the camera's elevation above sea level once the view is pitched to the
horizon. At Bear Lake (about 700 m) that puts the start of the fog about 8 km
out, and it moves with the transform's elevation residual (see `AGENTS.md`), so
the same setting hazes differently at every station.

## Landforms in the road view

*Landform* in the *Show* row (off by default) drapes the landform being assessed
(light blue) and, for a ridge-layer landform, the other bands seen from the road
(purple), so a hillside can be read against the layer it belongs to. An adopted
ridge-layer landform keeps its bands while it stays in the scene. Before this
the landform appeared in the road view only with *Analysis points* on, and the
ridge layers never did.

## Viewpoints and arrows on the map

After *Load around the block*, the plan map shows the VLI viewpoints (pink),
their arrows, recreation sites (green) and inventory screenings (teal); hover
names a point and a click stands there. Within 12 km of the selected block only;
rows the inventory types `ERROR` are left out; they are hidden in the road view
and have no legend entry yet.

## Left to do

In rough order of value to the planner:

1. **Viewpoints in the road view, and a legend**, and a way to stand at
   another viewpoint without leaving the road view (the list is on the plan
   map). Pins for the other viewpoints
   and rec sites, so standing on the highway shows where the rec site is.
3. **Lens and eye-height presets**, printed on each caption: a 50 mm-equivalent
   lens, Google Earth's, and wide; standing 1.7 m and driver 1.1 m.
4. **Draw an imported LiDAR DEM in the road view** where the run already uses it.
5. **EVQO class colours on the plan map**, as in the planner's ArcGIS map.
6. **Route card checklist and live constraint flags**: the overlap list from
   their sheet (First Nations, traplines, OGMAs, WHAs, UWRs, arch sites,
   fisheries-sensitive and community watersheds, …) as Y / N / within 200 m,
   recomputed when a block is edited.
7. **The other "Other Considerations" paragraphs.** Watershed, Arch, Migratory
   Bird and Fisher are layer overlaps the same generator can word; Old Forest and
   Patch Size need the LOWG tables from the planner.
8. **A saved view tied to a design alternative**, for before-and-after-redesign
   screenshots.
9. **Viewpoint layers in a bcdatamapper snapshot**, so a block loads without the
   live WFS. Sized below; kept live for now.
10. **Sun position**, reusing the viewshed page's solar code.

## Stored copy of the viewpoint layers: the size

Measured province-wide from DataBC's WFS on 10 November 2026, coordinates
rounded to 6 decimals, gzipped as a snapshot would be served:

| Layer | Rows | Gzipped |
| --- | --- | --- |
| VLI viewpoints | 12,396 | ~0.24 MB |
| Viewing-direction arrows | 9,164 | ~1.7 MB |
| VLI screenings | 8,914 | ~3.9 MB |
| Recreation sites | 1,527 | ~0.05 MB |
| Tenure road sections, all | 286,770 | ~81 MB |
| Tenure road sections, active forest service roads only | 10,646 | ~3 MB |

The four inventory layers come to about 6 MB in all; sharded by area like the
visual inventory snapshot, a block reads a few hundred kilobytes. The tenure
roads are only used to name the road a windfirm screen is left along: all of
them are too large to ship, and the forest service roads alone (~3 MB) miss
road-permit roads such as "DABE 2000". The options:

- **Keep live** (now): nothing stored, needs a connection, about a second per
  block, at DataBC's mercy.
- **Snapshot the four inventory layers** (~6 MB in bcdatamapper, sharded), and
  keep tenure roads live.
- **Also snapshot active FSRs** (~3 MB more), and fall back to live for permit
  roads.

Per `AGENTS.md`, a snapshot is built and published in `vendor/bcdatamapper`,
not in this repository.

**Decision, 10 November 2026: keep live.** Revisit if DataBC's WFS proves slow
or unavailable in the field.

Still wanted from the planner: more Visuals paragraph variants (the generator is
fitted to eight), the Canfor report example if it turns up, and the LOWG tables.
