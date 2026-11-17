# Matching landscape photographs to terrain (14 November 2026)

This records a trial of fitting ordinary phone photographs to the terrain, to show a proposed block or road in the photo and to carry what is drawn in a photo onto the map. It covers what the files hold, what the existing field-photo code could do with them, what had to be added, what failed, and what other people have built. It is the groundwork for extending Step 2's **Field photo** (`docs/forestry-visual-quality.md`, **Checking the view against a field photo**) into a landscape and airborne photo mode.

The test set was three iPhone 15 photographs taken from a helicopter on 16 October 2026, east of Prince George: a broad forest-and-lake view with distant mountains, a steep view down a forested slope, and a valley under a central peak. The photographs stay with the person who took them. Their coordinates are not recorded here, and every figure below was measured that day.

The trial ran outside the browser, in Node scripts that called the page's own modules unchanged:

- `photoPose.ts`: `projectToPhoto`, `cameraAxes`, `terrainSkyline`
- `skylineFit.ts`: `photoSkyline`, `terrainProfile`, `fitSkyline`
- `exifPose.ts`: `fovFrom35mmEquivalent`
- `terrain.ts`: `ElevationGrid`, Terrarium decoding

The data came from:
- AWS Terrarium terrain tiles
- Esri World Imagery tiles
- DataBC WFS layers: FWA streams, lakes and wetlands, FTEN road sections, consolidated cutblocks

A first pass ran as scratch scripts. A second pass the same day rebuilt them as a bench, `scripts/forestry/photo-matching/` (see its README), and ran every stage on all three photos. The second pass overturned one first-pass conclusion: the forest-and-lake photo's GPS position was right and its heading was wrong (see **Second pass** below). The findings that follow are the second pass's.

## Short version

- **Orientation can be recovered from the skyline.** A coarse search over 360° of heading, ±30° of roll and −50° to +5° of pitch, refined by the existing `fitSkyline`, found heading, pitch and roll in 2–13 s per photo in Node. The existing fit searches only ±3° of heading and ±2° of pitch, with no roll, around a starting pose.
- **The phone's recorded heading cannot be trusted from an aircraft.** It was 55° out on one photo and 136° out on another. The sun's position at the GPS time confirmed both fitted headings: on one the sun-lit patch in the cloud lies within about 3° of the predicted sun; on the other the recorded heading would have put the low sun in a frame that shows none.
- **A search centred on a wrong heading finds a false match.** On the forest-and-lake photo, a ±25° search round the recorded heading found a skyline fit with 90% of columns agreeing, 54° from the true heading, and flagged it trustworthy. The full 360° search found the true one at 99%. Low, rolling skylines repeat; always search every heading from an aircraft.
- **Pitch can be read from the phone.** Apple's maker note stores an acceleration vector. Read as "up", it gave pitch within about 1° of the skyline fit on both photos it could be checked on. It is useless while the aircraft manoeuvres: one photo reads 1.27 g.
- **The phone's GPS position and altitude held on both solved photos.** With the skyline's orientation and the recorded position, mapped features the fit never used landed within metres. Adding them as controls moved the camera only 24–87 m.
- **Held-out accuracy is about 5–13 m on the ground at 1–3 km.** Each feature group was measured with the camera solved without it: creek 7 m, road 7 m, pond shore 3 m, near lake shore 2 m, fen edge 8 m, harvest edge 14 m. A summit 7 km out was 29 m. Near the camera, judge in metres, not pixels: a lake shore 300 m away was first 41 px off, only about 12 m, and a 24 m forward move of the camera brought it to 2 m.
- **Outlines traced in a photo land on the map where they are mapped.** On the forest-and-lake photo, 94.5% of a harvest band traced in the photo fell inside the mapped 2023+ cutblock, and 84% of a traced fen inside the mapped wetland.
- **Control points need a person to confirm them.** One automatically chosen point, the "sharpest road bend near here", snapped to the wrong hairpin and moved the camera 750 m. Leave-one-out checks caught it.
- **A photo with only a corner of skyline and no distinctive features was not solved.** Neither the traced skyline nor regions marked sky, open and forest singled out one camera. Clearings are everywhere in this country.
- **Once the camera is known, the rest works.** A shape traced in the photo is ray-cast to the map, drawn back into the photo from the map with hidden ground left out, and shown from new viewpoints.

