# Own photos in the visual-quality tool: redesign proposal (17 November 2026)

**Status:** Pieces 1–8 built and on `main`, 17 November 2026; piece 9 (photo simulation) not built. What is still open after the build is in section 6.

A proposal, not a contract. It covers `/dev/forestry/visual-quality`'s *Line up a photo of my own* window: how photos come in, how a camera is found and accepted, what is drawn over the photo, how the photo shows on the plan, which renderings it is compared with, and how one photo or many become viewpoints and other evidence. It was worked out against a real set: fourteen iPhone HEIC photos from one helicopter flight (about 45 minutes, 900–1,630 m above sea level, five bursts 2–20 s apart, 26, 33, 37 and 52 mm-equivalent lenses), the nearest 28 km from the scene's road. No coordinates are recorded here.

Code references are to `main` at `844a64fc`.

## 1. What happens today, and where it stops

- **One photo at a time.** The chooser takes one file (`OwnPhotoDialog.tsx:631`, `multiple={false}`). Only the EXIF reading and the starting pose are automatic (`openOwnFile`, `useFieldPhoto.ts:1151`).
- **Every tool waits for a click.** The skyline search (`findCamera`, `PhotoCameraTools.tsx:152`), the model views (`renderModel`, `:347`), the photo on the plan (`showOnMap`, `:398`), the runner-up, the point solve and the skyline overlay all run only on a click. Only the skyline search runs in a worker; the model view and the drape run on the main thread.
- **The job ends at a disabled button.** The footer's primary action is *Line up in the road view*. The road view walks at most 2 km off the road line (`MAX_WALK_METERS`, `driveMath.ts:107`), loads terrain only round the road (`useDriveTerrain.ts`), clamps a fixed look's pitch (`driveController.ts:260`), and is always placed with roll 0. A helicopter camera can be found and checked, but used for nothing.
- **Nothing is accepted.** The steps say what the camera rests on, never that it is right (`ownPhotoSteps.ts`), and nothing records that the reviewer looked and agreed.
- **Little survives a reload.** The project archive keeps the open photo's name and pose (`projectArchive.ts`). The sources, the search, the runner-up, the model-view scores and the pairs are dropped. A reopened photo labels every value "from the field record" even when it came from none (`useFieldPhoto.ts:1217-1226`).
- **A photo is not a viewpoint.** Step 2 lists *Field photos* apart from *Views of interest* and *Saved views*. A field record's *Add the photo's place to the views of interest* makes a 50 mm view facing the block, which throws away the heading, pitch, altitude and lens that were found (`ToolFieldPanel.tsx:374`, `viewAtPoint`).
- **Photo on the plan hides the photo.** It closes the window (`PhotoCameraTools.tsx:396` → `closeOwnDialog`). It draws once at a fixed 0.85 opacity, through the page's own `map.addLayer` (`DevForestryVisuals.tsx:2712`, against the forestry toolkit rule), and flies the plan to the drape, 28 km from the scene for this flight. It stops at 8 km (`photoViews.ts:137`): from 1,200 m at −6° the centre ray lands about 11 km out, so the upper frame, where the scene is, is left bare. It does not follow a nudge, shows one candidate at a time, and has no legend row.
- **What is drawn over the photo is thin, and partly wrong for air photos.** The window draws only the skyline. The road-view overlay also draws block outlines with their hidden parts as if in sight, red "seen" dots from the nearest road station's eye 1.5 m up (meaningless from a helicopter), and colours typed by hand (`FieldPhoto.tsx:283-291`).

## 2. The target workflow

```
Add photos ──► automatic queue ──► options card ──► check ──► accept ──► use
 (many, any     EXIF, terrain,       winner,          overlays,   records    viewpoint,
  order)        skyline search,      runner-up,       plan,       evidence   before image,
                model views,         neighbour,       compare                field evidence,
                features check       phone heading                           regrowth, …
```

Nothing is accepted automatically; everything before *Accept* is done for the reviewer.

### 2.1 Add photos, and the automatic queue

