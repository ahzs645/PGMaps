# Forestry visual quality — work log, September 2026

What was built on `/dev/forestry/visual-quality` over this round, what was
discovered on the way, how it was checked, and what is still open. The
contract for how the page behaves is `forestry-visual-quality.md`; this is the
record of how it got there and why.

## 1. The sidebar follows the VIA handbook

**Built.** The sidebar was rebuilt around the five steps of the BC *Visual
Impact Assessment Handbook* (2022): identify, visit, design and simulate,
assess, rate. `via.ts` holds the handbook's rules — Table 1's ocular class,
Table 2's ranges as printed, the six Table 3 design elements, Tables 4 and 5
(roads, retention), the adjusted figure `X·(1 + 0.14·Y)`, and the Table 7 final
rating. A headline at the top shows the objective, the measured X, the
adjusted figure and the rating.

**Then made into tabs.** Stacked as folding sections the sidebar ran to about
four screens on load and eleven with every step open. The steps are now tabs
pinned under the headline (`TabBar` with `StepMarker`s), one step on screen,
every panel kept mounted so nothing typed is lost. Each job was given one
place: drawing and importing the road and blocks (three places before), one
*Look from the road* (two before), playback on the road-view panel only (it
was repeated in the sidebar), and no unlabelled header icons.

**Discovered.**
- Judgement calls the handbook leaves open were settled and documented: the
  ocular class is always the reviewer's; Table 2 is read as printed, not from
  the editable planning thresholds; "near a boundary" for Table 7 is the top
  20% of a range (a tool convention).
- The run's readiness ("numerical fields available" or provisional) was only
  shown in step 5; it is now under the run button in step 3 as well.
- A usability pass by a subagent working as a first-time user found the
  remaining friction: duplicated controls, a road-view panel covering most of
  a phone screen, a phone sheet button that swallowed taps, contradictory
  copy. Those were fixed; see §8 for what is still open.

## 2. Map scale

**Checked.** The question was whether the maps' scale was right. It is:
MapLibre's projection gave 5.510 m per pixel at Tabor Mountain against 5.522
from the new scale bar; the stand's metres are converted per stem's own
latitude; and a terrain skyline computed from the DEM landed a median 0.5 px
(0.04°) from the one MapLibre drew, 90th percentile about 1.1°, on the far
hills where MapLibre draws coarser tiles.

**Built.** There was no scale bar anywhere. `MapScaleBar` (shared,
`map-controls.tsx`) measures great-circle distance across the map's middle as
MapLibre's own control does, and hides above 60° of pitch.

## 3. Driving the view

**Built and tested** on straight roads, a 90° curve, an S-curve, a hairpin,
a coarse GIS road with 35° kinks, and a 24% climb (`driveCurves.test.ts`, plus
GPU Chrome runs recording every frame).

**Discovered.**
- The eye sat 0–2.7 m above the drawn ground, and below it on a 39% slope.
  MapLibre's terrain renderer reads a DEM sample at its pixel's corner; the
  analysis grid reads it at the centre. `renderedGroundSource` reproduces the
  drawn ground for the preview (0.00 m mean difference) while the analysis
  keeps its own reading.
- A map pitch of **exactly 90°** — a photo lined up looking level — crashes
  MapLibre's GPU process with 3D terrain on. Every pitch now goes through
  `horizonSafePitch`, 0.1° short.
- Calling `map.project()` every frame under 3D terrain crashed the renderer;
  measurement harnesses must not do it either.

## 4. Field photos (Mapillary)

**Built.** Step 2 can line the road view up with a street-level photo: search
along the road for photos facing the block, read the photo's pose from
Mapillary's reconstruction (OpenSfM angle-axis rotation, focal length as a
fraction of the longer side), set MapLibre's field of view to the lens, and
overlay the photo with the terrain skyline and the block drawn in its pixels.
Also: automatic skyline alignment (`skylineFit.ts`), 360° panoramas cut to a
view facing the block, and a street-photo inset while driving.

**Discovered.**
- Mapillary's rotation reproduces its own compass angle to 0.001° (pinned in a
  unit test on a real image); the Hart Highway GoPro was mounted 12.3° nose-up.
- The first comparison exposed what the illustrative forest got wrong: timber
  drawn across the Crooked River, and a 20 m roadside clearing hiding a
  highway's wider right-of-way. Water and the road's class now come from the
  basemap's own tiles (`basemapContext.ts`).
- Automatic alignment needed several fixes to be trustworthy: trees above the
  terrain (a canopy band), dashboard visors (start at the first clear sky),
  cloud edges, hazy ridges, and near ridges (skipped under 1 km). It declines
  rather than guesses when too little sky agrees.
- Only the **client token** is used, in the git-ignored `.env.local`. No
  client secret is stored or needed.