## The pathway

Each stage lists what it takes, what the trial found, and what PGMaps has today.

### 1. Read what the file knows

| Value                     | Where it comes from                                                       | Trust                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position                  | `GPSLatitude`/`GPSLongitude`; `GPSHPositioningError` (3.5–6.7 m reported) | Good: the solves moved it 24–87 m against a weak prior. On one photo the 24 m was forward along the flight, consistent with a fix taken before the shutter.                                                                                              |
| Altitude                  | `GPSAltitude` (above sea level)                                           | Usable from the air: it put the cameras 242, 521 and 513 m above the terrain. The solves moved it 3–21 m.                                                                                       |
| Heading                   | `GPSImgDirection` (`T` here)                                              | Not from an aircraft: 55° and 136° out on the two solved photos.                                                                                                                                 |
| Pitch and roll            | Apple maker note, tag `0x0008`, three rationals in g                      | Pitch within about 1° when the magnitude is near 1 g. Roll is not reliable in a banked turn, where the felt "up" tilts with the aircraft.                                                        |
| Lens                      | `FocalLengthIn35mmFormat`                                                 | Already includes digital zoom: one photo records 37 mm with `DigitalZoomRatio` 1.428. Apply the zoom once, not twice.                                                                           |
| Time                      | `GPSDateStamp`/`GPSTimeStamp` (UTC)                                       | One photo's GPS fix is 2 s older than its shutter, which is 34 m at the recorded 61.7 km/h. Keep both times. Do not move the position automatically.                                            |
| Orientation of the pixels | JPEG `Orientation` flag; PNG exports already rotated                      | Read the decoded image's size and rotation, not the tag's dimensions. Some PNG exports keep the unrotated size in their metadata.                                                               |

Taking the acceleration vector as "up" in the camera frame, as exiftool's documentation describes the tag:
- pitch = asin(z / |a|)
- the roll clue = asin(−x / |a|)

Ignore the vector when |a| is far from 1 g. The JPEGs' HDR gain maps are not depth.

**Today:** `exifPose.ts` reads position, heading and lens. It shows GPS altitude for reference only and always places the eye at the ground plus eye height. It does not read the maker note or the GPS time.

### 2. Recover orientation from the skyline

- **Coarse search, in angles.** Turn each photo skyline column into a ray (azimuth, elevation) for a candidate pose, and compare it with `terrainProfile` at that azimuth. Use a truncated loss, with sky below the bare ridge weighted 3×, the same rule `fitSkyline` uses. The full 360° search took about 13 s and a ±25° one about 2 s.
- **Fine search:** `fitSkyline` unchanged, around the coarse pose.
- **The sky reader is the weak part.** `photoSkyline` expects blue sky or white cloud. Under an orange sunset sky with dark cloud it stopped on cloud edges and never reached the ridge. A brightness-drop trace (the first run of 6 px below 70% of the sky just above) worked on that photo. A person tracing or correcting the skyline with a few clicks is the dependable fallback.
- **`trustworthy` is not enough on its own.** Two narrow searches on the valley photo returned fits flagged trustworthy that drew a flat line under a pointed peak. Plain agreement is a necessary check, not proof.
- **Search every heading from an aircraft.** A search round the recorded heading can lock onto a false skyline match that scores well. On the forest-and-lake photo that match was 54° out with 90% agreement, flagged trustworthy. Run the 360° search and keep the best, then confirm it with the sun or the near ground.
- **Check the result with the sun.** Compute the sun's azimuth and elevation from the GPS time and position:
  - When the sun or a sun-lit cloud is in the frame, compare positions. On the valley photo they agreed to about 2–3°.
  - When it is not, check that the fitted heading keeps the sun out of frame, as the photo shows. On the forest-and-lake photo the recorded heading would have put a sun 10.7° high in the frame.