- The chooser and drop zone take many files. Each photo becomes a `FieldRecord` (kind `photo`) at once, so it survives a reload through the assessment tools' storage and the project file; the original bytes stay as the attachment (the record's image is a re-encoded JPEG). Photos are grouped into a **flight** by time (a gap over 5 minutes starts a new one) and ordered by GPS time, falling back to the camera clock.
- A queue in `useFieldPhoto` (it must outlive the window, which `DialogShell` unmounts while hidden) runs one photo at a time, in time order, cancellable:
  1. decode and EXIF; lens check (below);
  2. terrain for the photo's place;
  3. the 360° horizon profile (move `terrainProfile` into the worker; it runs on the main thread now);
  4. read the photo's skyline, search every heading → **the options card appears here**;
  5. model views for the winner and the runner-up, scored (move `renderModelView` into a worker);
  6. a features check (lakes, roads, recent cutblocks drawn into the photo) where the data loads.
- **Caches become maps**, not one slot each: terrain and imagery keyed on tile range (burst frames share them), the horizon on position (4 dp) and altitude, pixels and the read skyline on record id, results on record id + pose inputs + priors. One terrain mosaic for the whole flight is the better form.
- **Bursts seed the next frame.** For a frame within 20 s and about 500 m of an accepted neighbour, first search narrowly round the neighbour's camera (heading ±15°, pitch ±10°). A trustworthy narrow fit may skip the 360° search; an ambiguous one always runs it, because a prior hides runner-ups outside it (`wideOrientation.ts:48-50`). Two frames 3 s apart agreeing is evidence neither has alone, and the card says so; a disagreement is flagged.
- **Lenses.** `FocalLengthIn35mmFormat` already includes the iPhone's digital zoom (33 and 37 mm here), so it is applied once. A photo cropped after it was taken (decoded size ≠ `PixelXDimension`) is flagged *cropped: lens unknown*, and the search needs a field-of-view range for it, which `WideSearchInput` lacks.
- **States on each frame:** queued, searching, options ready, checked, accepted, failed; with reasons *not settled*, *no skyline*, *outside terrain*, *cropped lens*, *phone heading only*, *disagrees with frame N*. *Far from the road* becomes a note, not a block.

### 2.2 The options card, and adjusting

One row per candidate: the winner, the runner-up, the phone's heading (marked "from an aircraft can be far out"), a neighbouring frame's camera (with its time gap), and a point-solved or matched camera when there is one. Each row: heading, pitch, roll; agreeing sky columns and span; model-view score; the sun check; a model-view thumbnail; *Use* and *Adjust*. The ranking comes from the evidence.

*Adjust* opens the hand tools now on the Direction tab: the numbers, held angles, paired points, the matched-camera file. Two additions from other tools:

- **A paired-point table** with each pair's residual in pixels and in metres on the ground, on/off per pair (an off pair is still drawn, as a check point), and fix/free per angle; the user's point and the solved point drawn on both photo and plan (WSL Monoplotting Tool, Pic2Map).
- **Drag-to-align** as the hand fallback: drag the drawn skyline by a centre cross, rotate it by handles at the sides (PeakFinder/PeakVisor). It writes heading, pitch and roll and hands over to the solver.

### 2.3 Check: what is drawn over the photo

The foundation is a **hit buffer**: one worker pass casting a ray from each working pixel (about 525 px wide) to the ground, storing longitude, latitude, distance and elevation (`castRay`, `photoViews.ts:42`; march each de-rolled column upward from the hit below, since a higher ray cannot meet ground first). With it:

- **Occlusion.** A projected vertex is in sight when its depth is no more than its pixel's hit distance × 1.03 + one cell (the rule `drapePhoto` already uses). Hidden parts are dotted, as the bench draws them.
- **Layers on the photo**, a `ToolbarPopover` of `OptionRow`s under the photo. On by default: skyline, proposed blocks, recent cutblocks and openings, lakes. Off: landform, sensitivity units, EVQO, private land, rock, sub-landforms and lines of force (drawn only, never adopted), streams, roads, VRI, inventory viewpoints and views of interest as markers. Styled from the figure style's symbols (`areaSymbolOps`, `lineSymbolOps`), so the photo and the sheet look the same; labels through `labelOps`.
- **Reading aids**, off by default: horizon line, bearing ticks every 5°, distance contours from the hit buffer (1, 2, 5, 10 km; not called fore/middle/background until those distances are a cited constant).
- **Click the photo to read the map**: distance, elevation, slope, and the block, VRI stand, sensitivity unit or EVQO under that pixel (tested with `preparePolygons`), with a pin on the plan. Hovering a layer row tints its pixels in the photo. A clicked spot can become a paired point.
- **The features check** is the strongest test of a camera from the air: lakes should sit on water, roads on roads, recent cutblocks on clearings (the photo-matching skill's step 2). The photo's layers need their own read, bounded by what the camera sees, not the scene: this flight looks 5–30 km past the scene's data. `queryVisualInventory(bounds)` and `fetchVegetationStands` already take any bounds.
- **Fixes on the way:** hide or relabel the red dots for a photo with an altitude; dot the hidden parts of outlines; take outline colours from the `proposedBlock` symbol.

Drawing happens in the photo's own pixels (SVG for lines and labels, one canvas for tints), not through MapLibre: `captureAtCamera` forces roll 0, MapLibre has no lens distortion, and it cannot stand at the aircraft.

### 2.4 Check: the photo on the plan

- **Keep the photo beside the plan.** Replace *close the window* with a docked photo pane (grow the pick-reference corner panel into a resizable pane, or a *Photo* tile in `TiledWorkspace`), its state in `useFieldPhoto`.
- **A component, not page code.** A `PhotoDrapeLayer` mounted in plan mode like `MapViewerCone`, with `opacity` and `visible` props, and an opacity slider and hold-B blink against the imagery in its card. No automatic `fitBounds`: *Show the photo's ground* and *Back to the scene* buttons instead.
- **Three looks**: the filled drape; *edges* (the photo's edges draped in one bright colour, so the imagery stays readable, the most telling check from the air); *footprint only* (the frame polygon `drapePhoto` already traces from its edge rays). Ground hidden by terrain gets a faint hatch, so it is no longer the same as out of frame, labelled "terrain only, not the run's visibility".
- **Linked cursor**: hovering the plan puts a crosshair on the docked photo (`projectToPhoto`); hovering the photo puts a marker on the plan (`castRay`). Hover takes no clicks, so it needs nothing from `PlanClickToMove`.
- **Live**: the drape runs in a worker, posts RGBA and updates the source with `updateImage`; debounced at about 60k cells while values change, full size once settled; until then the card says "drawn for heading X°, now Y°".
- **Winner and runner-up** as two drapes behind a segmented toggle; blinking between them settles a *not settled* result.
- **Range from the frame**: the far edge's hit, capped at the 25 km zoom-11 terrain, fine to 8 km and coarser beyond.
- **Several photos**: camera markers with view cones (`MapViewerCone`, length set to the frame's far hit), a dashed flight track in time order, footprints for all, a drape for the active one (or a picker: show, solo, opacity). A click on a camera opens that photo.
- **Legend**: `photo:drape`, `photo:footprint`, `photo:camera`, `photo:track`, `photo:pair` as `PlanLegendKey`s with rows; the drape's row holds its opacity. Never in the project file (it rebuilds from the pose), never on report maps (their own hidden map).

### 2.5 Which renderings to compare

| Question | Pairing | When |
|---|---|---|
| Is the camera right? | Skyline and layers on the photo; photo blinked or swiped against the model view at the same size; edges drape on the plan | Default |
| Camera *not settled* | 2×2: photo, model view (winner), model view (runner-up), their difference | Only then |
| Does the simulation look like reality? | Photo against PGMaps' eye-level view at the photo camera, before harvest, drawn timber, same lens | After acceptance, near the scene |
| VIA before/after | `reportPairs.ts`: the photo is *existing*; the after is one renderer's, never mixed | Reports only |

One overlay with blink and swipe is the default; a grid only for the ambiguous case, where pixel alignment is judged better overlaid than across panels. Noise for an aerial photo far out: external engines (`captureTerrain` covers 12 km round the eye and the stand exists only round the scene), a class pass against the photo, model view against road view.

### 2.6 Accept

A DOM-free `photoAcceptance.ts`, stored on the photo's record:

- **Gate.** *Accept* is enabled only once the check images have been drawn for this exact camera (within `ownPhotoSteps`'s 0.5°). A point-solved camera with a held-out pair over a set residual is refused, as Smapshot refuses validation. A *not settled* fit needs a written note.
- **Record.** Who (typed initials; never the profile printed directly), when, the method (skyline, points, matched, neighbour, phone, typed), the pose and each value's source, and the evidence: agreeing columns and span, settled or not, the runner-up and its heading gap, model-view scores for both, the sun check, held-out metres, neighbour agreement.
- **Lapse.** Moving the pose afterwards lapses the acceptance and says so.

### 2.7 Use: one photo, several jobs

One record holds the bytes and the acceptance; every job is a link to it, never a copy (`view.photo.recordId`, `record.viewId`, and a new `record.uses[{ job, targetId? }]`).

| Job | Carried today | Needs |
|---|---|---|
| VIA viewpoint or key viewpoint | `ViewOfInterest`, `KeyViewpointFields` | a `photo` link with altitude, pitch, roll and lens (below) |
| Ground conditions | `FieldRecord` kind `photo`: notes, annotations, `viewId` | a block or target link; no accepted camera needed |
| Before image of a before/after pair | `reportPairs.ts` (`source: 'photo'`) | the view's photo link, so its capture takes it |
| Check against the drawn forest | the road-view overlay, `alignmentChecked` | a stored check: saved view, date, note |
| Green-up or regrowth over time | `captured` (a date only) | the full time, an opening link, grouping by place and bearing; evidence for the reviewer's field override, never the green-up check itself (that stales the run) |
| Landform or sensitivity-unit evidence | `ViewOfInterest.landformId` only | `targetIds` or a unit id, linked by the reviewer, never verified automatically |

**A photo viewpoint.** An accepted camera becomes a view of interest with an optional `photo: { recordId, altitudeMeters, pitch, roll, hfov }`, keeping `source.kind: 'map'`: `parseViewsOfInterest` skips unknown kinds (`viewsOfInterest.ts:337-343`), so a new kind would be silently dropped by an older PGMaps. Altitude, pitch and field of view join `viewCaptureKey`, so a re-accepted camera stales its capture. Standing there goes through `standAtPlace` (already independent of the 2 km walk) with `surveyedEye` set to the altitude (a run input up to 9,000 m already), pitch through `horizonSafePitch` and an explicit roll; its terrain may reach further at a coarser zoom within the same tile budget. `lineUpOwnPhoto`'s separate spot stand is retired. Only the frames the reviewer chooses become viewpoints (`MAX_VIEWS_OF_INTEREST` is 12; this flight has 14 photos); the rest stay evidence.

BC's photo documentation (MFLNRO's visual effects guidance, following the forest VIA approach) asks a viewpoint to carry: number and name, photo IDs, coordinates, elevation, a map mark to 50 m, bearing to the centre of the development, vertical angle, 35 mm-equivalent focal length, date, a description, an importance class and the conditions. Most come straight from the accepted camera; the rest belong in the view's record fields.

### 2.8 The window's layout

- **Tabs**: *Photos* (a strip sorted by time, a status dot per frame, one active), *Camera* (the options card, *Adjust* behind it), *Use* (the jobs).
- **Hidden by default**: latitude, longitude and altitude fields, declination, the angle and lens numbers, held angles, the matched-camera upload: all behind *Adjust*.
- **The footer's primary action follows the state**: no photos → *Add photos*; searching → *Searching 3 of 14* (Cancel); options ready → *Check this camera*; checked → *Accept camera*; accepted → *Make a viewpoint*, then *Stand here*; then *Next photo*.

## 3. Order of work

| # | Piece | Effort | Unblocks |
|---|---|---|---|
| 1 | Each photo a `FieldRecord`; fix the reopen labels; multi-file chooser and the strip | S–M | everything with more than one photo |
| 2 | Worker hit buffer; model view and drape in workers; caches as maps | M | 3, 4, 5, the queue |
| 3 | Automatic queue and options card, burst seeding, lens checks | L | |
| 4 | Fix the overlay's three problems; layers on the photo; click to read the map; features check | M | a trustworthy *Accept* |
| 5 | Photo on the plan as a component: docked photo, opacity, blink, edges/footprint, linked cursor, legend, live drape | M | |
| 6 | Accept: `photoAcceptance.ts`, the gate, the record | M | 7 |
| 7 | Photo viewpoints: the `photo` link on a view of interest, standing at altitude, capture with the photo as before image | M–L | reports |
| 8 | Jobs (`uses`), regrowth grouping, flight track and cones | M | |
| 9 | Photo simulation (the "after" image) as an analysed-photo figure | L | needs a contract change, below |

## 4. Contract changes this would need

- **The photo as a class-pass source.** AGENTS.md allows two class-pass sources: PGMaps' own pass and an engine's ground pass. A photo's hit buffer classified with the class-pass layers would feed `composeFigure` the `ANALYSED_PHOTO_*` and `CALCULATION_ON_PHOTO` presets; that needs the rule widened first. Its pixel figure prints beside the run's sightline figure, named as the photo camera's, with "trees not modelled", and is computed at save, never at export.
- **The photo-on-plan layer** moves out of the page's own `map.addLayer` into a component, as the forestry tool standard already asks.
- **The visual-quality doc** sections *A photo of your own*, *Find the camera* and *Views of interest* change with pieces 1, 3, 6 and 7.

## 6. Still open after the build (17 November 2026)

The build was driven end to end in a browser with the fourteen helicopter photos. These are known and not yet done:

- **The overlay grows heavy with every layer on.** With the usual layers (skyline, proposed blocks, recent cutblocks and openings, lakes) the drawing over one photo is about 155 KB. With all 18 layers on it is about 1.8 MB, mostly forest-inventory (VRI) polygon edges. Lines are already simplified to about one screen pixel; the next step is to draw VRI from the hit buffer as a tint (`pixelsInFeature`) rather than as outlines, or to cap how many of its polygons are outlined.
- **The own-photo panel leaves the sidebar while the road view stands at a viewpoint.** Standing at a photo viewpoint hides *Your own photos* in step 2, so getting back to the photo means leaving the viewpoint first. The panel should stay, as the Field photos section does.
- **Saved figures of a photo view come out level.** `captureFramed` and `captureAtCamera` (`mapCapture.ts`) place the camera with `roll: 0` on purpose: AGENTS.md asks the analysis sheet's framed capture for an explicit level roll. Standing at a photo viewpoint does take the photo's roll, so the road view and a saved figure of the same view differ by the photo's roll. These photos roll about 1°, so the difference is small; a photo taken banking would show it. Carrying the roll into a figure needs that rule changed first.
- **Not exercised in the browser:** the 2×2 comparison (photo, model view of the best fit, model view of the runner-up, their difference), shown only for a fit that is not settled, and a full paired-point solve from clicked pairs. Both have unit tests; neither was driven by hand.
- **Most of these photos do not settle on the skyline alone.** Of the fourteen, IMG_9297 and IMG_9311 settle; the other twelve come back *not settled* (another heading at least 15° away fits about as well). The queue's search was rebuilt by hand in the page for all fourteen and matched it exactly, so this is the photos, not the queue: their skylines are mostly one straight ridge. Paired points are the way to settle them. A burst neighbour's accepted camera is offered on the next frame's card, but the narrow search round IMG_9311 put IMG_9310 16° away, so the neighbour-agreement evidence (within 2°) did not appear on this set.

## 7. Sources for the interface patterns

- Smapshot (participatory georeferencing): automatic residual gate before validation, a human check, and propagation of a reference image's pose to its neighbours.
- WSL Monoplotting Tool (manual): paired-point table, fix/free per parameter, five error kinds, user and computed points drawn on both views.
- Pic2Map and QCALVIEW (documentation only, route A): rough pose first then points; disabled points as check points; GIS layers drawn into the photo with terrain occlusion; composite, transparent and schematic exports; map themes switched with the camera locked for before/after.
- moniQue (paper): uncertainty per projected point; automatic matching as a start for manual work.
- PeakFinder and PeakVisor: drag the skyline by a centre cross, level it by side handles, view-mode switch.
- Esri oriented imagery viewer: footprints and camera locations, a linked map-image cursor, overlays of map features in the image, previous/next in a sequence.
- Mapillary: per-image detection overlays, camera frames on the map.
- MFLNRO, *Wind Energy Visual Effects Assessment* guidance: what a photo viewpoint and a simulation must record.