## 5. Resolution, retention and partial cuts

**Discovered.** A 12 ha opening on Tabor Mountain read 0% one run and 3.9% the
next: its share of the landform moved in whole cells of the shared grid. The
run now withholds X when a proposal covers fewer than 8 cells and says what
sample budget would do.

**Built.** Each block has a harvest system. *Dispersed retention* stays
measured as cleared ground and feeds a measured Table 5 level. A *partial cut*
is left out of the cleared-ground ledger and its Table 6 clearcut equivalent
(from volume removed and residual height) is added to X when the road sees it.
The road view thins the stand for both instead of clearing it.

**Judgement call, open to review.** The handbook adds Table 6's figure whole,
without scaling it by the cut's size; the tool does the same, so a small
partial cut on a big landform is charged the full figure.

## 6. Forest density, from the inventory

**Discovered.** The drawn forest was wrong in both directions. Crowns were
0.34 × height — nearly 9 m on a 26 m spruce — so the stand beside the road
closed to about 80%, a wall; coarse far bands widened crowns by fixed factors
and closed to only 10–25%, so distant hills looked bare. VRI around Prince
George says mature stands are 430–660 live stems/ha at 45–50% crown closure,
21–26 m tall, spruce-leading (the beetle took most mature pine).

**Built.**
- Each stand is drawn at its own VRI stems/ha and crown closure, or
  `REGIONAL_STAND` (550 stems/ha, 45%, 25 m) where the inventory says nothing;
  species mix from VRI, with paper birch added.
- Crown width comes from closure (`crownWidthForClosure`), corrected for the
  jittered grid and the stem-height spread: rasterised at 0.5 m, 45% draws as
  44–46% in every band, 25% and 60% within 2 points.
- Bands 4 m to 300 m (stem for stem), 9 m to 600 m, 24 m to 3 km, 80 m beyond;
  the far two draw **clump cards** (several whole trees per card) instead of a
  stretched tree; a dark forest floor is draped under the stand so gaps
  between far cards read as shade, not basemap; bands dither against
  complementary noise at their seams.
- Birch bark no longer tinted pink; the dark fringe around crowns fixed by
  premultiplied texture upload.
- **Viewing gap.** Facing a block from the road showed only roadside trees.
  The stand now leaves a wedge open toward the block, culled in the shader so
  it can follow the eye without regrowing the forest. A drawing aid; no number
  moves.

**Tested** by a subagent in GPU Chrome over two rounds (screenshots, closure
measured from above, frame rate): 45–55 fps with 150–230 k stems.

## 7. Landforms

**Discovered.** The percent-alteration logic was right; the landforms fed to
it were not. The roadside demo's "landform" was a box barely bigger than its
block (the clearcut read 96.6%), and the Tabor sample's is a 7 × 6 km box
taking in the lake and more than one face.

**Built.** *Suggest the landform from the terrain* (`landformFromTerrain.ts`):
grows the face the block sits on until the ground turns away from the road
(ridge, skyline, flank), flattens below the block (valley floor), meets a
drainage over 3 km² or mapped water. Benches are bridged only where there is
face above and below in opposite directions, so saddles are not. A road within
1.5 km reads facing as one bearing. It is a candidate: shown dashed, adopted
on a click, replacing the assessed landform with an undo.

**Tested** by a subagent on eight real places around Prince George over four
rounds (knoll, summit, College Heights and Fraser escarpments, Cluculz Lake
shore, a road across a face, Tabor, the demo). Final: correct on six. Tabor
Block A's face (2,298 ha) and a road laid across it (2,490 ha) still run to
the 5 km search limit; the panel warns on both.

**The roadside demo** has no landform now: the terrain finds its block on the
valley floor. It opens straight into the road view.

## 8. Still open

- Tabor's terrain landform still runs to the search limit; its ends need
  setting by hand.
- Dithered fades between forest bands still show dotted "ghost" trees at the
  seams while crossing them.
- The Tabor sample keeps its box landform; swapping in the terrain outline
  would change a sample the tests depend on.
- The field-photo e2e test takes about 2.4 minutes against a 3-minute limit.
- Map dots drawn after a run are explained only in the folded design review,
  not in a map legend.

## 9. Verification at the end of the round

- Unit: 1,146 tests across 105 files.
- End-to-end: the two forestry suites, 26 tests (`forestry-visual-quality`,
  `forestry-integrity-export`). Steps are tabs, so tests bring a step forward
  with `showStep` before touching its controls.
- Typecheck, lint (no errors) and the production build.
- Independent subagent passes: an adversarial code review of the density and
  landform code (11 findings, all fixed), GPU rendering checks (two rounds),
  real-terrain landform checks (four rounds), and a first-time-user usability
  pass of the new sidebar.