- **Or from marked regions** (`classes.ts`), when there is too little skyline. Cast every viewing direction once from the camera, class each as sky, water, open or forest from the map, and score orientations against regions the person marks in the photo. Water is the strongest evidence: wherever the photo shows none, the camera must not see any. Open ground is weak in country cut everywhere, so check every candidate in stage 3.
- **Expect bare ground against canopy at the skyline.** At the far skylines here (20–60 km) it did not matter. Near ridges carry 20–30 m of trees, which is why `fitSkyline` ignores ridges nearer than 1 km.

### 3. Check against the near ground

A matching skyline alone proves only orientation. The check that decides whether a photo can carry a proposal is the near and middle ground.

- **Render the model view beside the photo.** Draw imagery on the terrain from the fitted camera, at half resolution in about 18 s in Node. This was the most useful single view in the trial. It showed at a glance which candidate poses were wrong, and it settled the forest-and-lake photo the moment the 360° heading was rendered: lake, pond, fen and harvest band all in place.
- **Project mapped features with their visibility.** Draw streams, roads, lakes and cutblocks with solid lines where the camera sees the ground and dotted lines where terrain hides it. Use features the fit did not use, and report their pixel error.
- **Know what the photo shows before choosing what to check against.** The brown openings in the forest-and-lake photo were mostly fens, which the FWA wetland layer outlines. The long brown band with standing snags is a cutblock harvested since 2023: in the cutblock layer, but still standing forest in the satellite imagery.

| Check on the valley photo (fit on skyline + GPS only) | Error      |
| ----------------------------------------------------- | ---------- |
| Creek (FWA stream, order ≥ 2), 6 points               | 2.5 px RMS |
| Larch-lined forestry roads (FTEN), 12 points          | 5.7 px RMS |
| Summit (highest DEM post near the photo's apex)       | 4.3 px     |
| Valley-floor ponds 4.7 km out                         | about 100 m on the ground |

### 4. Refine the camera, and measure it

- **The solver** (`solve.ts`) runs Levenberg–Marquardt over east, north, height, heading, pitch, roll and field of view. It takes:
  - the skyline, measured in angles against the terrain at each trial position
  - point pairs
  - points that must lie on a mapped line (distance to the projected line)
  - a weak GPS prior (σ 25 m horizontal, 30 m vertical)
- **Measure each control group with the camera solved without it.** That is the accuracy to report; the fitted residual is not. Held-out errors were 2–9 px (2–14 m) at 0.3–3 km on both solved photos.
- **Keep the skyline in the solve.** In the first pass, without the skyline term, groups held out landed 10–18 px off. With it, they landed 4.6–8.7 px off.
- **Hold the lens unless the controls are spread out** (`solve.ts --hold hfov`). On the forest-and-lake photo, a free lens narrowed 3° to chase the near lake shore, and the shore still sat 9 px off.
- **Holding the lens fixed the near shore with a forward move.** The camera moved 24 m, almost straight along the view, and 3 m up. The shore went from 41 px off to 4.7 px (about 2 m), and the pond, fen and harvest edges did not move. Solved without the shore, the camera moved forward the same way and the shore landed within 5.9 px. The recorded fix was 0.8 s older than the shutter (10 m at 45.7 km/h), within the stated 3.9 m GPS error. A near feature is the best test of position, because a distant skyline barely moves with it.
- **Never snap a control point automatically.** The "sharpest bend within 300 m" rule picked a different hairpin from the one in the photo, and the solve moved 750 m. A person places each pair, and leave-one-out residuals flag the bad one.
- **Do not search position while holding a wrong heading.** In the first pass, 28 labelled pixels on the forest-and-lake photo were searched over ±1.5 km of position, holding the false heading. Two wrong clusters came out 0.9 and 1.2 km away. With the true heading, the recorded position was right.
- **Haze changes the photo's colours with distance**: forest reads 15,29,26 near and 50,57,62 far. A colour rule for one distance fails at another.

### 5. Use the fitted camera

- **Photo to map:** cast a ray from a pixel and step along it until it meets the terrain (geometric steps, then bisection, with earth curvature and refraction k = 0.13). A hexagon traced on the valley photo became a 23 ha polygon 1.7–3.3 km from the camera.
- **Checked against mapped outlines.** Features traced in the forest-and-lake photo landed inside their mapped polygons:
  - the harvest band (the part in sight): 94.5% inside the 2023+ cutblock (intersection over union 0.58 with the 41 ha block, part of which is out of sight)
  - the fen opening: 84% inside the FWA wetland (0.34 with its 2.5 ha polygon, which includes wet ground round the open fen)
- **Map to photo:** test each pixel's ground hit against the polygon and fill only the ground the camera sees. This replaces today's outline with hidden parts included and the red dots taken from the nearest road station.
- **New viewpoints:** from 1 km higher, the traced hexagon was a 1.3 km strip down the valley side. From the valley road at eye level it was entirely hidden. Both are correct and both need saying in the interface: a shape traced on an oblique photo is not its shape on the ground.
- **Depth error is much larger than side-to-side error.** In that block, one pixel up or down moved the ground point about 9 m along the line of sight and under 2 m across it. Any outline traced in a photo carries an uncertainty stretched along the view.

### 6. Report what the fit is worth

Store a calibration record with the photo:
- the original metadata, kept separate from the fitted values
- the terrain and its resolution
- the lens assumption and image size
- the points used to fit and the points held back, with each one's residual
- the sun check
- whether the skyline, GPS or point pairs fixed the position

Print pixel residuals and their ground equivalents beside any figure drawn from the photo.

## Second pass: the bench on all three photos

Run with `scripts/forestry/photo-matching/`. Each photo had a local case file holding its marked skyline, regions, controls and traces.

| Stage 2: orientation    | Forest and lakes | Valley under a peak | Steep slope |
| ----------------------- | ---------------- | ------------------- | ----------- |
| Skyline reader          | automatic, 200 columns | brightness drop, 150 columns | traced, 18 points |
| Heading / pitch / roll  | 49.1° / −5.6° / 0.5° | 139.2° / −5.9° / 0.3° | not found |
| Columns agreeing        | 99% across 98% of the frame, median 2.3 px | 91% across 74%, median 1.2 px | 100% of 18, but too few to trust |
| Recorded heading off by | 55° | 136° | unknown |
| Tilt sensor's pitch off by | 0.5° (0.999 g) | 1.0° (1.008 g) | unusable (1.266 g) |
| Sun                     | out of frame, as photographed | in frame, about 3° from the sun-lit patch in the cloud | behind the camera |
| Search time (Node)      | 13 s | 11 s | 10 s |

| Stage 4: held-out error (camera solved without the group; forest photo with the lens held) | Pixels | Metres across the view |
| --------------------------------------------------------- | -----: | ---------------------: |
| Valley: creek (6 points on the FWA stream)                 | 4.9    | 7                      |
| Valley: larch-lined road (12 points on FTEN roads)         | 6.6    | 7                      |
| Valley: summit, 7 km out                                   | 6.1    | 29                     |
| Forest: pond shore (FWA lake)                              | 2.1    | 3                      |
| Forest: fen opening edge (FWA wetland)                     | 7.9    | 8                      |
| Forest: harvest band edge (cutblock)                       | 9.3    | 14                     |
| Forest: near lake shore, 300 m out at the frame edge       | 5.9    | 2                      |

**Blind rerun.** To test whether this is repeatable, stages 1–2 were run again from fresh case files holding only the photo path. With no reader named, `orient.ts` tried the automatic sky reader, then the brightness-drop reader from three starting rows:

| Photo | Readers' agreement | Result |
| ----- | ------------------ | ------ |
| Forest and lakes | automatic 99% | The same heading, pitch and roll as the guided run (49.12° / −5.62° / 0.5°) |
| Valley under a peak | automatic 45%; brightness drop 93%, 91% and 65% | The same camera as the guided run (139.23° / −5.94° / 0.25°) |
| Steep slope | automatic 75%; brightness drop 7–11% | Flagged not trustworthy and left for a person, rather than a wrong camera |

Each search took 13–117 s in Node. What stays with a person:
- a look at the model view beside the photo (stage 3)
- a line or two of control points where ground within about 1 km must be right to a few metres
- photos without enough skyline

The steep slope was searched by marked regions with the camera at its GPS position. Candidates came out near-tied:

| Candidate heading | Balanced agreement | Stage 3 verdict |
| ----------------- | ------------------ | --------------- |
| 94°  | 85.6% | Flat valley floor, unlike the photo's slope |
| 355° (near the recorded 355°) | 84.2% | Wrong: the first version put a mapped river through the photo's unbroken forest, and the second a ridge where the photo has none |

Neither was accepted. The skyline in the photo's corner is a single straight ridge, which fits many cameras.

## Third pass: the browser search on fourteen helicopter photos (17 November 2026)

Fourteen iPhone HEIC photos were taken from a helicopter over about 40 minutes, at 900–1,630 m and 41–67 knots. Lenses
were 26–52 mm equivalent, and ten of the photos are portrait. Each was run through the bench (`match.ts`) and through
the page's new search (`wideOrientation.ts`, in Node on the page's terrain: zoom 11 to 25 km over zoom 9 to 90 km).

| Outcome | Photos | Bench and browser |
| --- | ---: | --- |
| Trustworthy in both | 4 | Within 2° of heading and 0.5° of pitch. Recorded headings were 55°, 125°, 146° and 136° out |
| Ambiguous in both, same camera | 7 | Within 1.2° of heading. A runner-up heading fits about as well |
| Ambiguous in both, different cameras | 1 | Fits of 81–85% that disagree by 33° |
| No usable fit | 2 | 17–34% of columns agree; the photos look steeply down at forest |

- **The browser reproduces the bench.** On the first photo checked it gave the identical camera on the bench's own
  terrain. On the page's coarser far terrain it agreed to within 0.3° there, and to within about 2° across all four
  trustworthy photos. It took 8–23 s per photo against the bench's 33 s for that photo; the bench's full runs here took
  several minutes each.
- **The sun settles cameras.** On two trustworthy photos the predicted sun lands on the sun breaking through cloud. On
  an ambiguous one, a bright sky to the left, a backlit hillside and a mapped 2023+ cutblock on a photographed clearing
  all favour the winner over the runner-up 110° away.
- **Most of these photos are hard.** They look 15–33° down at continuous forest, with one smooth ridge as the
  skyline, and the automatic reader also takes some cloud edges for sky.
- **Neighbouring frames would help.** Two photos 3 s apart fitted 240° and 228°, both ambiguous: their agreement is
  evidence neither fit uses alone.
- **HEIC.** Chromium cannot decode these files, but `exifr` read their GPS, heading, lens, tilt sensor and GPS time
  directly. The tilt sensor was within 0.5–3.6° of the fitted pitch while it read gravity alone.

## Settling ambiguous cameras without the skyline (17 November 2026)

Points paired in the photo and on the plan, priors and a landmark, the photo laid on the plan, and a model view with an
agreement score were added to the page (see `docs/forestry-visual-quality.md`, Field photo). The options came from
route-A specifications of Pic2Map and QCALVIEW.

- **The point solve recovers the camera without the skyline.** It was tested on the real terrain under three photos.
  The pairs were mapped road and stream vertices the trusted camera sees 0.8–7.7 km out, with pixels from that camera
  plus 2.5 px of noise. Starting from the phone's heading, 85–146° out, it recovered heading to 0.05° on two photos
  and 0.3° on the steepest-down one (pitch −22°). Three pairs were enough. Held-out errors were 1–40 m on the ground.
- **The model view separates candidates.** On five photos its agreement with the photo (brightness plus edge
  correlation) ranked the skyline's winner above the runner-up every time, including three ambiguous ones. On the
  first, the margin was 0.30 against −0.06 in the browser.
- **The photo laid on the plan shows a wrong camera.** At the runner-up heading of an ambiguous photo, photographed sky
  lands on the ground behind the ridge.
- **Not yet tested:** pairs a person clicks on these photos. The pairs above were generated, not read from the photos.

## Repeatable workflow (15 November 2026)

The bench became a workflow for new photos:
- `match.ts` goes from a photo (JPEG, PNG or HEIC straight from the phone) to a checked camera, and then to an overlay of proposals.
- `overlay.ts` draws map GeoJSON proposals (blocks and roads) into the photo:
  - an outline: solid in sight, dotted where terrain hides it
  - an illustrative "after" image
  - each proposal's area, its share in sight and its share of the frame
- The skill `.agents/skills/pgmaps-photo-matching/` tells an agent how to judge each stage.

**Test by a fresh agent.** An agent given only the skill, two photos and a proposal file:
- **The valley photo:** reproduced the camera (139.23° / −5.94° / 0.25°), judged it from the check images, and pinned the near creek with its own controls. Held-out errors were 6–13 m. It then produced the overlays.
- **The steep-slope photo:** rejected it on conflicting evidence (skyline, features, shadow direction).
- **A gap it exposed:** a 26-point hand trace of that photo's single ridge fitted 100% and passed `fitSkyline`'s trust test at the wrong heading.

**The ambiguity check that followed.** `orient.ts` now also reports the best heading at least 15° from the winner, and marks the camera not trustworthy when that heading's mean loss per column is within 0.1°:

| Case | Right camera? | Gap to the next-best heading |
| ---- | ------------- | ---------------------------- |
| Forest and lakes | yes | 0.144° |
| Valley | yes | 0.138° |
| Steep slope, hand trace | no | 0.062° (now flagged) |
| Steep slope, automatic reader | no | 0.003° (flagged) |

The threshold rests on four cases. Recalibrate it as photos with known cameras accumulate.



| Photo                      | Orientation                                  | Position                  | Usable for a proposal                     |
| -------------------------- | -------------------------------------------- | ------------------------- | ----------------------------------------- |
| Valley under a peak        | Skyline (360° search, brightness-drop reader); sun in frame confirms it; recorded heading 136° out | GPS as recorded; the solve moved it 87 m | Yes. Creek and road 7 m held out |
| Forest and lakes           | Skyline (360° search, 99% agreement); sun out of frame as photographed; tilt sensor within 0.5°; recorded heading 55° out | GPS as recorded; the solve moved it 24 m forward | Yes. Pond 3 m, near shore 2 m, fen 8 m, harvest edge 14 m held out; traced outlines 84–95% inside their mapped polygons |
| Steep view down a slope    | Not found. A traced corner of skyline (18 points) fits many cameras; the region search gave near-tied candidates at 94° and 355°, and stage 3 rejected the ones checked | Not tried | Needs point pairs from someone who knows the ground, or neighbouring frames |

LiDAR status (LidarBC's progress layer, read through the road designer's `lidarBcStatus` query):
- **Forest-and-lake view:** bare-earth LiDAR published (2023 and 2024).
- **The other two:** flown in 2024 and not yet published.

The trial used Terrarium terrain throughout:
- z13 near the camera (about 11 m posts at this latitude)
- z9–z10 out to the skyline (90–180 m posts), which flattened the summit by a few pixels

## What others have done

### Research methods

| Work | Method | What it tells us |
| ---- | ------ | ---------------- |
| Baboud, Čadík, Eisemann & Seidel, *Automatic photo-to-terrain alignment for the annotation of mountain pictures* (CVPR 2011) | Matches the photo's edges to silhouette edges rendered from the DEM, given a viewpoint and field-of-view estimate, with a metric built to tolerate cloud, snow and forest | The reference method for orientation from terrain silhouettes, including the inner ridges, not just the skyline; qualitative results on 28 photos |
| Produit, Tuia, Lepetit & Golay, *Pose estimation of web-shared landscape pictures* (ISPRS Annals II-3, 2014); Produit et al., *Pose estimation of landscape images using DEM and orthophotos* (2012) | Horizon matching by dynamic time warping against the DEM for geotagged photos; DEM rendered with an orthophoto as reference | The same idea as stage 2; dynamic time warping tolerates a skyline partly hidden by trees or cloud |
| Brejcha & Čadík, GeoPose3K (2017); Brejcha et al., LandscapeAR (ECCV 2020); CrossLocate (WACV 2022) | Datasets of Alpine photos with known pose; learned descriptors that match photos to textured DEM renders | Where learned matching helps (automatic point pairs between the photo and the model view); a test set if one is needed |
| Lalonde et al., *What do the sun and the sky tell us about the camera?* (IJCV 2010); *Find your way by observing the sun* (2016) | The sun's position as a compass, given the time and a rough location | Supports the sun check in stage 2 |
| Bozzini et al., *A new tool for obtaining cartographic georeferenced data from single oblique photos* (CIPA symposium paper) | The WSL Monoplotting Tool's method: camera from DEM control points, rays to the DEM | The standard monoplotting workflow |
| Monoplotting accuracy study (IJGIS 2021, WSL tool); Miller, *Practical considerations in mapping from oblique air photographs* (PE&RS 1938) | Measured, not estimated, errors of points and polygons from oblique landscape photos | DEM resolution, placement of control points and the angle of incidence drive the error. Single-ray plotting degrades fast below about 30° depression or past about 3 miles. Our depth-versus-side figures agree |
| Golparvar & Wang, *AI-supported framework of semi-automatic monoplotting* (arXiv 2111.14021) | Keypoint matching to propose control points | Automating point pairs, with a person confirming them |

### Tools

| Tool | What it does | Licence and what PGMaps may take |
| ---- | ------------ | -------------------------------- |
| [WSL Monoplotting Tool](https://www.wsl.ch/en/services-produkte/monoplotting-tool/) | Desktop monoplotting: camera from control points against a DEM, digitising in the photo onto the map and back. Used for natural-hazard photos | Shareware, free for non-profit use without modification. Not open source: ideas only |
| [QCALVIEW](https://plugins.qgis.org/plugins/QCALVIEW/) ([docs](https://qcalview.com/)) | QGIS plugin: viewpoint calibration, projected vector and raster overlays, schematic views; QGIS 3.44 and 4 | GPL v3 or later: ideas only under this repository's licensing rule |
| [moniQue](https://github.com/smfloery/moniQue) | QGIS plugin: monoplotting of oblique images with uncertainty estimation; fits position, orientation and focal length from correspondences | No licence file in the repository. QGIS plugins are published under the GPL. Ideas only |
| [Pic2Map](https://github.com/tproduit/pic2map) ([docs](https://documents.epfl.ch/groups/l/la/lasig-unit/www/pic2map/documentation/index.html)) | QGIS plugin from EPFL (Produit and Tuia): pose from control points or a virtual 3D view, picture and map interaction | No licence file; QGIS plugin. Ideas only |
| [Mountain Image Analysis Suite](https://github.com/MLP-Hub/MLP_IA_Suite) ([announcement](https://mountainlegacy.ca/2024/10/09/mountain-image-analysis-suite-mias-a-new-plugin-for-converting-oblique-images-to-landcover-maps-in-qgis/)) | Mountain Legacy Project (UVic) QGIS plugin: landcover classification of oblique photos with a segmentation network, then monoplotting by aligning to a virtual photo from shaded relief with control points | No licence file; QGIS plugin. Ideas only. A 2026 UVic test on Victoria repeat photographs found the classifier needed heavy manual correction, foreground trees and photo–DEM date mismatches caused errors, and the models needed more training |
| [Smapshot](https://smapshot.heig-vd.ch/) ([API source](https://github.com/MediaComem/smapshot-api)) | Web platform (HEIG-VD, Cesium globe): volunteers click at least six photo-to-globe correspondences; the server solves the pose, rejects it above an error threshold, and an archivist checks it visually. Its papers report tens of thousands to over 200,000 images georeferenced, depending on the date | The API is **BSD-3-Clause** and has a pose-estimation endpoint. It is the closest precedent for a browser workflow, and the only one here whose code could be adapted, with its notice |
| [photogeoref](https://meteoexploration.com/python/photogeoref/index.html) | Python script that georeferences oblique photos to a DEM; used for avalanche and glacier mapping | Licence not checked; ideas only until it is |
| Skaloud & Vallet (EPFL) | Helicopter handheld camera with GPS and IMU for avalanche mapping; forward resection once the system is calibrated | What a capture setup with real attitude data removes from the problem |
| [PeakFinder](https://www.peakfinder.com/mobile/camera/) | Phone app overlaying a computed panorama on the camera view for the user to line up | The interaction model: drag the computed skyline onto the real one |

### Practice in visual assessment

- **BC's Visual Impact Assessment Handbook (May 2022)** asks for simulations from significant viewpoints checked against the viewpoint photograph (3.3.4): location, view direction, focal length, tree heights, past alterations. It describes laying a DEM-generated view over the photo to place proposed alterations. That is stages 3 and 5 here.
- **BC visual impact assessments have long been built in [Visual Nature Studio](https://3dnature.com/?p=1314)** (3D Nature; earlier World Construction Set). It has a forestry edition that reads stand attributes from GIS. Recent community-forest assessments describe a TRIM-based terrain model in VNS compared with viewpoint photographs, and the 1997 guidebook's percent alteration.
- **Wind-farm photomontage practice is the most codified camera-matching standard.** [NatureScot's *Visual representation of wind farms*](https://www.nature.scot/visual-representation-wind-farms-guidance) is prescriptive about photography, lens, wirelines from the terrain model, and matching the model to the photograph. The technical-methodology appendices of Scottish applications show the workflow step by step. The Highland Council's visualisation standards add to it.

## Building it in PGMaps

In order, each a self-contained step. The bench in `scripts/forestry/photo-matching/` is a working reference for steps 1, 2, 3, 5, 6 and 7, and its `classes.ts` for the region search:

1. **An airborne mode in `exifPose.ts`.** Place the eye at GPS altitude when the person says the photo was taken from the air. Read the maker note's acceleration vector, keeping its magnitude. Read the GPS time beside the camera clock. Use the decoded image size. All of this is DOM-free and unit-testable from tag fixtures.
2. **A wide orientation search** ahead of `fitSkyline`: the coarse angle-space search above, run in a worker. Seed pitch from the acceleration vector when its magnitude is within a few percent of 1 g. Search heading over 360° whenever the photo is airborne or the compass is untrusted. *Built 17 November 2026* as **Find the camera (all headings)** (`wideOrientation.ts`; see `docs/forestry-visual-quality.md`). It also reads the tilt sensor and the GPS time (`exifPose.ts`) and shows the sun for both candidate headings, which is part of step 3.
3. **A sun check**: a DOM-free solar-position function, and a click on the sun or a sun-lit cloud to compare with it.
4. **A skyline the person can trace or correct**, beside `photoSkyline`, for haze, sunsets and windows.
5. **Point pairs placed by a person**, through the shared sketch (`map-sketch.tsx`) on the plan and a click in the photo. Solve with the skyline's orientation held unless enough well-spread pairs free it. Report leave-one-out residuals, in pixels and on the ground.
6. **Visibility from the photo's own camera**: replace "the nearest analysis station sees" with a ray test from the fitted eye, and fill the block's seen ground rather than outline it.
7. **Photo to map**: trace in the photo and ray-cast to a polygon, kept as a candidate the reviewer adopts, with its along-view uncertainty shown.
8. **A model view beside the photo**: the road view's map standing at the fitted camera is the natural place, since it already draws the stand, blocks and imagery.

Constraints from `AGENTS.md` that apply:
- Keep the geometry (`photoPose.ts`, `skylineFit.ts`, `exifPose.ts` and any new pose solver) free of DOM and network access.
- Any pitch handed to the drive camera goes through `horizonSafePitch`.
- An airborne eye may sit far from the road line and outside the road view's loaded terrain, so it cannot reuse `standAt`'s 2 km walk.
- Licence rule: no code from the GPL or unlicensed tools above; Smapshot's API is BSD-3.

## Taking photographs for this

- Keep the original files: HEIC or JPEG straight from the phone, not shared or edited copies.
- Include the skyline and two or three sharp features in the middle distance: a road junction, a lake shore corner, a block corner.
- Take a few frames of the same scene a second apart. Neighbouring frames give point pairs and a check.
- Shoot through an open window or a clean, unreflective panel. Reflections covered the sky of one photo here.
- Record the flight track (any GPS logger or a phone track app). It answers the position question that sank the forest-and-lake photo.
- Avoid steep banking while shooting, so the phone's tilt reading stays usable.
