> **Implementation update:** See [the integrity, road-camera and PDF export contract](forestry-visual-quality-integrity.md). It supersedes the older descriptions below of pooled landforms, maximum-ground-area viewpoint selection, missing terrain being clear, VAC defaults and the original drive controller.

> **Planner review:** [November 2026](forestry-visual-quality-planner-review-2026-11-10.md) — what a BCTS planner asked for in a recorded walkthrough, what is built, how the view compares with human sight, and what is left.

> **Tools trial:** [12 November 2026](forestry-visual-tools-trial-2026-11-12.md) — EZ-Tree, maplibre-landmarks, maplibre-gl-three, Giro3D, OpenForest4D and FORA run against Prince George LiDAR and this page's tree renderer.

> **Work log:** [September 2026 round](forestry-visual-quality-worklog.md) — the handbook steps as tabs, map scale, field photos, retention and partial cuts, inventory-calibrated forest density, terrain landforms, and what each turned up.

> **External QA review:** [November 2026](forestry-visual-quality-qa-review-2026-11-22.md) — the 32 items an outside reviewer raised, what was done with each, the decisions taken and still open, and how it was checked.

> **Report survey:** [November 2026](forestry-visual-quality-report-survey-2026-11-11.md) — what 26 real visual-quality assessments ask of the page.

> **Photo matching:** [November 2026 trial](research/landscape-photo-matching-2026-11-14.md) — fitting helicopter and landscape photos to terrain, what worked, and what others have built.

> **Criteria reference:** [wording, tables, factors and criteria](forestry-visual-quality-criteria-reference.md) — every definition, table, conversion factor and decision rule found in those assessments.

> **Simulation formats:** [the simulation and report formats to remake](forestry-visual-quality-simulation-formats.md) — the figure and sheet formats the analysis sheet's styles reproduce.

# Forestry visual quality (`/dev/forestry/visual-quality`)

A screening tool for the question a visual landscape assessment starts from:
**from this road, how much of that cutblock can you actually see?**

Pick a viewpoint — a spot beside the road, or a length of road driven end to
end — drop in the blocks as a zipped shapefile or GeoJSON, and the page traces a
sightline from every viewing station to every point on every block, over the
real shape of the ground. It then reports the visible share against a visual
quality objective, and lets you stand on the road and look at the result.

## Guided mode and the Ribbon

The page has two interfaces, served from `public/visuals-layouts.json` through the shared
interface kit the road designer uses (`docs/workspace-interfaces.md`): **Guided mode**, the five
steps in the sidebar under the road designer's two-line header, and **Ribbon**, a tabbed ribbon
with one tab per step whose **All settings** opens that step in a task pane beside the views. It
opens in the interface a `?interface=` link names, else the one this browser last used
(`pgmaps-visuals-interface`), else Guided mode, and **Switch interface** (the header's strip, the
ribbon's tab row and View tab) changes it without reloading anything.

- Both interfaces arrange the same commands (`src/pages/dev-forestry/interface/visualsCommands.ts`)
  and the same steps panel. The page renders the steps once, through a portal into the kit's
  `editorHost`, which sits in the sidebar slot in Guided mode and in the ribbon's task pane in
  Ribbon; switching never remounts a step, so nothing typed is lost. The selected step is one
  value for both (`useWorkflowPlacement`): the sidebar's tabs and the ribbon's tabs are the same
  choice, and starting the road view brings step 2 forward without opening the pane over it.
- The sidebar draws no title row: the header (Guided mode) or the ribbon carries the way back, the
  name and *Simulation settings*, so there is one "Visual quality" heading. In the ribbon, the
  steps panel hides its own step tabs (`Sidebar`'s `embedded`).
- Each output of Save & export is a command (`export-<kind>`), placed in File by its group and in
  the step it belongs to; the dialog still decides what each file holds. *Look from the road*,
  the drawing tools and *Route preview* are the plan map's own handlers (`lookFromRoad`,
  `startPlanDraw`, `toggleRoutePreview`), so the map's buttons and the ribbon's do the same thing.
- Panels keep the tiled workspace (`visualsWorkspace.ts`); a layout's `panelFrame` gives the map
  and the road view the shared corner grip, and each interface keeps its own screen preset on this
  device (`pgmaps-visuals-layout-<interface>`; Guided mode reads the earlier
  `pgmaps-visuals-layout`). The Table button sits on the header's strip or in View.
- On a phone, Guided mode keeps the steps in the bottom sheet under a one-line header; the Ribbon
  keeps its tab row and opens a step in a side sheet.
- Panels cannot yet be opened in another window here (see `docs/workspace-interfaces.md`, **Known limits**): moving the road view would rebuild its map
  and engine (see **Road view performance**), so detaching waits for a design that keeps them.

## The sidebar follows the VIA handbook's five steps

The sidebar is laid out as the procedure in the *Visual Impact Assessment
Handbook* (BC Ministry of Forests, 2022, Figure 2): one **tab** per step,
pinned under the answer, and one step on screen at a time. Stacked as folding
sections the sidebar ran to about eleven screens with every step open; as tabs
the longest step is under three. Every step stays mounted while hidden, so what
is typed survives switching.

| Step | Handbook | In the sidebar |
| --- | --- | --- |
| 1 · Identify the VQO and viewpoints | 3.1 | **Start from** (Tabor sample, Purden Lake, roadside demo, new site; each button's tooltip describes the scenario and lists what its scene holds, counted by `scenarioSummary.ts`; under them *Open a project…* and, when this browser kept another site, *Reopen previous site*); **Road or viewpoint** (*Assess from*: a view of interest, or a length of road drawn, imported or snapped); folded *Which roads see the block*; **Cutblocks** with their objective and harvest system; **Landform and objective** (folded *Sub-landforms* inside); folded *Existing openings*, *Find a landform from the terrain*, *Find a landform in the BC inventory* and *Look up this map view* |
| 2 · Visit the viewpoints | 3.2 | **Views of interest** (planned on the plan and captured without driving; each row holds everything about that view: its record with significance and 3.2.1 type, its field photos, the crew's *Real and reachable* check, its key-viewpoint choice, its own place, lens and surveyed eye and, at the view stood at, the field photo line-up; see **Views of interest** below) and under it *Add from viewpoints and rec sites*; *Look from the road*, and while in the road view the stand (folded *Block colours*, **Existing forest and regrowth**; how the view looks is the road view bar's *View options*, the timber it is drawn with its *Drawn timber* popover); on the road only, **Road viewpoint** (its 3.2.1 type and, at a stand, the surveyed eye; a view keeps both in its row); folded *Field photos* (the road's photo line-up, then the attachments); folded *Field brief and crew checklist* (its file comes from *Save & export*) |
| 3 · Design and simulate | 3.3 | **Run assumptions** (active landform, year, green area, existing disturbance), **Simulation** (the run), **Wildlife tree patches** (draw one on the plan), **Results**, then folded *Planning thresholds*, the design alternatives and the diagnostics (each its own fold, never a fold inside a fold). *Simulation settings* are the settings icon right of the sidebar's title (`SimulationSettings.tsx`), compact rows grouped Viewer, Detail, Timber and Landform; every one is a run input |
| 4 · Assess against the VQO | 3.4 | *Assessing from* (the group of views of interest the judgements are for; see **Step 4 per group of views** below), **Ocular assessment** (3.4.1), **Percent alteration** (3.4.2), **Design adjustments** (3.4.3) |
| 5 · Final rating and package | 3.5, 4.0 | **Rate and write up in Save & export**: *Rate and package…* opens the dialog's Package entry, whose top holds the **Final rating** (Table 7) and its rationale; *Visuals note…* opens **Block note**, whose options hold the Visuals paragraph and visual measures. The evidence record and checklist are *VIA evidence package*'s options, and *Import assessment workspace* is *Assessment workspace*'s |

Under every step, after step 5, a folded **Resources** section holds reading
rather than controls: links to the VIA Handbook and FPPR, the five FPPR s. 1.1
visually altered landscape categories (the `VISUAL_QUALITY_CLASSES`
descriptions), and *Landform design review* (Appendix 5).

The sidebar is laid out like the road designer's: the step tabs at the top of
the scroll, then flat `ToolSection`s (`src/components/ui/tool-section.tsx`)
separated by full-width rules. A section's explanation and handbook reference
sit behind the (i) in its heading, not printed under it, and so do a field's, a
checkbox's and a fold's (the (i) at the end of its label row); only a value the
run produced, such as a measured design element, is printed under a control. Cards
(polygon cards, headline tiles, row lists) take the card fill, one step above the
sidebar in the dark theme; secondary sections fold
to one row that states their live values (**bold** above is always open,
*italic* is folded); and a fold inside a section is a `ToolDisclosure`, never a
bordered card. Each folded section's toggle carries `data-forestry-disclosure`,
which the e2e suite's `openAllSteps` opens. Each step starts with one line —
its title and handbook section, its purpose behind the (i), and the step's
status (`data-step-status`) — rather than a repeated step header.

A step is **done** when the handbook's output for it exists: step 1 needs a
viewpoint, a cutblock and a landform; step 2 a run, and this road and these cutblocks viewed
from eye level or a view saved (re-running with other settings keeps the visit;
moving the road or a block does not); step 3 a run whose numbers are not provisional;
step 4 an ocular class and every adjustment; step 5 a rating and a rationale.
The first step not done is **current**: the page opens on its tab, the tab's
marker is filled, and the headline's *Next* prompt goes to it — shown only
while another step is on screen.

Each job has one place. Playback (play, speed, position) is on the road-view
panel over the map, not repeated in the sidebar; drawing a road or a block is
in its own section, not also in a setup card; one *Look from the road* runs the
simulation first if it needs to; and the header carries no icon buttons —
*New site* is in step 1. Every file the page writes is written from one place,
*Save & export* (below).

### Views of interest

Step 2 opens with **Views of interest** (`ViewsOfInterestPanel.tsx`): the
places the blocks are looked at from, planned on the plan map before anyone
opens the road view. The work runs blocks → views → capture → export, and a
strip at the top of the section says where it stands (*Blocks*, *Views*,
*Captured* n of m, *Export*). The road view is optional throughout: a view is
planned on the plan, captured by the page and written by *Save & export*
without the reviewer driving. *Stand here* on a row opens the road view there
for a look, and nothing else needs it.

**Plan map tools.** The plan map's control stack, under *Measure*, holds the
tools that act on a plan click (`PlanMapTools.tsx`): *Look from the road*,
*Add a view of interest*, *Draw the road*, *Draw block*, *Draw a wildlife tree
patch* and *Route preview*. *Look from the road* opens the road view on the
scene's road; with no road yet it takes the next plan click as the basemap road
under it (`pickBasemapRoad`, the roads `collectRoadsFromMap` reads) and opens
there. The sidebar keeps the preparation's progress, Cancel and Retry. Each shows its card in the
plan's top-left corner (`MapToolPanel`) with the drawing's Finish and Cancel,
and Esc puts a drawing down. Importing a road or a cutblock file stays in step
1's sidebar sections, and *Route preview*'s road viewshed stays on the plan
after its card closes (a dot on its icon says so). Each icon names itself in a
`HoverTip` bubble. Under the plan's Layers button, *Masks and local surfaces*
(`ToolSourcesPanel.tsx`) opens a card beside the control stack on the plan's
right: classify mask polygons, copy a selected polygon in as a mask, and import
a local terrain or canopy GeoTIFF. It stays open while the plan is clicked, and
a dot on its icon says the scene holds masks or surfaces. Steps 2 and 3 show no intro line (their tabs name them), and
the headline's *Views captured* tile carries step 2's progress.

**Adding views.** The plan map's *Add a view of interest* tool (its icon in
the map's controls, its card with a *For* block chooser when the scene has
several; `PlanMapTools.tsx`) takes the plan's next click as a view standing there and facing
the block (`viewAtPoint`); Esc cancels. *Add from viewpoints and rec sites*,
directly under the list, adds inventory viewpoints for the block the finder is
ranked for. Each row carries its own *Add* (*Add 2* when two arrows aim at the
block; *Added* once listed for this block), so nothing has to be opened first;
opening a row shows its arrows on the plan, adds one direction, or stands
there. *Add* adds, by default, one view per inventory arrow aimed at
the block — within `ARROW_AIM_DEGREES` (30°) of the bearing to the block's
centre, nearest that bearing first, at most `DEFAULT_ARROWS_PER_VIEWPOINT` (2)
— and one view facing the block when no arrow aims at it
(`viewsForCandidate`); the arrows it would add are highlighted on the plan
while the row is open. Picking *Face the block* or one arrow on the row first
adds just that view. Under the list, *Add the N that see the block to views*
(after *Check which of them see the block*) or *Add the N with arrows at the
block to views* adds every such row not listed yet, and a row listed for the
finder's block reads "· in views" (the same viewpoint planned for another block
does not). When arrows aim at the block, the row's facings start on *The N
arrows at the block*, the choice *Add to views* adds; a check's *Hidden* and
*% seen* show only for the block it was run for, and an "Added …" line stays
under the row or bulk button it came from until the block changes or for
`ADD_MESSAGE_MS` (8 s). A view that repeats one already listed (within 1 m, the same
block and facing) is skipped, and the list holds at most
`MAX_VIEWS_OF_INTEREST` (24), the saved-view limit, so every planned view can
be captured.

**A photo viewpoint.** An own photo's accepted camera becomes a view of
interest through *Make a viewpoint* (`viewFromAcceptedPhoto`), never a spot
of its own: the view stands at the camera, faces its heading in one frame of
its lens, assesses the block nearest the middle of the frame, and carries a
`photo` link to the field record with the camera's altitude, pitch, roll and
field of view. Its `source.kind` stays `'map'`, so an older PGMaps reads it as
a plain view. Accepting the camera again brings the view up to it (same id,
name, block, landform and grouping); a camera moved since it was accepted
makes none. The link's altitude, pitch, roll and lens join `viewCaptureKey`,
so a re-accepted camera stales the view's capture, and the capture takes the
photo as its before picture (the *existing* picture of a before/after pair).
Only the frames the reviewer chooses become views; the list still holds 12,
and the rest stay evidence. Removing the photo unlinks the view and keeps it.
Standing there is described under **Checking the view against a field
photo**, *Standing at a photo viewpoint*.

**A view's place, lens and eye.** A plan click lands metres from a recorded
station, and a reference frame is often not one of the four lenses offered. Each
view's View tab therefore carries its own place and camera (`ViewCameraFields`,
rules in `viewCoordinates.ts` and `viewCamera.ts`, both DOM-free):

- *Place* shows where the view stands in decimal degrees, degrees, minutes and
  seconds, and UTM (in the zone it was typed in, else its own). *Enter
  coordinates* takes NAD83 or WGS84 latitude and longitude (decimal, degrees and
  decimal minutes, or DMS, latitude first unless hemisphere letters say
  otherwise) or UTM easting and northing in BC's zones 7 to 11 (northern
  hemisphere). It refuses what it cannot read rather than guessing (a positive
  longitude without an E, a zone outside BC, a swapped easting and northing),
  and warns, without refusing, about a point outside BC or outside its zone's
  6° band. While it reads, the point shows on the plan as a hollow ring
  (`ViewPlacePreviewMarker`, a draft, not a plan layer) with its distance from
  where the view stands; *Move the view here* applies it. The view keeps the
  text as typed, its system, datum and zone, and the precision its digits state
  (`ViewOfInterest.place`: half the last digit, in metres, the larger axis;
  precision, not accuracy). NAD83 and WGS84 are taken as the same, with no
  datum shift (`DATUM_ASSUMPTION`): they can differ by about a metre in BC today,
  and the page says so rather than apply a transformation. A typed place
  describes the view only while it stands within 5 cm of it
  (`placeEntryOf`): a drag on the plan leaves it behind, said on the row and
  printed nowhere. While it holds it is printed with the view: the analysis
  sheet's *Entered as* fact, the camera information block's position in the
  typed zone, Scene for GIS's `coord_text`, `coord_crs` and `coord_prec`, and
  the field brief's viewpoint line. Standing there, the row also says how far
  the run's stations stand from this eye under calculation 1, where a
  stood-at view's run stations are at the pullout's two ends (`buildStations`),
  about 15 m away; under calculation 2 the run stands at the eye and the row
  says nothing (see **Where a view's stations stand**).
- *Lens* has a fifth choice, *Own lens*, which opens the lens as entered
  (`ViewOfInterest.lens`): a horizontal field of view in degrees, or a focal
  length with its crop factor (1 for a figure stated as 35 mm equivalent). The
  view's `focalMm` is its full-frame equivalent, which an older PGMaps and the
  capture key read; the field across is exact (`viewCaptureCamera`,
  `viewLensHfov`). The row shows the derived field across and high on a 3:2
  single frame and, while the road view is open, on its canvas.
- *Eye* is the terrain model (the run's eye height), a surveyed elevation
  above sea level, or a height above the model's ground (`ViewOfInterest.eye`).
  A capture stands on it (`viewCaptureCamera`): an elevation becomes the
  stand's surveyed eye, a run input at that stand as a photo viewpoint's
  altitude is, so the road view, the run and the figure stand there together.
  A height above the ground does the same as the stand's own eye height
  (`Viewpoint.standEyeHeight`, read through `standEyeHeight`): the run's
  stations at that stand stand that high in place of the scene's eye height
  (`AnalysisInput.viewpoint.eyeHeightMeters`), so an analysis sheet's picture
  and its sightline figure always stand at the same eye, and the run's
  `settings.observerHeightMeters` is the eye it used, which the camera
  information and every figure print as the observer height. Where a stand
  holds both, the elevation wins and the height is not sent. Roads and views
  without an eye of their own keep the scene's eye height, and `buildStations`
  is unchanged. Like the elevation, the height is kept with the point it was
  set for and lapses when the viewpoint moves; editing the eye of the view
  stood at changes its stand's input and stales the run (the road view is held
  open through the new run), while editing any other view's eye never does.
  The stability check's *Eye 0.5 m lower/higher* move a stand's own height by
  the same half metre. The VIA report's Methods never print one eye height a
  view did not use (`reportEyes`, `eyeClause`): they state the scene's eye
  height and name each view that stood at its own eye, read from its figure's
  camera information, or each view's eye when none stood at the scene's. Views at one place with different eyes are
  separate stands (`groupByPlace`). A surveyed elevation more than
  `EYE_GROUND_TOLERANCE_METERS` (3 m, a screen) from the terrain model's eye
  is flagged on the row with both numbers (`eyeCheck`), never refused, and the
  figure's camera information gives both on its position line. The eye and the
  lens join `viewCaptureKey`, so changing either stales the capture
  (*Changed since captured: eye*). A photo viewpoint's camera stays its
  photo's: its eye and lens are not offered.

All three are the view's record: `scene.viewsOfInterest` stays out of
`sceneFingerprint` and `AnalysisInput`, they travel in the scene and the
project file, and an entry that does not read is dropped with the view kept.

**Assess from a view (step 1).** A view of interest is the one way to put a
viewpoint on the map. Step 1's *Road or viewpoint* reads *Assess from: A view |
Length of road*. *A view* (`AssessFromView.tsx`) is a list of the views of
interest: choosing one stands there and runs the assessment with the road view
closed (`viewCapture.standAt(id, { roadView: false })`, which `standAtPlace`
runs as *Run* would instead of opening the road view), and *Add a view on the
map* places a view facing the chosen block and then assesses from it. The
summary's view switcher and this list are the same choice. A spot placed
directly before views existed is shown with *Make it a view*. *Length of road*
while standing at a view goes back to the road the stand left.

**Turning a view.** The open view's cone tip on the plan is a handle, like the
road view's own: dragging it sets the view's facing to that bearing (an arrow's
id is dropped). The handle rides the cone's arc as it is dragged, wherever the
pointer is, and the cone turns with it (`MapTurnHandle`); the view itself takes
the bearing once, to the degree, when the handle is let go. Hover cards for
what the pointer crosses stand aside until then. While the road view stands at a planned view it *is* that view:
the plan draws it once, as the road view's viewer (the view's own point and cone
are left out, `standingViewId`), and turning the road view's look handle turns
the planned view too. Either way the view reads *Changed since captured* until
it is captured again.

**What changed since a capture.** An outdated view names what moved, read from
its latest capture's key against its key now (`captureKeyChanges`): place,
block, facing, lens, framing or landform ("Changed since captured: lens and
landform."), on the row's state and in the open row.

**Earlier captures.** A save made under an earlier version of a planned view
(another `plannedKey`) no longer counts as the view's capture, and no output
draws it while it carries the view's id (`resolvePackage`). It is not lost: the
view's open row lists it under *Earlier captures (n)*, a fold
(`DisclosureRow`), newest first (`earlierCaptures`, DOM-free), each with its
screenshot, its name, when it was saved and what has changed since in plain
words ("Since then its place and lens changed.", `earlierCaptureText`; a key
that does not read names nothing). The list is read-only with one action a
save, *Keep as its own saved view* (`keptAsOwnView`), which clears its
`plannedViewId` and `plannedKey` in whichever list holds it, here or shelved,
and changes nothing else: it is then an ordinary saved view, listed under
*Saved, not listed as a view* and drawn by the outputs like one saved by hand.
Nothing is deleted or converted unasked. *Capture again* still replaces every
save of the view that has not been kept (`withoutPlannedView`), so keep one
first to hold on to it. The cleared fields round-trip through the project file
like any other absent field.

**Who draws the figures.** The strip under the list says *Figures drawn by* and
links to *Save & export → Package* (`openPackage`); the renderer is held by the
export opener (`useExportOpener`) so the panel can say it while the dialog is
closed. Captures are always PGMaps'. With an engine chosen, a captured view
saved at another place than the one stood at says that it keeps PGMaps' picture
(`renderJobFor`'s rule), and that standing there lets the engine draw it.

**Everything about one view is in its row.** What the reviewer fills in for a
viewpoint is entered once, in that view's open row, never in a section of its own
elsewhere in the steps. The open row starts with its actions (*Stand here*,
*Capture*, *Reopen saved*, *Remove*) and shows one tab at a time: **View** (name,
block, facing and bearing, lens, framing, the landform seen from it and, at the
view stood at, what belongs to the place), **Record** (the Table 3 record),
**Field** (*Real and reachable*, field photos) and **Report** (*Include in
exports*, the key-viewpoint choice, *Step 4 assessed with*). The tab is one
choice for the whole list (`rowTab`), so going through several views stays on
the same tab, and every tab's panel stays mounted (`hidden`), so a landform
reading is not lost on a switch. *Bearing from north* is always beside *Facing*:
typed for *A bearing*, otherwise read only, showing the bearing the block or the
arrow gives. An e2e test brings a tab forward with `openViewRow(page, name, tab)`.
What each part holds:

- *Viewpoint record*: the Table 3 fields (significance, why it was chosen,
  viewing experience, view duration) and the handbook 3.2.1 viewpoint type
  (`ViewpointRecordFields`), held on `viaReview.viewpointRecords` by the view's
  name, which its capture is saved under. The view stood at also offers the
  run's 3.2.1 estimate (`viewpointTypeEstimate`); no other view does, because
  the run measured only that one. Step 4 and the reports read a view's own type
  first and fall back to the review's `viewpointType` only at the assessment
  station (`viewpointTypeOf`, and `vp.review.viewpointType` in the district
  form), so a review saved before types were kept per view reads the same.
- *Field photos*: the *Field records* attachments filed under the view
  (`FieldRecord.viewId` is the view's id), and *Add a field photo…*, which
  files the new photo under it. The attachment dialog is mounted beside the
  sidebar's sections (`tools.fieldDialog`), so a folded section never closes it.
- *Key viewpoint for <block>* (and *for the blocks together* when the scene
  has several blocks; `KeyViewpointFields`): ticking it writes
  `viaReview.keyViewpoints` by block name and view name, taking the choice
  over from another view; unticking clears only this view's choice. A row
  offers its own block, and any block the review already gives it.
- *Place*, *Lens* and *Eye* (`ViewCameraFields`, under the lens in the View
  tab): the view's coordinates in both systems, a place typed as coordinates,
  its own lens and its surveyed eye; see **A view's place, lens and eye** below.
  At the view stood at, the eye is the stand's too, as a capture stands it.
- At the view stood at (`standingViewId`, the summary's `currentPlannedView`),
  the row says *assessing from here* and holds what belongs to the place: the
  Mapillary or own field photo the road view lines up with. Standing on a road,
  or at a place that is not a planned view, the surveyed eye (*Where you
  stand*, `StoodViewpointPanel`), the photo line-up and the road's
  **Viewpoint type** stay in step 2.
- *Reopen saved* opens the road view where the view's capture was saved under
  the current scene (the old *Saved views* button).

Renaming a view moves its record and any key-viewpoint choice naming it
(`renamedViewpointRecords`).

**Step 4 per group of views.** The handbook assesses from each significant
viewpoint, but views close enough to see the block the same way need only one
assessment. Step 4 (the ocular terms, the design adjustments, roads,
retention and the rationale, `STEP4_KEYS`) is therefore made per group of views
of interest (`viewGroups.ts`, DOM-free):

- A group is led by one view; the others name it in `ViewOfInterest.assessedWith`
  (out of the capture key: grouping never outdates a capture). Its step 4 is
  `viaReview.stations[<lead id>]`. Each open row has *Step 4 assessed with*
  (its own, or another group) and says whether its group's step 4 is recorded.
- Grouping is the reviewer's. A row proposes joining an earlier view that sees
  the same block from the same perspective (`samePerspective`: within
  `SAME_PERSPECTIVE_DEGREES`, 10°, of each other as seen from the block's centre,
  the nearer at least `SAME_PERSPECTIVE_DISTANCE_RATIO`, 0.8, of the farther's
  distance), with *Assess together*; nothing is grouped without that click.
  Joining moves a lead's whole group; a lead leaving or removed hands the group
  to its next view and its record moves with it (`handOver`, `movedStation`).
  A lead that joins another group leaves its own record unread in the review.
- Assessing from a view of interest reads and writes its group's record
  (`reviewAtStation`, `routeStep4Patch`); steps 4 and 5 say *Assessing from
  <lead>, for <the others> too*. A road, or a place that is no view of
  interest, keeps step 4 at the top of the review, as before groups. A step 4
  recorded before groups is offered once, *Use it here*, never copied unasked.
- In the documents and reports (`documentFacts` with `groupOf`), every view
  whose group has a step 4 prints that group's terms (`DocumentViewpoint.ocular`,
  read through `judgedOcular`), not only the run's station. At the run's station
  the rating is the run's; elsewhere it is read on the view's own captured figure
  (`assessAtCapture`: X is its `sightlinePercent`, the distance its own), which
  leaves out what only a run gives: the number-size-spacing suggestion, retention
  measured from the blocks, and a partial cut's Table 6 figure (a view that sees
  one gets no adjusted figure). Appendix 1's breakdown, and the one class met
  from all viewpoints, stay the run station's.

**A view saved by hand is a view of interest.** *Save viewpoint* on the road
view's bar lists what it saved with the views (`handSaveLink`): standing at a
planned view and still facing its way (within `HAND_SAVE_FACING_DEGREES`, 2°),
the save is that view's capture and replaces its earlier saves under this scene
(a save under another design stays, for the design comparison); otherwise a new
view is listed where the eye stands, facing the block the road view looks at
or the bearing it looks along, with the road view's lens (50 mm when none is
set) and the save's caption as its name ("… (2)" when that name is taken). A
save that repeats a listed view joins it. Its picture is framed exactly as
before: the link only tags the saved view with `plannedViewId` and
`plannedKey`. A save that could not be listed (no cutblock, or 24 views
already), one whose view was removed and one made before this show under the
list as *Saved, not listed as a view* (`UnlistedSavedViews`), reopened or
removed there; step 2 has no separate *Saved views* section.

**Field records file under the views.** The views of interest are the tools'
viewpoints (`plannedToolViews`, by the view's id, standing on its 30 m pullout as
*Stand here* does): the viewpoint matrix, *Assessment evidence viewpoint*, the
evidence package and a photo's *Evidence viewpoint* all list them. Viewpoints
recorded in *Field records* before this are kept (`earlierToolViews`) with their
photographs and runs, under *Recorded here before the views of interest*, until
the reviewer lists one with the views (*List with views of interest*, spot
viewpoints only, under the same id, its notes becoming the view's reason) or
removes it; nothing converts them unasked. A photo's *Add the photo's place to
the views of interest* lists a view where it was taken and files it there. The
assessment workspace export carries the views as viewpoints too
(`withPlannedViews`), so a run filed under one reads back under its name; its
import drops those copies again when its scene brings the views back, and the
project file stores only the workspace's own.

**What a view is** (`viewsOfInterest.ts`, DOM-free): a place (a map click, or
a VLI viewpoint or rec site by its candidate key), the block it assesses, a
facing (the block's interior point, or a compass bearing: typed, or an
inventory arrow's, kept with the arrow's id), a lens (`LENS_FOCAL_LENGTHS`: 50,
35, 28 or 24 mm full-frame equivalent; 50 mm, the reference sheets' lens at
39.6° across, by default), a framing, optionally a landform, and *Include in
exports*. The list is `scene.viewsOfInterest`, so it travels with the scene
file, but it is a plan, not an input: it is deleted in `sceneFingerprint` and
absent from `AnalysisInput`, so adding, moving, editing or removing a view
never stales the run (adopting a view's landform does, below, because it adds a
landform target). A stored list is read leniently (`parseViewsOfInterest`): a
malformed entry is dropped, never repaired into another view. A view whose
block or landform has left the scene is kept and flagged (`orphanedViews`) for
the reviewer to re-point; it cannot be stood at or captured until then.

**On the plan** (`ViewsOfInterestLayers.tsx` over `viewsOfInterestGeometry.ts`)
each view is a numbered point and a cone as wide as its lens along its facing,
reaching a little past the block's centre (× 1.15, held between 400 m and 8 km;
2 km when its block is gone). The open row's view is drawn heavier and a view
left out of exports fainter. The inventory arrows the views face along are
outlined, and those the finder's open row would add are fainter. Both have
legend rows (`view-of-interest`, `view-arrow`), and the cones and arrows take no
clicks. Views standing at one place share one point labelled with all their
numbers ("2·3", `groupMarks`), and a click there opens each in turn. A point
opens its row, and a view placed on the map can be dragged, but
neither while the road view is open (a plan click moves the road view then) or
while something is being drawn, picked or measured. The views are hidden while
the VIA report captures its maps. The numbered points are HTML markers, so a
canvas capture of the plan, such as the block note's plan map, shows the cones
and arrows without the numbers.

**Lens and framing.** A planned view's figure is framed with its own lens.
*Cover the landform* (`landform`, the default) is the analysis sheet's framing
as before (**Figure styles and analysis sheets**, *Framing*): the landform
covered by frames of the lens side by side, a panorama when it is wider than
one frame. *One frame along the facing* (`single`, `planSingleFrame`) is one
3:2 frame of the lens centred on the view's facing, with the landform's foot
about a third of the way up when the landform is known, else level; a wide lens
stays one rectilinear frame and is never tiled. Both reach the sheet through
`figurePlanFor` (`viewCapturePlan.ts`): a single frame when the view asks for
one, else the scene's fixed figure frame when one is set, else the landform
framed with the lens (a lined-up photo's, the view's, else 50 mm). The saved
view's `figureAt` keeps the lens (`lensHfov`) and the framing, so a background
render or a before picture is framed as the view was saved. The road view has
the same lens for the reviewer's own saves: *View options → Lens* (*Road view
default*, or 50/35/28/24 mm) holds that horizontal field across the eye map's
width (`DriveCamera`'s `horizontalFovDegrees`; the vertical field follows the
canvas's shape), and a view saved with a lens set frames its sheet with it. A
lined-up field photo's lens wins while it is lined up, but never for a planned
view's capture. The drive controller keys the pose on the vertical field as it
does on the canvas size (`driveController.ts`): MapLibre keeps the zoom through
a change of field, which moves an eye-level camera along its view.

**Capture** (`useViewCapture.ts`; its decisions, DOM-free, in
`viewCapturePlan.ts`). *Capture* on a row, *Capture N views* under the list, or
Preview and Download in *Save & export* (below) turn planned views into saved
views. A batch groups the views by place (`groupByPlace`: within 1 m, the same
block and landform), so one stand and one run serve every view there. At each
place it stands as the finder's *Stand here* does (a 30 m pullout through the
point; an inventory viewpoint keeps its candidate's key, so standing there from
the finder or a view is one place with one set of saved views), with the view's
lens on the road view and its landform active. It waits for the run and the road
view, turns to each view's facing and lens in turn, and saves through the page's
`saveView`, the same path as *Save viewpoint*: the screenshot, then the framed
class pass. Before a save, readiness (`captureWaitingFor`: the run for the
place's scene key, the road view open on a full run, the look, the lens applied
to the eye map, the pose within 1° of the facing, terrain and timber ready) must
hold for 300 ms with the camera's bearing unchanged, and each save is awaited to
the end of its class pass (or an engine's capture) before the camera moves
again. Each settled frame of a framed capture waits for its tiles by their
progress (`SETTLE_LIMITS`, `settleGivenUp`, `mapCapture.ts`): at least 45 s, as
the old fixed wait did; past that only while a tile has loaded within the last
20 s; and never past 3 minutes. The reason still names the tiles ("no tile
loaded for 20 s (its tiles were still loading)"). All of one framed capture's
settles (each frame's display and every class, zone and landform pass) share
one budget (`CaptureBudget`): 240 s from its start
(`FRAMED_CAPTURE_DEADLINE_MS`, below the save's 300 s, which also covers the
screenshot) and the caller's `signal`. Past it, or once the signal fires, the
capture stops at its next check with `CaptureStopped`, never a partial figure,
and puts the camera back itself. PGMaps' own analysis sheet is
drawn a second time when the first try fails: under load a 15 s wait failed
about half the views of a batch. With `capture(ids, { before: true })` (Save & export's
before pictures) each place's views are also drawn before harvest
(`captureBeforeRenders`) once they are saved, while the road view still stands
there; the harvest phase is put back, and the renders are kept by saved view in
the page's `capturedBefore` with the planned key they were taken under. The saved view carries `plannedViewId` and `plannedKey`
(`viewCaptureKey`: the place to 1e-6°, block, facing to 0.1°, lens, framing and
landform; never the name or *Include*, so renaming a view or leaving it out
keeps its capture). A recapture removes the view's earlier saves wherever they
were saved, here or shelved (`withoutPlannedView`), so it replaces the view
rather than adding a second. A view reads *Captured* while a saved view carries
its id and current key, *Changed since captured* once its place, block, facing,
lens, framing or landform has changed, *Screenshot, no analysis sheet*
(`screenshot-only`) while its current save kept its screenshot and the camera it
was taken from but its class pass failed, *Saved, no analysis sheet* while the
screenshot and sheet went with an earlier session, and *Not captured* otherwise
(`viewCaptureState(view, saved, hasFigure, hasScreenshot)`). Only *Captured* is
complete: `needsCapture` is every other state, so *Capture N views*, the strip's
count and Save & export's capture all treat a save without its sheet as one
still to capture. A `screenshot-only` view is not saved again: *Draw analysis
sheet again* on its row, *Capture N views* and Save & export's capture
(`captureAsNeeded`, `sheetOnlyViews`) run it with `stage: 'sheet'`, which stands
at its place, waits only for the run, the road view and its timber
(`captureWaitingFor(..., 'sheet')`), and calls the page's `redraw`: the class
pass of that save is drawn from its own `figureAt`, as a background render draws
one, and fills only its figure, keeping the saved view's id and screenshot
(`sheetOnlyCapture` picks the latest such save). The camera is put back by
`captureFramed`'s `finally`, and the batch steps back where the reviewer stood
as any capture does.

Each wait has its own budget, counted only while the capture waits on it
(`CAPTURE_TIMEOUTS`): the run 5 minutes, the road view opening and its terrain,
forest records and camera 2 minutes, the facing and the lens 20 s, the save 5
minutes. The drawn timber is judged by its progress, not the clock
(`watchTimber`, `timberGivenUp`): the page reports the patches grown of those
wanted (`timberProgress`), the status line reads "Preparing timber 12 of 40",
and the wait goes on while the count changes. It gives up after
`timberStallMs` (30 s) without another patch, naming the count ("stopped
growing at 17 of 40 patches"), or after `timberMaxMs` (10 minutes) in all.
Patches grow on the frame loop, so under software rendering, about a frame a
second, a far stand took longer than the old fixed two minutes while still
growing. Growing them off the frame loop or in a worker is left for later. The
road view also holds its last two whole terrain mosaics by tile range
(`createHeldTerrain`, `useDriveTerrain.ts`): standing at a view, stepping back
and standing there again gives the very same `ElevationSource`, at once, with
no moment without ground, so the elevation the stand's patches are kept by
(`forestPatches`) does not change under it.
A run that fails or runs out of time, or a road view that does not open, fails
every view at that place with the reason; terrain, timber, a facing or a lens
that does not take fails that view alone. A run cancelled under the capture
ends with no error, so nothing would finish the wait: once no run is running,
pending or failed for `runAbandonMs` (3 s; `runPending`, `waitAbandoned`) the
place fails with *The run for this place was cancelled.* While a capture runs,
*Run visibility* (the ribbon's, the sidebar's and the export's) waits with "Wait
for the capture to finish, or cancel it.", since a run closes the road view the
capture stands in, and stopping a run the capture started cancels the capture
with it. A save that runs out of time stops
the batch, because its class pass may still be moving the camera, and the rest
are reported as not captured. A save whose screenshot or class pass could not
be taken is kept, with a warning (`warning: 'sheet'` in the batch's failures)
naming why, in its row and in the closing line ("Captured 2 of 3 views; 1 saved
without its analysis sheet"); a missing before render is `warning: 'before'`. *Cancel* finishes the view being
saved and stops. However a batch ends, it puts the reviewer back where they
stood (`restore`, in `finally`): the viewpoint and active landform, the place
stood at, the road view's lens, and the road view open at the same position and
look when it was open; when it was closed, the run is made again for where they
stood if they had one, and the last place's run is let go if they had none (kept,
it read as "Scene changed — rerun"). A view with no landform of its own is captured against
the landform active when the batch started, never the one the previous place's
view made active. One capture runs at a time; the summary's view switcher and
the panel's buttons stand aside meanwhile. A capture ends a lined-up field
photo's comparison (its lens would hold the road view) and does not line the
photo up again afterwards. The saved-view limit still holds per place: a place
that already has twelve saved views fails the next save there.

**The summary's switchers.** With views planned, the Viewpoint summary carries
a ◀ name ▶ switcher under its heading (`summaryViewSwitch.ts`, through
`MetricSummary`'s `toolbar`). It names the planned view the reviewer stands at
— within 1 m of its place; of several there, the one whose facing matches the
road view's look, then the one for the summary's block, then the first listed —
with "2 of 5", or where they stand and "5 planned" when they stand at none. The
arrows stand at the previous or next view, wrapping, as *Stand here* does, and
are off while a capture runs. With two or more blocks a block select sets the
block the rows read. At a planned view it reads that view's block (an arrow's
view faces a bearing, not its block); picking another block stands at a planned
view here for it, or else reads that block until the reviewer stands elsewhere.
Away from planned views it is the block the road view faces, else the sidebar's
selection, and a road view facing a block turns to the chosen one. At a planned view the rows'
qualifier reads *planned view* and their note names it. A block the run does
not hold (added or changed since) reads *Not in this run*, never another
block's figures, and when the view's own landform is not the one the run
assessed, the alteration rows say whose figures they are and warn.

**Each view's landform** (`viewLandform.ts`, DOM-free, and `ViewLandforms.tsx`).
The assessment has one **site landform**, the one the reviewer chose
(`siteLandformOf`), and a view of interest is assessed against it unless it has
a landform of its own. Both are set in one place, step 1's *Landform and
objective*, which lists who is assessed against what (`landformAssignments`):
the site landform first, then one row a view of interest (*The site landform*,
or *Its own landform* with its area and its card), then *Other landforms*, the
ones in the scene that nothing is assessed against. A view's own row in step 2
keeps one line (`ViewLandformSummary`) and *Set in step 1*. *Make this the site
landform* on any other landform changes the default; standing at a view on its
own landform, it changes the landform put back afterwards and leaves that
stand's run alone. The card of a view's landform reads *In use at this stand*
while the page stands there.

A view's *Read from this view* reads the visible face of the view's block from
the view's place alone, exactly as *Find a landform from the terrain* reads its
visible face from a chosen point (`visibleFaceLandform` with its default frame
centred on the block, the finder's terrain zoom 12 and search box widened to
take in the view, the scene's eye height, basemap water, *stop at the first
crest* and *split at draws* off), and draws it on the plan with the finder's
candidates. *Read for every view* reads them one after another and draws them
together. Like every terrain reading it is a candidate: only *Adopt for this
view*, or *Adopt each for its view* for the readings that can be adopted, takes
one, and a reading that finds little beyond the block (`blockOnly`) cannot be
adopted. The row says which case it is (`viewLandformVerdict`): a face round the
block seen from here; a block seen with little hillside round it; or a block the
terrain hides from here, when the reading is the land seen in front of it
(`seededBy: 'in-front'`), titled and, if adopted, named "Face in front of …",
never a face round the block, and adoptable only when it is more than
`blockOnly`'s 2.5 × the block's area. A view such as VLI 145 at Tabor Mountain,
which the run also reads as 0% of Test Block C in view, has nothing to adopt;
VLI 150 at Purden Lake, which sees PL-1, reads a 460 ha face. A reading stays in
the list only while its view and block are as they were read. Adopting adds a
landform target (`role: 'landscape'`) built as the finder's *Use* builds one
(`landformTargetFromCandidate`, named "Visible face round … from" the view), or
reuses a landform already in the scene with the same outline, and records it as
the view's `landformId` (`adoptViewLandform`). Unlike the finder's *Use* it
never replaces the site landform; each view keeps its own. The two exceptions
follow from the denominator rule: a scene with no landform takes the adopted one
as its landform, as any first landform is taken, and a scene with exactly one
landform and none named active names that one active, since two landforms with
none chosen cannot share a denominator (`activeLandform`). The new target is one
of the scene's targets, so adopting one stales the run as adding any landform
does. *Use the site's* takes the landform off the view and leaves the target in
the scene, among *Other landforms*.

An adopted face takes the site landform's objective and VAC and goes on
following them (`followSiteLandform`): a change to the site landform's objective
or VAC reaches every view's landform that still held the same value, and one the
reviewer gave its own (a face in another sensitivity unit may have another
objective) keeps it and says so in its row. Nothing is stored to say which
follows: a face follows while its value equals the site's.

Standing at a view that has a landform (*Stand here*, the summary's arrows, a
capture) makes it the run's active landform, so the run there, the summary and
the saved view's figure read it. The site landform is kept with the stand
(`standing.landform`): a view with no landform of its own, stood at next, reads
it again, *Back to the road* puts it back while the view's is still the active
one, and a capture puts it back afterwards. In Save & export a view of interest
with its own landform is listed with it, the *Landform* part counts the views
that have one, names the site landform when the run is at such a view, and calls
*not assessed* only the landforms nothing uses. The block note still prints one
landform figure, the assessment view's.

### Save & export

The workspace's toolbar has a **Save & export** button, laid out like the road
designer's dialog (`VisualsExportDialog.tsx`, state and builders in
`useVisualsExport.tsx`, the catalogue in `visualsExports.ts`, DOM-free). The
dialog also holds step 5's work beside the file it goes into, so what a reviewer
writes there is what the output prints: the final rating and rationale above the
Package entry (`packageTop`), the Visuals paragraph and measures in the block
note's options, the evidence record in the evidence package's, the workspace
import in the workspace's (`panels`, `useVisualsExport`). The paragraph's panel
stays mounted on the page and its DOM moves into the block note's slot
(`MovableContent`), so its block choice, exclusions and EVQO read survive the
dialog closing. The sidebar keeps the other steps' work — the crew checklist,
the step 4 record — and its buttons only open the dialog on an output (*Save
views…*, step 5's *Rate and package…* and *Visuals note…*, the views of
interest's *Export…*).

| Group | Output | Formats | Options in the dialog |
| --- | --- | --- | --- |
| Chosen once | Package | — | The recipe (a built-in one or your own, made, edited, shared and imported here), who draws the figures, and the views that go in (below) |
| Assessment documents | Block note | Excel, PDF | Each view as its analysis-sheet figure; the land status checks in or out |
| | FS1252 form | PDF | Stations, each one's reviewer inputs, run diagnostics, office fields |
| | Analysis sheet | PDF, PNG | Which of the package's views, figure style, label style, camera block, logo |
| | VIA document | Markdown, JSON | The format, only while the package has no recipe |
| | VIA report | PDF, Word, PDF from the Word layout, Printable HTML, Markdown | The overview sheet's style when the recipe prints one; the maps' style; logo. A *Draft* view lays it out with stand-ins and draws its pictures one group at a time (**VIA reports**) |
| | Field brief | PDF | Block, when there are several (shared with step 2's checklist) |
| | Block map sheet | PDF, SVG, PNG; a series as one PDF or a `.zip` | Sheet type, paper, scale, block, map style, the fields the sheet prints; one sheet per block, which blocks, order, file names; the mask outside the block; logo (below) |
| | Worksheet | Markdown | — |
| | VIA evidence package | PDF, printable HTML | — |
| Save and reopen | Project | `.pgvq.zip` | — (scene, photos, captures and attachments; below) |
| | Scene, Saved views, Assessment workspace | JSON | — |
| | 3D scene | JSON, glTF (`.glb`), OBJ (`.zip` with its `.mtl`), STL | — (JSON for other renderers; the model formats below) |
| For other tools | Scene for GIS | GeoPackage, KMZ, Shapefiles (`.zip`), GeoJSON | — (below) |
| | Castor constraint | `constraints.csv`, zone GeoJSON | — |
| | Prescribed trees | CSV, GeoJSON points | — (every block with a stand prescription; see **Stand prescriptions**) |
| | Road view video | MP4, or WebM where the browser cannot write MP4 | Along the road (speed, stretch, facing) or through the views of interest (which, how long each); the caption. Recorded on request under *Preview* (below) |

Each output's pane opens on a one-line header: the output's name and file
extension, with what it is behind an (i) (`InfoTip`, "About" and the output's
name), and its Save as, Download and Copy image. Under it sit the view switch
and, for an output with more than one format, the format as a dropdown
(`StyledSelect`, named "<output> format").

**Side by side.** Once the output's pane is about 900 px wide (the dialog's
normal size on a laptop screen, which is now up to 80 rem, or *Full screen*),
*What goes in* and the file's preview sit side by side and the Preview tab goes
(`SIDE_BY_SIDE_FOLD`, measured on the pane as mounted). The VIA report keeps its
tabs, since its contents already show the draft beside them. Opening an output
side by side writes its preview at once, unless writing it would first run the
assessment, capture views of interest, wait for another engine's renders or
draw figures from the road view (`DRAWS_FIGURES`): those wait for *Build
preview* (`previewOnRequest`), with what it does first behind the (i), so
opening an output never moves the page or starts a run. What writing an output
does first (the run, a capture, the inventory read, with progress) sits at the
top of the preview column, never across the pane. Every preview is drawn by the
shared file viewers (`docs/shared-ui.md`, **File previews**); the VIA report's
*Draft* and *Preview* are the same viewer, and a line under the tabs says which
is the draft (laid out at once, stand-ins, nothing captured or run) and which
the file Download writes.

The dialog keeps the previews it has written (`KEPT_PREVIEWS`, by output, format and
content version, `previewKey`): going back to an output whose content has not changed
shows its file at once, with nothing prepared, captured or written again. Their object
URLs are freed once neither the shown preview nor a kept one holds them.

Each output's pane has two views. **What goes in** reads the same way for every
output, top to bottom: **Contents**, where the file has parts of its own; then
its **Options**; then what the file **reads**. Contents is the shared
`DocumentContents` list (`docs/shared-ui.md`, **Document contents**), carried by
`ExportSection.contents` so that `exportContents` stays the one DOM-free place
that says what a file holds. The page gives each list its controls (the
dialog's `contents`); without them it is read-only. The VIA report's is its
recipe's parts (below, **The report's contents**). The block note's is its
sheets and pages as `blockNote.ts` writes them, in their fixed order: what the
planner's layout always writes is locked, the visual measures and the viewpoint
records say why on their row when there is nothing to write, and the land
status checks are the one switch (figure or screenshot stays an option). The
FS1252's is its stations, *Stations in the PDF*: a station switched off leaves
the form and keeps its place in the list until it is removed under Options,
which still adds stations and holds each one's reviewer inputs. The package's
views keep their own checklist under *Package*: a thumbnail and a capture state
in a sentence do not fit a contents row. Below Contents and Options, the file
**reads** the parts it carries: the landform (name, objective, VAC,
area, source), the viewpoint, every saved view with the settings it was saved
with (position, facing, eye height, lens, timber, harvest phase, design), the
blocks and masks, the run's status and figures, the run settings and the
review. A part that a section of the sidebar sets is changed where it is listed:
*Edit here* opens that section under the part's rows (the block's cards under
*Block*, *Landform and objective* under *Landform*, *Road or viewpoint*, the
*Simulation* section under *Run*, step 4's judgements under the parts that
print them, the views of interest under theirs). It is the section itself,
moved into the dialog while it is edited there and back afterwards
(`Projectable` in `Sidebar.tsx`, `ExportSection.editor` in `visualsExports.ts`),
never a second form, so a change made in either place is the same change, and
the rows above it update as it is made. Starting a drawing from one (*Draw
landform*, *Place the viewpoint*) closes the dialog and opens the step that
holds the drawing's controls. A part with no such section, or one a saved view
or the package sets, keeps its link: *Change in step N* closes the dialog on
that step, *Change in Package* and *Rate in Package* open the package's entry.
No part points at step 5, which only opens Save & export.
**Preview** builds the file itself and shows it (a PDF in the browser's viewer,
an image, HTML in a sandboxed frame, an Excel workbook as its sheets read back
from the file by `workbookPreview.ts`, a Word file as its pages laid out from
the file by document-kit (`viaReportWord.ts`), text); *Download* saves that
same file. A
binary file that is none of these is read back from its own bytes as text
(`exportFilePreview.ts`, DOM-free): a GeoPackage is reopened with SQLite and
lists each layer with its feature count, columns, first rows and whether it has
a QGIS style; a KMZ shows its `doc.kml`; a ZIP lists its files with each
dBase table's record count and fields and the text of its README, `.prj` and
`.mtl` and the head of an `.obj`; a glTF binary its parts with their triangles
and its notes; an STL its header and triangle count. `BuiltFile.readBack` names
the reading for a ZIP whose type alone does not (the project ZIP keeps its file
list). An output that cannot be written yet says why in the list (no block, no
view in the package, the road view closed, a scene that cannot run).

**Save as…** sits beside *Download* for every output where the browser has a
save dialog (`saveFileAs`, `src/lib/saveFile.ts`; `docs/shared-ui.md`, **Saving
a file where the person chooses**), and is hidden where it would only repeat
*Download*. The dialog opens first, inside the click, named after the previewed
file when there is one (else `suggestedExportName`) with the format's type
(`exportFileType`); only once a place is chosen is the file made, exactly as
*Download* makes it (`fileToSave` in `VisualsExportDialog.tsx`: the previewed
file when nothing waits, else the run, the captures, the inventory read and the
renders first). A cancelled dialog makes nothing. *Download* is unchanged and
still fires the browser's download, which the end-to-end suites wait for.

**Copy image** (`CopyImageButton`; `docs/shared-ui.md`, **Copying a picture**)
sits beside *Save as…* and *Download* on the analysis sheet and the block map
sheet, once their preview is current, and copies that previewed sheet as a PNG
at print resolution: the analysis sheet through the writer of its PNG format
(`figurePng`, 2 px a point, from the same composed figure, so the same
with-timber measure), the block map sheet through `sheetFile` at
`SHEET_PNG_DPI` (150 dpi) from the sheet as drawn for the preview. A file
written with `BuiltFile.copyPng` offers it; nothing else does. Copying never
starts the run, a capture, a before render or an engine render: it is offered
only for the file already previewed, never in its place, and is hidden while
the preview is being written or out of date. *Download* still makes the file as
it always has, so where it would try a failed capture again it may differ from
what was copied. A block sheet series has nothing to copy: it is many pictures.
Where the browser cannot copy images the button is not shown.

A long file shows its progress beside the buttons while *Download* or *Save
as…* writes it (`BuildOptions.onProgress`; a block sheet series sheet by sheet),
with *Stop*; closing the dialog stops it too, and nothing is saved.

**Scene for GIS** (`sceneGis.ts` builds the layers, `sceneGisFiles.ts` writes
them; both DOM-free, sql.js passed in) puts the scene's shapes where QGIS,
ArcGIS or Google Earth can open them, one layer per kind the scene holds, in
WGS84:

| Layer | Geometry | Fields |
| --- | --- | --- |
| `landforms` | area | `id`, `name`, `assessed` (the run's landform), `objective` (code) and `obj_name`, `vac`, `area_ha`, `inv_unit`, `source` |
| `existing_openings` | area | `id`, `name`, `harv_year`, `cc_pct` (the inventory's percent clearcut as recorded), `area_ha`, `source` |
| `masks_natural`, `masks_private`, `masks_permanent`, `masks_retained` | area | `id`, `name`, `kind` (stored) and `kind_label` (`MASK_LABELS`: `retained` reads *Wildlife tree patch / retention*), `landform` it was traced on, `mappedrock` (natural only), `area_ha`, `source` |
| `tree_free_areas` | area | `id`, `name`, `area_ha` (display only, and the layer says so) |
| `blocks` | area | `id`, `name`, `system` (stored) and `system_txt` (as shown), `retain_pct`, `remove_pct`, `residual_m`, `plan_year`, `area_ha`, `block_code`, `licence`, `permit`, `opening`, `source` |
| `road` or `viewpoint` | line or point | `id`, `name`, and `length_km` for a road or `eye_elev_m` (the surveyed eye that applies) for a spot |
| `view_wedges` | area | `id`, `number`, `name`, `bearing`, `hfov_deg`, `reach_m`: the lens's width along the view's facing as the plan draws it (`viewsOfInterestPlan`), a drawing aid, never a sight line |
| `views_of_interest` | point | `id`, `number`, `name`, `block`, `block_id`, `facing`, `bearing`, `lens_mm`, `hfov_deg` (the field the capture uses), `framing`, `from` (map, vli, rec-site), `included`, `landform`, `coord_text`, `coord_crs` and `coord_prec` (the typed place while the view stands there), `eye_ref` and `eye_m` (its surveyed eye) |

A kind the scene holds none of is left out and named under *None in the
scene*. Field names are at most ten characters, so the shapefiles keep them
(in dBase's capitals, said once in their README). Areas are planar BC Albers
hectares (`blockAreaHa`, the block map sheet's), to four places. It reads only
the scene: no run figures, visibility samples, percentages or live inventory,
so it is not in `RUNS_ON_EXPORT`, needs no run and stales nothing; *What goes
in* lists the layers with their counts from `sceneGisPlan`, the same items the
layers are built from, and says what is not in the file. Sub-landforms and
lines of force are drawn from the terrain and never stored, so they are not in
it. The preview is current while the scene's shapes are the same objects
(`gisVersion` in `useVisualsExport`), since views of interest and tree-free
areas are outside the run's key.

Each layer is drawn in the plan map's colours (`SCENE_GIS_LOOKS`, from
`ROLE_COLORS` and `planMapStyle.ts`, at the plan's fill opacities): the
GeoPackage carries a QGIS default style per layer in `layer_styles` (QML from
the style exchange's `qmlForLayer`), each shapefile its `.qml` beside it, which
QGIS loads with it, and the KMZ one style per layer folder. GeoJSON is one
collection whose features name their `layer` and carries no style. Every
writer's warning (a value cut to fit a dBase field, a renamed table) comes back
with the file, shown over the preview and in the saved line, and the
shapefiles' README lists them all.

**3D scene as a model.** The *3D scene* output keeps JSON first and unchanged
(other renderers read it) and also writes the same scene package through
`sceneModelExport` (`sceneModel.ts`) as glTF binary, OBJ zipped with its `.mtl`,
or STL. It is a simplified drawing to look at in Blender or SketchUp: the
ground from the package's grid, cut ground and water as their own parts, and
each tree a generated low-polygon shape of its own height and crown, never the
road view's drawings; display only. The model's notes (what was thinned to fit
`SCENE_MODEL_TRIANGLE_BUDGET`, the origin, what the format cannot carry) are
shown with the file. Its availability is the scene package's: the road view
open with its terrain loaded.

**Road view video.** *For other tools → Road view video* records what PGMaps'
own road view draws, as a video file. The plan is `roadVideo.ts` (DOM-free:
what a take records, its length, its refusals, the caption, the file name and
*What goes in*); the take is `useRoadVideo.ts`, recorded with the shared
composed recorder (`src/lib/mapRecording/canvasRecorder.ts`). Two takes:

- **Along the road**: the road view's own drive (`DriveController`) from the
  start of a stretch of the assessed road to its end, at one of the road view's
  speeds (`DRIVE_SPEEDS_KMH`), looking along the road or, when the road view
  faces something, toward it as it does now. It is the drive the reviewer sees,
  not a second camera path. A road view standing at one spot (a viewpoint's
  pull-out) has no road to drive and offers only the views.
- **Through the views of interest**: each chosen view in the list's order, held
  for a chosen time, with a cut between views: the eye never flies across the
  terrain between them. The drive camera stands at each view as it stands at a
  lined-up field photo (`standAt`, `fixedLook`, the view's lens as
  `horizontalFovDegrees`): the eye at the view's place over the road view's own
  ground mosaic, facing its block or its bearing. It never stands there through
  the page's stand-at action, which would run the assessment there, so a view
  off the ground the road view has loaded, or a photo view taken from the air,
  is left out and named. A view is filmed through one frame of its lens; a
  panorama's frames are not joined.

It is display only. A take borrows the drive camera (`videoDrive` in
`DevForestryVisuals.tsx`, mapped onto `DriveCamera`'s props) and never writes
`drive`: the reviewer's place on the road, speed, facing, lens and harvest
phase stay as they were, and the take's pose reports never reach
`drive.positionMeters`. Handing the camera back (`drive(null)`, in the take's
`finally`, on success, *Stop*, an error and the dialog closing) seeks it to the
reviewer's place again with the look they had, and `DriveCamera`'s own lens
effects put back the vertical field. It starts no run, stales none and changes
no scene, saved view or setting; a capture of views of interest is refused
while a take runs. The caption burned into every frame (on by default) names
what is shown (the stretch and speed, or each view by name) and says, on its
second line, the harvest phase and *Drawn by PGMaps: a drawing of the scene,
not a photo simulation*. No figure, percentage or rating is printed.

While a take runs the eye map draws every frame (`triggerRepaint` each
animation frame: the road view's frame loops sleep when nothing moves, which
would freeze the video), each frame is copied into the recorder inside the
map's `render` event, and the guide layers are hidden as every capture hides
them (`hideRoadViewGuides`, looked at again each second). Between views nothing
is copied until the next view has drawn (the camera placed, the timber near it
grown and its tiles loaded, held for `steadyMs`), so the video holds the last
view meanwhile and the cut lands on a drawn view. The look is the road view's
own (its harvest phase, *View options* and *Drawn timber*), listed in *What goes
in*; a take never lowers the drawing quality under itself. With another engine
drawing the road view, the video records PGMaps' own map drawn underneath it
and says so in its caption and *What goes in*: an engine's frame is never
recorded as PGMaps' drawing.

The road view must be open on the assessed road with its terrain loaded. The
dialog stays where it is while a take runs: the road view keeps drawing at its
full size behind it (the recorder reads its canvas, not the screen), and the
pane shows a small live picture of what is being recorded. Opening the output
or its *Preview* never starts a take: *Preview* shows the planned length and
*Record*; while it records, its progress in seconds and *Stop*, which keeps what
was recorded and says the video ended early; afterwards the recorded file
itself in a player. *Download* and *Save as…* write that file and never record
again; they wait for a take, and so does every other output's preview and file
while one runs (a take moves the road view). Closing the dialog cancels a take
and keeps nothing. The last take is kept for the page's life, and is this
output's file only while the choices and the look are the ones it was recorded
with (`RoadVideoPlan.key`). The choices are this browser's
(`pgmaps.forestryVisuals.roadVideo`), never the scene's or the project file's.

Browsers: Chrome and Edge (from 126) and Safari write MP4 (H.264), which plays
almost everywhere; Firefox writes WebM. Recording is in real time: a two-minute
drive takes two minutes to record, and a hidden tab stops the take (a browser
stops drawing it).

| Limit | Value | Constant |
| --- | --- | --- |
| Longest video | 10 min; a longer plan is refused with a way to shorten it (a faster speed, a shorter stretch, a shorter hold, fewer views) | `ROAD_VIDEO_LIMITS.maxDurationMs` (`MAX_RECORDING_MS`) |
| Shortest stretch of road | 25 m | `ROAD_VIDEO_LIMITS.minStretchMeters` |
| Hold per view | 1–60 s, 5 s by default | `ROAD_VIDEO_LIMITS` |
| Speed | the road view's speeds, 5–120 km/h; 40 km/h by default | `DRIVE_SPEEDS_KMH`, `ROAD_VIDEO_LIMITS.defaultSpeedKmh` |
| Start of the stretch drawn | 60 s, else the take fails and says why | `ROAD_VIDEO_TIMING.placeMs` |
| One view drawn | 45 s, else that view is left out and named | `ROAD_VIDEO_TIMING.viewMs` |
| A stalled take | stops itself at the plan's length and half again plus a minute (a tour: plus 45 s a view), keeping what it has | `runRoadVideoTake`'s `maxDurationMs` |
| Frame | the road view's canvas at the display's resolution, even sides, at most 3840 px a side | `recordingFrameSize`, `MAX_RECORDING_FRAME_SIDE` |
| Frame rate, bitrate | 30 fps, 12 Mbps (about 90 MB a minute) | `DEFAULT_RECORDING_FPS`, `RECORDING_BITS_PER_SECOND` |

**Block map sheet.** A printed map of one proposed block in the sheet types the
road designer prints (field layout, slope, hillshade, 1:50,000 access, imagery,
the operating plan; `docs/forestry-block-map-sheets.md`, **On the visual quality
page**), drawn from the scene by `visualsBlockSheet.ts` through the shared sheet
builder and written by `visualsBlockSheetPdf.ts`. It is a map of the scene: it
reads nothing but the terrain tiles for its frame, prints no figure from the run,
and so waits for no run, capture or render. Its *Map style* is PGMaps' sheet
symbols or a figure style (`visualsSheetSymbols`), whose landform, block,
opening, private-land and rock symbols then draw those features on the map and
in its legend. Its sheet type, paper, scale, typed fields and style are kept in
this browser (`VISUALS_SHEET_STORAGE_KEY`), never in the scene or the project
file, as the road designer keeps its own; a blank F.L., CP or Forest District
prints the FS1252 office field. What a sheet was written without (terrain that
did not load) is said over the preview and beside the save line
(`BuiltFile.notes`).

It is written as a PDF (the default, drawn exactly as before), an editable SVG
or a PNG at 150 dpi (`writeVisualsSheet`, DOM-free, with jsPDF or the
rasteriser passed in by `visualsBlockSheetPdf.ts`). The format is the dialog's
chips, stored with the sheet's other settings (`VisualsSheetSettings.output`),
so it is chosen in one place; under the sheet's options, *File*
(`MapSheetOutput`, `showFormat={false}`) chooses one sheet per block, which
blocks and in what order, the file names in a ZIP, and *Dim the map outside the
block*. A series takes the scene's proposed blocks (`visualsSeriesBlocks`; a
block's planning ids fill `{attr:BLOCK}`, `{attr:FL}`, `{attr:CP}` and
`{attr:OPENING}`), frames each sheet on its block with its typed fields and
comments filled for it (`visualsSeriesPageRun`), and writes one PDF of a page a
block or a ZIP of one file a block (`writeSheetSeries`). With one block in the
scene there is no series. *What goes in*'s *File* section reads the same plan
the file is written from (`visualsSheetOutputPlan`, `visualsSheetFileRows`): the
format, one sheet or how many pages in which container, the blocks in order,
the ZIP's file names, the mask, and the terrain read; the row and the dialog's
heading show the download's extension (`.zip` for a ZIP series).

- **A block chosen earlier and gone is left out, never replaced.** The series'
  block list is ids kept in this browser; ids the scene does not have are
  dropped from the series and counted under *Chosen earlier* (and under the
  form), and the list keeps them until the blocks are ticked again, since
  another scene opened in this browser may hold them. With every chosen block
  gone the sheet cannot be written and says why; *All* takes in every block,
  new ones included.
- **The preview of a series is its first sheet**, written as the series writes
  it (in the page's format) and marked as such over the preview
  (`BuiltFile.previewOf`). *Download* never saves that preview: it makes every
  sheet, then writes the file. Previewing the whole series would read terrain
  for every block on each edit of the options.
- **A series costs a sheet's reading per block.** Each sheet reads its own
  terrain tiles, up to `SHEET_DEM_TILE_BUDGET` (64), so a series of N sheets
  reads up to 64 × N, and an imagery sheet captures its imagery once a sheet;
  at most `MAX_SHEET_SERIES_PAGES` (50) sheets. The sheets are made one after
  another; *Download* shows which, and *Stop* or closing the dialog cancels it.
- **A sheet that cannot be made is left out by name** (its terrain did not
  load, say) and the rest are written; the left-out sheet and its reason are
  said beside the save line and, in a ZIP, in `notes.txt`.

**The VIA report's map style.** The report's maps keep their own symbols unless
its options name a figure style (*Map style*): the overview map, the 11 × 17
sheet in either style and the figure page's location map then draw the proposed
blocks and existing openings with that style's symbols and list them so in their
legends (`figureMapStyle`, carried on `ReportMapFeatures.symbols`; a role the
style does not draw keeps the map's own). The choice is part of the maps'
picture key, so changing it draws the maps again and nothing else.

**Package, chosen once.** First in the dialog's list, under *Chosen once*,
**Package** (`ExportPackagePane` in `VisualsExportDialog.tsx`, resolved by
`resolvePackage` in `visualsExports.ts`) holds the choices the outputs share,
summarised on its entry in one line (recipe · renderer · n views, k to
capture):

- **Recipe**: a VIA report recipe, which names the VIA document's format, so
  the report and the document agree; or *No recipe*, when the document's own
  format choice (else the road view's figure style, else the first format)
  chooses and the report follows it.
- **Figures drawn by**: PGMaps, or an engine at final quality in the background
  (see **Figures drawn by another engine, in the background**), for the
  analysis sheet, the VIA document and the VIA report.
- **Views**: two shared contents lists (`DocumentContents`, two-state, with All
  and None and no reordering, since the package's view order is not chosen
  here): *Views of interest*, each planned view led by its thumbnail
  (`rowLead`), its block and lens under its name, and its capture state on the
  row when it is a word ("Captured") or under the name when it is a sentence;
  and *Saved views*, every saved view that is not a planned view's capture, led
  by its screenshot. A view of interest's box writes its `include`, which is in
  the scene (absent reads as included); a saved view's lasts while the page is
  open. All or None writes the whole list in one change. The lists only draw
  what `resolvePackage` holds. A saved view captured for a planned view that has
  since been removed becomes an ordinary saved view.

These were per-output choices before; each output's own options keep only what
is its own. `resolvePackage` gives one set of views (`viewIds`) and its
complement (`excludedViews`), and the block note, the field brief, the analysis
sheet, the VIA document and the VIA report (`USES_PACKAGE_VIEWS`) all read that
set, engine renders included. A view of interest goes in through its current
capture alone: an earlier capture, or one taken under another key, is left out,
so no file is written from a stale capture. The block note and the field brief
are written for one block (`FOR_ONE_BLOCK`): a view of interest planned for
another block is left out of them, never captured for them, and listed in *What
goes in* as for another block (`excludedForBlock`); a saved view not captured
for a planned view goes in as before.

**Every view prints or is named.** The analysis sheet, the VIA document and the
VIA report (`DRAWS_FIGURES`) draw a view from its class pass. A view of the
package they cannot draw (saved without its analysis sheet, with the reason its
save gave, `figureError`; or with no screenshot in this session) is listed under
*Views not drawn* and named in the preview's notice, the download's line and the
file itself: the report ends with *Views left out of this report* and lists each
to complete, the document with *Views left out of this document* and lists
each under *Reviewer to complete* (`unprintedViews`, `viewsLeftOut`,
`withViewsLeftOut`, `withViewsToComplete`). Neither is refused for a missing
class pass: with no view of the package drawn, the report and the document are
written all the same, printing no figure and no picture for any view and
naming each to complete; only a package holding no view at all is refused, with
the reason. A VIA document viewpoint
whose picture holds none of the landform says so rather than "no class pass"
(`documentFigureLine`).

**Per-view fields come from the view's own record.** A report's viewpoint name,
place, coordinates, direction, field of view, location map and inventory unit
come from the view's saved figure (`viewImages[id]`, its `figureAt`), never the
road view or the place stood at when the file is written. An engine draws only
where the road view stands: a view saved at another place gets no background
render (`renderJobFor`) and keeps PGMaps' figure and before picture, which the
renderer row and the pair's note say; a render keeps the saved figure's names
and place (`savedIdentity`).

**Capture on export.** Preview and Download of an output in
`USES_PACKAGE_VIEWS` first capture the included views of interest not captured
with their current key (`viewsToCapture`, in the dialog's `prepare`, through
the same capture as step 2), show its progress with *Cancel capture*, let the
page settle once the capture has put the reviewer back, and write the file from
the views as captured. A view whose capture failed under its current key is
skipped by Preview, so a preview never loops on it, and tried again by
Download. A file written without an included view says so (`uncapturedNote`),
in the preview's note and in the download's *Saved* line, naming each view and
why. A cancelled capture writes nothing, and closing the dialog cancels a
capture it started. Such an output is available while any included view is
still to capture, since the export captures it first.

The VIA report's before pictures and the analysis sheet's with-timber figure
(`NEEDS_BEFORE`) pair a view with its before-harvest render. Their capture also
takes each view's render where it stands (`capture(ids, { before: true })`,
kept in the page's `capturedBefore` under the view's capture key), and a captured
view away from where the reviewer stands with none (`beforeOwed`) is captured
again for it (`beforeToCapture`; one whose render failed under its key waits for
a download). `captureBeforeRenders` takes a kept render first; a view saved at
another place without one is absent, with why, never framed on the road view's
terrain where the reviewer stands. After a capture the export waits for the road
view to open again when it was open, so the views saved here render. Files are
written one at a time: a preview started while another file is being written
waits for it, and the pane says what it waits for; the outputs that draw views
wait for a run in progress (`waitsForRun`).

**The export makes what it reads.** The block note, FS1252, field brief,
worksheet and Castor constraint read the run (`RUNS_ON_EXPORT`). When it is missing or stale, Preview
and Download start it themselves in the analysis worker (the sidebar's own run,
`useVisibilityAnalysis`), show its progress in the pane, and write the file from
the render after it finishes and the page settles (`exportPreparation`, the
dialog's `prepare`); a run that stops or fails is an error in the pane, never a
file from the old run. The block note also waits for the land status checks to
finish reading (up to 30 s; a layer still reading then prints *Not read*).
Nothing renders a screenshot at export: views are captured at *Save viewpoint*,
or by a planned view's capture, which saves through the same path before the
file is built.

The block note's pane shows what the report will hold:

- **Views of interest** — each planned view with its block, lens and state:
  in the file, left out, to capture before the file is written, or not
  captured and why.
- **Viewpoints in the report** — every other saved view, here or at another
  viewpoint, marked in the report (as its screenshot or figure), left out, or
  not in the note for want of a screenshot; which go in is chosen under
  *Package*.
- **Inventory viewpoints near the block** — the BC Visual Landscape Inventory
  viewpoints and rec sites round the note's block (`viewpointsNearBlock`), read
  when the dialog opens on the note without switching the plan's inventory
  layer on. They are not in the report until captured: *Stand here* closes the
  dialog and stands there in the road view facing the block, where *Save
  viewpoint* adds it.
- **Land status checks** — the cards' checks (`useLandChecks`) as the note
  prints them (`landCheckReportRows`): their own *Land status* sheet and PDF
  page with the caveat that they are a DataBC screen, never a legal
  determination or a mask. On by default; *Options* leaves them out.

**Project ZIP** (`projectArchive.ts` and `projectFile.ts`, DOM-free). *Project*
writes a `.pgvq.zip` archive. Step 1's *Open a project…*, under *Start from*,
opens it and still reads earlier `.pgvq.json` files. The archive holds the scene
(blocks, landforms, the road or viewpoint, views of interest, settings, the
review with its hand edits), every saved view here and at other viewpoints
(the shelved ones, under the scene fingerprint they were saved in) with its
screenshot, its analysed figure (class pass, callouts, framing, `figureAt`) and
its before-harvest render, another engine's finished figures, the assessment
workspace, and the package's renderer and recipe. Terrain and inventories are
read again, and the first output that needs the run makes it again. The ZIP
contains `project.json` with references to image files under `photos/` and
`captures/` and an `archive.json` manifest. Successful local photo imports
also keep the original file under **Project attachments** (the paperclip
beside *Save & export*, `ProjectAttachments.tsx`), where other source files can
be attached; a file that is a field record's original is removed only with its
record (`removePhoto`). The project file's *What goes in* lists them with a
*Manage…* button to the same dialog. The open local photo comes back with its edited
camera. ZIPs can be up to 400 MB, including their expanded contents.
A figure's rasters are gzipped one by one
(`CompressionStream`) and written as base64, since a class pass is tens of
megabytes raw and a few kilobytes packed. A file is read through the scene's
own reader and checked piece by piece: a view whose numbers do not read, a
picture that is not a PNG or JPEG data URL, or a figure whose class pass is not
the size it states is left out and named in the line the page shows after
opening, never repaired, and a view whose figure fails keeps its screenshot and
says its analysis sheet was not read. A file from a newer PGMaps is refused.
The file also keeps `sceneKey`, the fingerprint of its scene as it reads back,
which the views at the scene's place were saved under. The line shown after
opening (step 1 and the header's status line) is the open receipt, read from
the opened state only, with nothing run (`projectOpenedLine`,
`projectOpenStatus`): the views and pictures that came back; whether the saved
figures are the scene's as it opens (`ProjectSummary.figures`: the same key, an
earlier calculation of the scene, which keeps them as saved and warns that a new
run may differ, or not stated by a file written before the key was kept); that
there is no run yet, since the file never holds one; the package's recipe
(`projectRecipeStatus`: a shipped recipe by name, your own one kept in this
browser, or an own recipe this browser does not hold, or an id this PGMaps does
not know, either way with the format's recipe used meanwhile); how many earlier
captures of edited views are listed under their views; and what was not read.
Views keep their ids, so each finds its picture; *Saved views* renumbers them,
needs a road and keeps no pictures, which is why it could not serve. The other
three files stay for their own uses: *Scene* for the scene alone, *Saved views*
for the scene and views without pictures (step 1's *Open a project…* reads one,
`openProjectFile`), *Assessment workspace* as the browser store's backup.
Opening a project replaces what is on the map and the saved views without
asking, as the *Start from* samples do. *New site* and each sample also start
the workspace clean (`startNewSite`, `useAssessmentTools.tsx`): the own photo
set, every field record and its original, design options, runs, earlier
viewpoints, block curve assignments and reference measurements go; the growth
curve and the Castor curve library stay, as the reviewer's inputs rather than
the site's records.

Every switch of site (*New site*, a sample, a Saved views file, a project,
*Reopen previous site*) is one `transitionSite` in the page. It bumps the
session's site generation (`siteTransition.ts`), and every piece of work that
awaits (a save's screenshot, photo and analysis sheet, a capture's before
renders and its step back, a background render, a geometry import) checks the
guard it took when it started, so nothing finished for one site lands in the
next. The last site's saved and shelved views go with their pictures, before
renders and engine figures, and the project file writes only what a saved or
shelved view holds (`reachableProjectState`); an engine figure for a view the
file does not hold is left out and named when it is opened. Before anything is
cleared, the site left is written as a project file into this browser
(`previousSites`, one slot, `savePreviousSite`), so its photos, attachments and
pictures are not lost: *Reopen previous site* opens it as a project, which is a
switch too, so the two sites swap. Nothing is asked. An empty new site, or a
sample as it opened with nothing saved at it, is not kept (`siteWorthKeeping`)
and leaves the slot as it was; only a site whose project would pass
`PREVIOUS_SITE_MAX_BYTES` (150 MB), or that the browser will not store, asks
once: save it as a project, discard it, or stay.

**The open site across a reload** (`siteCheckpoint.ts`, DOM-free;
`useSiteCheckpoint.ts`). The scene, the saved views of the scene open, the
workspace, the attachments and the own photos each have a store of their own.
The rest (views shelved at other places, every view's picture, caption,
analysis sheet and viewpoint record, before-harvest renders, engine figures,
the package's renderer and recipe, the project's title) is kept as the site's
checkpoint: the project file's own format (`writeProjectArchive`), without the
attachment and photo bytes or the workspace that those stores already keep,
written into the `current` row of `previousSites` (a `work` store) about 1.5 s
after the page stops changing (`CHECKPOINT_DELAY_MS`). The page writes nothing
until the scene has been read and the checkpoint opened, so its empty start
never erases it. Opening it keeps whatever the page already holds and fills
only what it lacks (`mergeCheckpoint`): a picture taken or a view saved since
the page opened stays, the Saved views record (written at once) outranks the
checkpoint's views but takes back the ids it renumbers (`view-0`…) from the
checkpoint's views of the same content, so each finds its picture again. That
holds for a set the record keeps under another scene too (a view of interest's
capture, saved where the capture stood and shelved when the reviewer was put
back): it is the checkpoint's set under the same key, else the one set whose
views share its content, because a scene made in the page and the same scene
read back from the record have different keys; the record's set is then held
once, under the kept ids. Its scene is taken only when built at a later scene
revision than the one read (`usePersistentScene`'s `revisions`). A write never
replaces a stored checkpoint of the same site built at a later revision
(`checkpointMayReplace`). Each site has a random id kept beside the scene
(`SITE_ID_STORAGE_KEY`) and replaced by `transitionSite`, which also drops the
last site's checkpoint (it was just kept as the previous site); a write still
building for the last site is dropped, and a checkpoint naming another site is
never opened. Step 1's *Start from* says quietly how it stands: "Kept in this
browser 14:02", or "Not kept in this browser" with the reason (over
`PREVIOUS_SITE_MAX_BYTES`, refused by the browser, a newer copy from another
tab). Nothing is asked. Two tabs on two different sites share the one slot, so
only the last written comes back.

**Reviewing a historical VIA.** Open the project ZIP in **Step 1 → Start from**,
then open **Project attachments** (the paperclip) and choose **Reference
measurements**. Earlier converted projects import their attached `case.json` on
open. A standalone case can be imported from the dialog's header, beside the
row picker and *Add measurement*. Each row's work is a tab (*Measurements*,
*Geometry*, *Image trace*, *Run*, *Compare*, and *Exhibits* when the project
carries a figure catalogue), mounted when first shown and kept while another is
chosen. Choose a viewpoint and landform to open its original sheet, inspect the
transcribed measurements and enter corrections. Tab out of an edited field or
press Enter to apply it. Clear **Use reviewer value** to use the transcription again. The alternative value and its evidence note remain available.

Where each row was printed comes from the case file alone (`caseCitation`,
`referenceMeasurements.ts`): a row's own `page` and `source`, else the case's
`pages` (by viewpoint id, `table5` for Table 5 rows), `blockPages` (a Table 5
row, by its block), `appendixPageOffset` (a sheet "Appendix A*n*" printed on page
*n* + offset) and `originals` (the attached file for a viewpoint), else the one
attachment named for the case's `doc`. The code keeps nothing about any real
case, and real assessments, their names, block codes and figures never enter the
repository: tests use made-up cases. A field a newer file adds is left out and
named when the project opens, never the row or the workspace.

The source arithmetic divides the transcribed numerator by the denominator the
sheet used. A sheet that prints 12.4% for 25 cm² over 200 cm² recomputes to
12.5%; deducting 40 cm² of rock gives a net area of 160 cm² and a separate
calculation of 15.625%. The dialog keeps ocular ratings and incomplete operands
as evidence. A percentage band appears only for an unambiguous match in the
explicit ranges transcribed from the source. Study-wide statements and
unlocated viewpoints can keep their source labels with the mapped links unassigned.

A case can also carry separate Table 5 determinations by block or sub-landform.
**Show all fields** exposes the sourced design, treatment, ocular, adjustment and
rationale fields, including empty fields a reviewer can supply. **Review setup
and calculation choices** selects the numerator and denominator. A new reviewer
row can start with an empty transcription. Corrections, field-specific evidence
and saved comparisons travel in **Save & export → Project**.

- **Study geometry and registration** shows attached polygon candidates on a plan
  map beside a source figure. Choose the landform for the linked view, a dated
  proposal, a mapped treatment unit, or a mask. Replacing a proposal saves the
  preceding design in the design library. Private, rock and natural exclusions
  apply to their selected landform. Rock and private land can also be deducted
  from the captured image denominator. A mapped unit splits the selected block
  at its boundary. Residual stems per hectare, percentage of trees removed and
  percentage of volume removed have separate fields. A partial cut uses its
  documented volume removed and residual height: adopting a treatment unit
  writes the block's harvest system, volume removed and residual height on the
  reviewer's click, the one way besides *Use for Table 5/6* that those inputs
  change, and it clears a stand prescription the unit replaces. Where several
  candidates could be the block, the choice stays the reviewer's.
- **Register an image and project a trace** links an attached image or field
  photo to a row. Enter the camera station, absolute eye elevation, orientation,
  projection and crop. The horizontal span applies to the selected crop.
  The terrain skyline and mapped fit points can refine heading and pitch at the
  supplied station. Held-out points display their own pixel errors. Review the
  overlay, **Confirm sheet camera**, then project an outline or exclusion. Missing
  terrain and range jumps leave gaps that must be resolved before adopting the
  trace. Confirming the sheet camera is the row's own record and never accepts an
  own photo: for a photo record, **Line up in the own photo window** hands the
  camera to that window as a matched camera, where it is checked and accepted
  through the same gate as any other (`acceptGate`). This dialog never writes a
  photo's pose.
- **Numerical run and offline replay** uses the selected viewpoint and landform.
  Choose the workspace station or the confirmed sheet camera's station, and the
  scene year or an assessment year override. **Run and retain inputs** keeps the
  run's effective inputs, including terrain samples and inventory geometry, for
  this session; save them from **Save & export → Sightline replay archive**. The
  project never holds terrain, an inventory or the run, so the archive is its own
  file. Replay takes this session's archive, a chosen `.sightline.zip`, or one an
  earlier project attached, checks the SHA-256 hashes and recomputes the
  numerical figures without a data service. The archived figures allow a reviewer
  to detect a change in the calculation. The comparison (`compareReplayFigures`,
  `replayComparison.ts`) holds the assessment station, the sightline count, the
  number of stations and which figures are present or null exactly, and lets a
  percentage differ by `REPLAY_TOLERANCE_PP`, 1e-6 points: summing in another
  order moves a figure by about 1e-14 points, while one sightline of 21,348
  moves it by about 0.0047. The input checksums stay exact. The panel prints the
  largest difference and the archive's calculation version (`calcVersion`,
  `SIGHTLINE_CALC_VERSION`; "not recorded" in archives written before it), and
  names what differs when the replay fails.
- **Compare with a saved PGMaps figure** uses the class counts from a saved
  after-harvest sheet for the linked view and mapped landform. The original
  percentage, source calculation and selected comparison stay visible. Choose
  the source and capture measurement bases and check framing, treatment and
  exclusions. A percentage-point difference requires matching bases. The run's
  sightline figure at capture is printed beside the pixel figure, never replaced
  by it, and called the assessment's figure only where the capture recorded
  that the run stood behind it (`comparisonSightline` over `capturedSightline`);
  a figure kept without that record is labelled as the run's reading at
  capture. A saved review keeps the selected values, source, counts, reviewer and
  evidence hashes.
- **Study exhibits** searches the figure catalogue by caption, document, page,
  viewpoint or recorded date and opens the selected exhibit and its source.
  **Visit → Views of interest** captures pending included views 1, 3, 6 or 12
  at a time (**Views per capture**). A saved project keeps completed captures so
  the remaining views can be captured later; the plan holds no more views than can
  be saved (`MAX_VIEWS_OF_INTEREST`).

**Castor constraint** (`castorConstraint.ts`, DOM-free) writes the landform's
objective as the cover constraint a timber supply model carries, for
`/dev/forestry/castor` and forestryCastor's `zoneConstraints`: type `le` on
`height`, so no more than the percentage of the zone may stand at or below the
threshold. The threshold is the run's own area-weighted Table 6 green-up height
for the landform and the percentage the objective's planimetric figure as the
Results panel resolves it (`resolveThreshold`: the reviewer's override, else
Table 4 by VAC, else the medium VAC midpoint), each named in the GeoJSON. The
zone is the landform, in a `zone:vqo` column (Castor reads `zone:<name>`
columns), to intersect with a Castor inventory. Castor divides by the zone's
whole area while the planimetric figure divides by the landform's treed area;
the file says so rather than converting the percentage.
`castorConstraint.test.ts` runs the written row through Castor's own engine on
its example project and checks every period holds it.

The 3D scene still needs the road view open (it writes where the eye stands
now); its pane offers *Open the road view* rather than opening it unasked.

Rules: the dialog never writes to the scene except the FS1252 office fields
(`reportMetadata`, as before), the field brief's block and a view of
interest's `include`; its other choices (the package's recipe and renderer,
saved views left out of the package, stations, figure style, land checks in or
out) last while the page is open, and the stations reset with the run as the
sidebar's did. A capture it starts adds saved views, as *Save viewpoint* does. Closed, `useVisualsExport` returns before building anything:
the page re-renders several times a second while the road view moves. Add a new
file to `VISUALS_EXPORTS`, `exportUnavailable`, `exportContents` and the
hook's `build` together, never as a download button in the sidebar.

### Map layers, landform readings and viewpoint arrows

- **Measure and draw on the plan.** The plan's Measure button, above Layers,
  is the shared measure tool (`map-measure.tsx`): a distance, an area or a
  circle, read in a card at the top left, not saved. Drawing a block, a
  landform, a tree-free area, a wildlife tree patch or the road uses the same
  sketch (`MapSketchDraft`): numbered points, a rubber band to the pointer, an
  area closed by a click on its first point, a double-click or Finish. While
  either is in hand a plan click is only a point: blocks are not selected,
  units not adopted, samples not inspected and the road view does not move.
  Measure is off while a shape is being drawn, starting a drawing puts it down,
  and a sidebar pick on the plan takes the click from it.
- **Basemap and overlays: each map's Layers button.** Both maps carry a
  `MapLayersControl` under their zoom buttons: Map or Satellite (imagery under
  the labels, `SatelliteImagery` in `src/components/ui/map-satellite-imagery.tsx`,
  shared with the road-design plan, never a `styles` swap). The plan's adds
  Hillshade and the established VQO polygons, read from the inventory only once
  ticked. The road view's satellite choice is `drive.imagery`, so the note
  screenshot look still switches it on.
- **The plan legend hides what it lists.** Every legend row is a button
  (`PlanMapLegend` `hidden`/`onToggle`, keys in `planLayers.ts`): a struck-through
  row is off the plan map. Rows that share one layer (visible / hidden / unknown
  samples, mask kinds, sensitivity-unit objectives, landform clues, EVQO
  classes) filter that layer's features through `withoutHiddenFeatures`, which
  hands back the same collection while nothing is hidden. The plan's set is
  `planShow` (`PlanShow`); the road view keeps its *Show* tiles on `DriveState`
  because their defaults differ. Note screenshot look and distance haze are
  road-view only.
- **Both terrain readings at once.** *Find a landform from the terrain* reads
  the ridge layer seen and the face turned to the view in one terrain load,
  draws both (green and orange, `LANDFORM_METHOD_COLORS`), and compares them
  in a table. The one in front is filled and the one *Use* adopts. **Read from**
  takes the road (the ridge layer joins every station), an inventory viewpoint
  or rec site (listed in the section with the same one-line summary as
  *Viewpoints and rec sites*, `viewpointCandidateSummary`, and loadable from
  there), or a point picked on the map — the plan shows a *Click the map* hint
  while it waits, and marks the chosen point or viewpoint; from a point both readings use
  that point alone, and the adopted landform's source names it.
- **Viewpoint arrows.** Each inventory viewpoint keeps every arrow it carries
  (`ViewpointCandidate.arrows`, nearest the block first). The list opens one
  row at a time: pick which way to face — the block or one of its arrows — and
  stand there. In the road view the stood-at viewpoint's arrows drape as
  outlines (the faced one heavier), *Where to look* lists them, and facing one
  sets `DriveState.lookBearing`, which a saved view keeps. *Viewing gap* then
  opens the drawn timber along that arrow.
- **Ground in the road view.** The drawn forest floor, inventory cover, cut-block
  soil and mapped water are drawn whenever the road view is open, timber or not:
  *Standing timber* takes off only the trees. Floor, cover and soil stand aside
  when satellite imagery is on, so the imagery is the ground.
- **One hover card.** Where map layers with hover cards overlap, only the
  topmost feature's card shows (the toolkit's `hover-arbiter.ts`).

**The headline** shows the Table 7 rating once both measures exist, and until
then the objective, the measured figure X, and the adjusted figure. It also
carries the one "scene changed — rerun" notice, and the VIA's **stage**
(Pre-layout / Post-layout), the one place it is set; see
[Pre-layout VIA: the field brief and crew checklist](#pre-layout-via-the-field-brief-and-crew-checklist).

### How the rating is reached

All of it is `via.ts`, which is pure and unit-tested against the handbook's own
worked examples.

- **Ocular class (3.4.1)** is the reviewer's, never the model's: ease of seeing,
  scale, and shape, each picked from the handbook's phrases. Each FPPR s.1.1
  definition is a conjunction, so the class is the most altered one any phrase
  calls for — the handbook's case of "easy to see, medium, angular" circles M,
  "closer to the boundary with PR", and the page says which way it leans.
  *On the class boundary* is a separate tick, because Table 7 treats it apart.
- **X (3.4.2)** is lines a + b + c: proposed openings, visible roads and site
  disturbance outside them, and the non-greened-up share of existing openings,
  all in perspective view from the assessment station. It is withheld while the
  run is provisional. It is read against **Table 2 as printed** — P 0, R 0–1.5,
  PR 1.6–7, M 7.1–18, MM 18.1–30 — not against the editable planning thresholds,
  which stay a separate concern.
- **Resolution.** X is measured on one grid over the whole landform, so a
  proposal's share moves in whole cells. At the default 900 points a 7 × 6 km
  landform has ~170 m cells, and a 12 ha opening on Tabor Mountain read 0%
  (preservation) one run and 3.9% the next with nothing between. A proposal
  must now cover at least 8 landform cells (`MIN_LEDGER_CELLS_PER_PROPOSAL`)
  or the run is provisional, and the warning names the budget that would do;
  at 8,000 points the same opening measures smoothly (0.9%, 7.5%, 9.0%…).
  Existing openings keep the older test (at least one cell), since the
  inventory is full of small old ones.
- **Adjustments (3.4.3)**: six design elements from Table 3 (Good −1, Moderate
  0, Poor +1), roads from Table 4 (0 to +3), retention from Table 5 (0 to −2, or
  0 when retained patches were already netted out). The handbook's prose says
  "the sum of the five components", a leftover from the five-row FS1252 form;
  its Table 3 lists six, adding number, size and spacing, and so does the page.
  **Distance** is measured — to the centre of the visible proposal from the
  assessment station — and **one or two visible openings** rate number, size
  and spacing Moderate outright; the reviewer can override either.
- **Adjusted** is `X × (1 + 0.14 × Y)`. With six elements Y runs −8 to +9, and
  below about −7.1 the factor turns negative; the page holds the result at 0.
- **Table 7** compares the ocular class with the adjusted figure against the
  objective's range. The ocular class decides where the two disagree (3.5.1),
  and the page says when they do. Table 7 gives no number for "well within"; the
  page treats the **top fifth** of the objective's range as near the boundary
  and says so wherever the rating is shown.
- **Foreground views.** Handbook 3.0 says the criteria "have not been
  calibrated" for alterations under about 1 km. When the visible proposal is
  closer than that to the assessment station, the headline and step 5 say so
  and ask for the interpretation to go in the rationale. The rating is still
  shown, because the procedure still applies; it just needs reading with care.

The reviewer's record (`viaReview` on the scene) is saved and exported with the
scene but, like the FS1252 office fields, is left out of the run's fingerprint:
editing a judgement never withdraws the run it judges. The FS1252 export takes
step 4's ratings for the assessment station unless a station's own inputs are
set; the form's five design rows leave number, size and spacing on the VIA
record. Each row keeps whose it is (`fs1252ReviewFromVia`'s `designSource`):
a row step 4 left blank that the model filled is marked `X*` on the form, never
the reviewer's `X`, and only distance is ever filled. Its appendix states the
distance, what it was measured to (the centre of the visible proposal, from the
assessment station), FS1252 Table 2 row 4's bands and that it is not a field
observation; the adjustment is called reviewer-supplied only when all five rows
are the reviewer's. The form's own *Viewing Distance* is a different measure:
to the centre of the landform's bounding box.

## Two percentage scales, and why both are reported

This is the thing to understand before reading any number off this page.

A visual quality objective is **defined** by how much alteration is visible in
**perspective view** — what a person standing at a viewpoint actually sees.
Timber supply analyses cannot model perspective, so they use a second, much
looser set of **planimetric** percentages applied to flat map area. The two are
not interchangeable:

| Class | Perspective view | Planimetric denudation |
| --- | --- | --- |
| Preservation | 0% | 0 – 1% |
| Retention | 0 – 1.5% | 1.1 – 5% |
| Partial retention | 1.6 – 7.0% | 5.1 – 15% |
| Modification | 7.1 – 18.0% | 15.1 – 25% |
| Maximum modification | 18.1 – 30.0%+ | 25.1 – 40% |

Perspective ranges: *A Guide to Visual Quality Objectives* (QP371691, Mar 2013).
Planimetric ranges: *Procedures for Factoring Visual Resources into Timber
Supply Analyses* (Mar 1998), Table 3, which states they "apply to the total
forested or 'green' area of the landscape and should be applied
planimetrically".

A 12% alteration is **modification** in perspective view but only **partial
retention** planimetrically. Judging a perspective number against a planimetric
threshold therefore passes alterations the objective does not allow, so the page
computes both and judges each against its own scale. Both threshold sets are
editable — a district holding a scenic area to its own numbers should use those.

### What the numbers mean

| Number | What it is |
| --- | --- |
| **Visible %** | Share of the block's ground area seen from anywhere along the road. The direct answer to "how much of it can we see". |
| **Share of its apparent size in view** | The same question weighted by how the block presents itself from the assessment viewpoint — foreshortened ground counts for less than ground facing the road. |
| **Alteration in perspective view** | The blocks' apparent area over the landform's visible apparent area, from the assessment viewpoint. The scale the objective is defined on. |
| **Planimetric denudation** | The blocks' map area inside the landform over the landform's area, visible or not. The scale timber supply models against. |
| **Mean slope · green-up height** | Mean ground slope over the block, and the regeneration height at which it stops reading as disturbance (Table 6), area-weighted over the block's own slope classes. |
| **Foreground / middleground / background** | Visible hectares split at 1 km and 8 km, following the BC visual landscape inventory. |

The **assessment viewpoint** is the station along the road where the blocks
together show the most ground — the critical viewpoint an assessment would be
written from. Every perspective number is measured there.

### Alteration applies to a landform, not to a landscape

The 2013 guide is explicit: "Percentage alteration numbers must be applied to
readily identifiable landforms (not applied against an entire visible
landscape). A landform is a distinct topographic feature, is three-dimensional
in form, and is generally defined by ridges, valleys, shorelines, and skylines."

So the denominator on this page is a polygon marked as a **landform**, and only
the parts of blocks falling inside it count toward its alteration. Without a
landform the page reports per-block visibility and says the denominator is
missing rather than inventing one.

### The reviewed scope

Two percentages are the same measurement only when they were measured on the
same scope: the same landform, the same block footprint and the same
exclusions. A run against a whole inventory unit with gross blocks and a
historical figure measured on one face with net blocks can differ several
times over with neither being wrong, so the page states the scope beside the
figures (`assessmentScope.ts`, DOM-free).

Step 1's *Landform and objective* ends with a folded **Reviewed scope**
(`AssessmentScopePanel.tsx`): the run's landform with its gross area and where
it came from (the inventory, an adopted terrain candidate, drawn, imported, a
sample), the inventory units under it with the share of its ground in each
(read from the live inventory when it has been looked up), each block gross
and net of the masks over it (masks that overlap are taken once) with its
treatment, the masks by kind with where each came from and what it does to the
two denominators, and the two denominators' rules, the planimetric one with
the run's own treed area. Each row says whose it is: the scene's, the run's or
the reviewer's.

| Piece | Read from |
| --- | --- |
| Landform, its gross area and provenance | The scene's landform target (`inventoryUnitId`, `source`) |
| Inventory units under it | The live inventory read, sampled over the landform; never stored |
| Blocks gross and net | The scene's block and mask geometry; a partial cut is never cleared ground (its Table 6 equivalent counts only where seen), dispersed retention keeps its geometry |
| Masks and their effect | `MASK_LABELS` and the run's ledger: natural non-green ground leaves both denominators, private land leaves them only with `privateLandOutOfDenominator`, permanent disturbance and *Wildlife tree patch / retention* stay in them; none counts alteration. A mask traced on another landform is out of this scope |
| Planimetric denominator | The run's `landformForestedAreaMeters` (VRI treed area), read, never recomputed |
| Perspective denominator | The run's `perspectiveDenominator` rule; an apparent size, not an area |
| *The landform assessed is* and *Scope note* | The reviewer: `viaReview.landformRecords[name].reviewedAs` and `.scopeNote` |

The geometry only suggests what the landform is against the inventory (one
unit adopted whole, a face inside one unit, parts of several joined); the
suggestion is the select's placeholder and is never written. The statement
and note are review records: optional, never a gate, carried by the project
file and kept out of `sceneFingerprint`, so editing them never stales the run.

The scope's one-line statement is printed beside the figures: the Viewpoint
summary's **Scope** row (both scales), the VIA report's *Scope of the
assessment* part (a JSON component, `assessment-scope`, in the handbook
report, the consultant reports, the Board comparison and the 2001 photo form;
the reviewer's blank statement goes in the to-complete list), each signed
historical comparison (*PGMaps scope at review*, kept with the comparison as
it stood at sign-off, beside the source's denominator basis), and the
reference run's message.

### A landform from the terrain

Step 1's **From the terrain** reads each of the guide's four edges off the
elevation model (`landformFromTerrain.ts`), growing out from the block on a
50 m grid within 5 km:

- **Ridges, skylines and flanks**: ground whose downslope direction turns more
  than 80° from the viewpoint faces away from it. When the road is within
  1.5 km of the block, facing is read against the one block-to-road bearing —
  cell by cell, the ground either side of a road on the same slope faces away
  from it and the face was cut off at the road.
- **Valleys**: flat ground (under 8%) below the block, and drainages with over
  3 km² upstream (flow accumulation over the pit-filled raw surface — routed on
  the smoothed one, a gully's flattened bottom split its water between parallel
  lines and neither counted — widened a cell each side so a drainage has a
  bottom). At 1 km² every gully cut the face into facets.
- **The top**: flat ground above the block with nothing higher beyond it — a
  plateau or summit — reported as a slope break. Flat ground above the block
  with face going on up on one side and down on the directly opposite side
  within 300 m is a **bench**, and is part of the face. A saddle has higher
  ground along the contour and lower ground across it, at right angles, so it
  is not bridged: bridging benches by closure alone ran a knoll's face over a
  saddle onto the next mountain.
- **Shorelines**: the basemap's water polygons.

Slope and facing are read off terrain smoothed over about 150 m, notches two
cells deep are closed and one-cell fingers trimmed (trimming wider dropped a
150 m lakeshore bank whole). Drainages, water and missing terrain are kept out
of that smoothing: they are edges, not fringe. The viewpoint is the run's
assessment station, or before a run the road point nearest the block. The panel
lists what stopped the outline and how much of it each did, and warns when the
face ran off the 5 km search area, when it is over 1,500 ha (a face that large
usually runs past what reads as one landform), when the road is on the same
slope, and when little was found past the block.

Tested on eight places around Prince George (a subagent drove the UI and
compared outlines with hillshade), the final rules take a knoll's flank from
crest to foot (104 ha), a summit's west face (356 ha), the College Heights and
Fraser escarpments whole (758 and 674 ha), 300 ha of Cluculz Lake's north-shore
bank, and nothing past the roadside demo's block, which stands on the valley
floor. Two are still too big and hit the search limit: Tabor Block A's face
(2,298 ha, reaching the crest east of the block but with long arms) and a road
laid across that same face (2,490 ha) — the size warnings fire on both, and
they need their ends set by hand.

The demo carries no landform now; its old 900 × 600 m box was barely bigger
than the block and read it as 96.6% altered. It opens straight into the road
view instead of the assessment steps.

It is a candidate like an inventory unit — shown dashed, adopted only on
"Use this landform", inheriting the current landform's objective and VAC — and
a reading of the terrain from one viewpoint, not a checked delineation. A
candidate is dropped when its block is edited or deleted or the scene is
replaced, and one that found little past the block cannot be adopted.
Adopting one **replaces** the landform being assessed — two overlapping
landforms of the same colour read as one muddle — and the panel offers an
*Undo* that puts the previous one back until the scene changes.

### Visual absorption capability

A landform can carry a VAC rating, which narrows the planimetric allowance from
the class range to a single figure (1998 Table 4):

| Class | Low VAC | Medium | High |
| --- | --- | --- | --- |
| Preservation | 0 | 0.5 | 1 |
| Retention | 1.1 | 3.0 | 5 |
| Partial retention | 5.1 | 10.0 | 15 |
| Modification | 15.1 | 20.0 | 25 |
| Maximum modification | 25.1 | 32.5 | 40 |

Where a landform has no rating the class maximum is used instead. BC's inventory
leaves VAC unpopulated across much of the province, so that is the common case.

### Harvest systems: clearcut, dispersed retention, partial cut

Each proposed block row in step 1 carries a harvest system. Clearcut is the
default and changes nothing.

- **Dispersed retention** records the share of the stand left standing. The
  block is still measured as cleared ground (the procedure measures the
  opening, then credits retention), and the blocks' area-weighted retention —
  clearcut blocks counting 0% — becomes step 4's **measured Table 5 level**:
  under 15% = 0, 15–22% = −1, over 22% = −2. The reviewer's own choice
  overrides it, and "already cut out of the block outlines" still zeroes it so
  retention is never credited twice.
- **Partial cut** records volume removed and the mean height of the trees left.
  The run leaves it out of the cleared-ground ledger and out of the screening
  canopy clearing (it still samples it, so visibility is reported), and handbook
  3.4.4's Table 6 (`partialCutEquivalentPercent`) gives its clearcut-equivalent
  percent alteration. That figure is added to X — "the simplest procedure is to
  add the clearcut percent alteration numbers" — for every partial cut the run
  sees from the viewpoint; one it cannot see adds nothing. Until a visible
  partial cut has both values, X is withheld and step 4 says so. Under 10%
  removed the table does not start and the cut adds 0.

The road view draws both as a **thinned** stand instead of a clearing
(`blockThinning` in `forest.ts`): retention keeps its recorded share of stems,
a partial cut keeps the volume it did not remove (as that share of stems — the
view cannot tell volume from stem count) at the residual height entered, or
half the stems until volume is recorded. Each stem's keep/drop draw is seeded
from its own cell, so thinning one block leaves every other stem where it was.
A block with a **stand prescription** (below) draws the trees its prescription
keeps instead of the random draw.

Table 6 is read from its nearest cell rather than interpolated, as a reviewer
with the paper form does. `PERCENT_CLEARCUT` on an *existing* opening is not
volume removed, so existing openings keep their own scaling (below) and are
never converted through Table 6.

## One readiness rule for every output

A run's alteration figures are the assessment's only while the run is current
and `quality.numericalReady` holds. Every surface that prints one reads it
through `runFigures` (`runFigures.ts`, DOM-free): the Results tiles, step 4,
the Viewpoint summary, the run readout, the station table and its CSV, Save &
export's *Run* rows, the FS1252 draft, the Markdown worksheet, the Visuals
paragraph, the saved assessment runs and their evidence, and every saved view.
It gives the state (`none`, `stale`, `provisional`, `ready`), the figures only
when ready, and the run's **gaps**: the reasons the run withheld them, each
with the part of the page that supplies it (`quality.gaps`, emitted by the run
beside its warnings). A withheld figure prints "Withheld — <first gap>"; a
surface that shows the raw value labels it *Diagnostic (not for reporting)*.
`runFigures.test.ts` scans the source and fails on a read of
`perspectiveAlteration`, `planimetricAlteration` or `perspectiveByStation`
outside the run, the rule, the replay and the saved-summary record.

A saved view stamps the sightline figure at its station only when the run was
ready (`captureSightline`), and otherwise the reason (`sightlineWithheld`).
Views saved before that record carry no readiness, and print *Readiness not
recorded* in place of their figure (`capturedSightline`): never as the
assessment's, never as a group's X in step 4 away from the station. Run
assumptions sit inside the *Run* part's editor, so Save & export supplies a
gap where it names it.

## Existing harvest and cumulative alteration

An objective is met or missed by what is on the ground **plus** what is
proposed, so "Look up this view" also pulls the province's consolidated
cutblocks and the results report existing + proposed = cumulative.

- **Green-up.** An opening older than the green-up age stops counting, because
  regeneration has grown back into forest cover. The references give the green-up
  *height* a slope needs (Table 6), not how long a site takes to reach it, so
  the age is a stated planning assumption and is editable. The **height** is
  computed the way the procedure sets out — hectares in each slope class,
  weighted by area — rather than by reading one height off the mean slope. Every
  grid sample stands for the same ground, so that is the mean of each sample's
  own Table 6 height. It is not the same answer: Table 6 is a step function, so
  on a block that is half flat and half steep the mean slope lands in a class
  that barely exists. Around Prince George
  most recorded harvest is 2003–2005, which sits right on a 20-year default —
  moving it to 25 flips those openings back into the count.
- **Whether the openings are all of them.** Line c is only as complete as the
  read under it. The run keeps the source and the reviewer's assumption apart:
  `quality.existingInventory` is the harvest read's coverage of the landform's
  box (`complete` only when DataBC's openings were read whole over it, else
  `partial`, `unavailable` or `not-requested`), and `quality.existingAssumed`
  is step 3's tick that the included features are the existing disturbance.
  Ticking it over a complete read leaves the read complete. Either makes the
  figure usable; neither, and it is withheld with a gap that links to the
  lookup. Every output prints what line c rests on beside X
  (`runExistingBasis`, `existingBasis.ts`): "DataBC openings (…), complete
  over the landform, read 12 Nov 2026", or "Reviewer assumption: the included
  features are all the existing disturbance (not confirmed by a complete
  inventory read: …)", never "diagnostic", which marks a withheld figure; a
  read that could not be made, or was not asked for, carries no date — the Results
  tiles, step 4's line c, the Viewpoint summary, Save & export's *Run* part,
  the FS1252 draft and worksheet, the evidence package, the block note, the
  Visuals paragraph's basis and each viewpoint's calculation in the VIA
  report. Runs saved before the two were apart carry `scenario-only` and read
  as an assumption with its coverage not recorded. *Look up this view* reads
  the map view together with the active landform's bounds
  (`lookupQueryBounds`), so an opening off screen on the landform is not
  missed; past the 1.5° cap it keeps the whole landform.
- **Partial cuts.** `PERCENT_CLEARCUT` scales the contribution, so an opening
  that was 40% clearcut counts 40%. A recorded 0% is a retention-system harvest
  (RESULTS `RETEN`), which is still an opening to the eye, so it counts whole
  (`alterationWeight`, see *Evidence for the defaults*).
- **No double counting.** A proposed block laid over an opening that still
  counts is not charged for that ground again; ground under a *recovered*
  opening is free for the proposal to claim.
- **Field-confirmed green-up.** Step 3's *Existing-opening green-up* lists each
  opening with the share the model gives it — a supplied recovery estimate,
  else the green-up age — and an optional **field check**: greened up, not
  greened up, or a share, with the date, who checked it and a note
  (`TargetPolygon.fieldGreenUp`, rules in `greenUp.ts`). Once it has a share, a
  date and an observer it overrides the model in the cumulative ledger, on both
  scales; the modelled share is kept and shown beside it. A draft check, or one
  dated after the assessment year, leaves the model in charge and says why. The
  share is of the opening, like the handbook's "70% greened up still counts 30%",
  and is scaled by `PERCENT_CLEARCUT` as the estimate is; it is not fed through
  Table 6. Every place line c is printed names what it rests on — "Green-up
  modelled", "Green-up field-confirmed 12 Nov 2026 by J. Smith", or "field-confirmed
  for 1 of 3 openings (…), modelled for 2": the Results tiles, step 4's line c,
  the Viewpoint summary's verdict note, the FS1252 appendix (which also lists
  each checked opening's field and modelled shares), the Markdown worksheet and
  each viewpoint's calculation in the VIA report ("Green-up of existing
  openings"). Those labels are read from the run's own input snapshot (`runGreenUpBasis`),
  so they always describe the figure beside them; openings that reach no
  landform sample are left out of the count. A supplied recovery estimate is
  not a field check and not the green-up age, so the label names it apart:
  "supplied estimate for 7 of 19 openings, modelled for 12" (`greenUpBasis`).
- **A field check is a run input.** A complete check (share, date, observer)
  goes into `AnalysisInput` and the scene fingerprint, so completing or changing
  one stales the run — unlike `viaReview`. Its note does not, and neither does
  a draft. Scenes saved before the field check load unchanged
  (`parseFieldGreenUp` drops anything unreadable). "Look up this view" replaces
  every inventory opening with a new id; a check follows the one opening with
  the same name (`carryFieldGreenUp`), never one named from the feature's
  position (`cutblock-N`).

## The green area, and where it comes from

The 1998 document is explicit: visual landscape management "applies a percent
denudation figure to the **total green (forested) portion** of the visual
landscape, whether the area is available for harvest or not." So the planimetric
denominator is the landform's treed area, not all of it.

That comes from **VRI rank-1** (`WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY`),
queried live from DataBC's WFS. `BCLCS_LEVEL_2` is exactly the distinction the
procedure turns on: `T` for treed ground, anything else for water, rock, or
clearing.

The **perspective** figure divides differently by default. A VIA nets rock out of
the landform ("VLU net of rock / private land"), not every non-treed polygon, so
the perspective denominator leaves out only VRI non-vegetated ground
(`BCLCS_LEVEL_1 = 'N'`: rock, water, ice); burns, shrub and herb stay in.
*Simulation settings → Perspective denominator* switches it back to the treed
rule (`perspectiveDenominator: 'non-treed-out'`). The planimetric figure always
keeps the treed rule. See *Evidence for the defaults*. It is not in the ArcGIS map service the rest of this page uses — that
service publishes only the VRI *Dead* layer — which is why there are two service
clients here.

It matters more than it sounds. Tabor Mountain's landform is **78.6% treed**:
3,527 ha green of 4,489 ha. Dividing by all 4,489 makes every planimetric figure
read **27% low**, and that crosses classes — an opening between about 176 and
225 ha is within Retention's 5% planimetric maximum on the whole-area
denominator and over it on the right one.

One query answers three questions, so it is made once per run:

| | From |
| --- | --- |
| The green area | `BCLCS_LEVEL_2 = 'T'` |
| Screening canopy | `PROJ_HEIGHT_1`, `CROWN_CLOSURE` |
| The drawn 3D stand | `SPECIES_CD_1` |

Two costs. GeoServer will not generalise geometry server-side, so the answer is
about 1 MB over a 4,500 ha landform against the tens of kilobytes the generalised
ArcGIS queries return — hence a tighter bounds clamp and a feature cap, and the
result reports truncation. And the bounding box goes in the `CQL_FILTER` rather
than the WFS `bbox` parameter: WFS 2.0 with a plain `EPSG:4326` bbox is
latitude-first while CQL's `BBOX` is longitude-first, and mixing the two returns
the wrong part of the province without erroring.

## Screening timber

Terrain is only half of what hides a block: a stand between the road and the
block blocks the view as a ridge does. `canopy.ts` rasterises stand heights into
a grid in the same Mercator space the sightline walks, so screening costs one
array lookup per profile step, and clears that canopy inside the proposal and
inside any opening that has not grown back.

Height and crown closure come from the same VRI rank-1 query as the green area,
so coverage is the whole landscape rather than managed openings. Screening stays
**off by default** — the query is multi-megabyte and the run is honest without
it — but switching it on is now a real answer rather than a partial one.

Stands more open than a crown-closure threshold do not screen at all. The
inventory carries no transmission model, so that cut-off is a stated assumption
rather than a published figure.

VRI stand polygons run over roads, beaches and shorelines, so with screening on
the timber within `screeningEyeClearingMeters` (50 m, up to 150 m) of each station
is cleared; without it 20 of 44 study views saw no landform at all. And when
screening hides more than three quarters of the landform the bare ground shows
(`MIN_SCREENED_LANDFORM_SHARE`), the screened figure is withheld: the denominator
has collapsed and the ratio is noise (one study view went from 10.6% to 56.6%).

## What it does not model

Bare-earth terrain only. Standing timber, screening vegetation along the road,
retained patches inside a block, and roadside cut-and-fill are not in the DEM,
so a block screened in reality by a strip of leave trees will read as visible
here.

Where no vegetation inventory answers, the planimetric denominator is the
landform's whole area rather than its green area, and the figure reads low by
however much of the landform was never forest. The results panel says which
denominator was used.

The percentages are also only the numeric half of the test. The Forest Planning
and Practices Regulation defines the classes by visual dominance as well: how
large the alteration is in scale, whether it looks natural, and whether it is
rectilinear or geometric. A number inside the range does not by itself achieve
the objective — a visual design review decides that. Treat the output as a
screening pass that says where a real visual impact assessment is warranted,
not as one.

## How a run works

1. **Stations** — a spot viewpoint is one station; a corridor is sampled every
   `stationSpacingMeters` along the centreline, both ends included.
2. **Samples** — each polygon gets a regular grid whose cells all cover the same
   ground area, so a sample count is an area ratio. Spacing comes from the
   sample budget, never finer than the DEM resolves.
3. **Terrain** — the DEM tiles covering the stations and every in-range polygon
   are fetched and blitted into one contiguous elevation mosaic.
4. **Sightlines** — every station-to-sample pair walks the ground profile a DEM
   cell at a time, comparing terrain against the ray after earth curvature and
   atmospheric refraction. The walk stops at the first obstruction.
5. **Reduction** — per-station visibility is kept rather than collapsed, which
   is what makes the along-the-road profile and drive mode free.

Visibility is held as a `stations × samples` matrix per polygon, so "can it be
seen anywhere along the road", "where is it worst", and "what does the driver
see right now" all read from one pass over the terrain.

### Elevation data

Elevation comes from the AWS Open Data [terrain tiles](https://registry.opendata.aws/terrain-tiles/)
archive in Terrarium encoding (SRTM/CDEM), which needs no API key. The map
renders its 3D terrain and hillshade from the same tiles, so the ridge that
hides a block in the numbers is the ridge that hides it on screen.

Terrain detail is a DEM zoom level: zoom 13 is about 11 m between samples in
central BC and is the default. A run is refused above 256 tiles — drop a zoom
level rather than wait.

### Cost and limits

A run is capped at 250,000 sightlines; past that the sample grid is coarsened
rather than the stations thinned, because losing a viewpoint loses a whole
answer while a coarser grid only blurs one. The defaults land around three
seconds for a 10 km corridor against two blocks.

If more than a third of the terrain tiles fail to load the run is refused
outright: ground the mosaic is missing never blocks a sightline, so a run built
on absent tiles would report everything as visible.

### Roads are drawn as roads, not as samples

Viewing stations are a sampling interval — one sightline calculation every
`stationSpacingMeters` — not a property of the road. Drawing them as dots makes
the interval look like the answer, so both the corridor and the searched roads
are drawn as **line segments between consecutive stations**, each carrying the
mean of the two figures at its ends. Nothing is coloured that was not computed,
and a grey stretch is road the block cannot be seen from. Only the assessment
viewpoint keeps a marker, because it is a single place rather than a sample.

## Working backwards from the block

The forward run answers "how much of this block does this road see", which needs
you to already know which road matters. **"Which roads see the block"** answers it
the other way round: every road the basemap is currently drawing is sampled at
intervals, each station traces sightlines to a grid over the block, and the
result is a ranked list — the most it is ever exposed, the share of each road's
length it can be seen from, and how close that road comes.

Picking a road makes it the corridor, so the full assessment can then be run
along it for the figures an objective is actually judged on. The reverse run is a
coarser grid on purpose: it ranks roads, it does not produce a percentage anyone
should write down.

It reads the roads from the **rendered basemap**, so it answers for the current
view at the current zoom — roads off screen are not searched, and at a zoom where
the basemap does not draw resource roads they are not there to be found. (The
province's own Digital Road Atlas view is published with a null object-id field
and its spatial queries return nothing, so it is not a usable source.)

## Snapping the corridor to a road

A hand-drawn line is a guess at where the road goes, and the guess shows up in
the numbers: a vertex that lands in a gully or on the far bank puts a viewing
station somewhere no driver ever is, and that station reports seeing nothing.
**"Snap to the nearest road"** replaces the drawing with the road the basemap
draws, trimmed to the stretch that was drawn — so a short sketch along a highway
does not return the whole highway.

The road a drawing was tracing is the one its vertices sit closest to on average.
A line further than 250 m from every road on screen is left alone, with a note
saying so rather than snapping to something arbitrary. Note that at a zoom-11
view a single screen pixel is about 30 m, so drawing within snapping distance
means zooming in first.

Vector tiles split one road into many features and styles draw each of them twice
(a casing under a fill), so the candidates are deduplicated by geometry, merged
by name or highway number, and — for the unnamed roads that are most of the
resource network — chained together by shared endpoints.

## Drive the view

"Look from the road" opens the road view, a map of its own beside the plan map
(see **The workspace**), with the camera at eye height on the corridor and 3D
terrain on. Play drives it along at a chosen speed; the profile chart doubles as
the scrubber. Facing a block pitches the camera at it, and the sample points
narrow to what *that* point on the road can see — red ground appears and
disappears as ridges pass in front of it.

A resize of the road view (*Fullscreen*, a pane drag, the window) places the
camera again: MapLibre keeps the zoom and centre through a resize, and at eye
level that moves the camera off its station — going fullscreen once stood it
29 m behind, with the stems behind the station drawn in front of it. The
controller keeps the canvas size in the pose it compares (`driveController.ts`),
and the vertical field of view too: a lens change (*View options → Lens*, a
field photo) keeps the zoom the same way.

**Steering from the plan.** While the road view is open the plan's viewer is
two handles (`PlanViewerHandles`): drag the dot along the road to move the road
view there (snapped by `distanceAlongRoad`, seeking at most every 120 ms), and
drag the tip of the view cone to turn it, which sets `drive.lookBearing` exactly
as facing an inventory arrow does (*Where to look* then reads "Turned on the
map"). The tip rides the cone's arc, and a second wedge shows where the view
will face; the road view turns once, when the tip is let go. A plain click anywhere on the plan moves the road view to the nearest
point on the road (`PlanClickToMove`), so you can look at one area, click the
next and look again. A click on an inventory viewpoint, rec site or arrow still
opens its card (an arrow clicked, or one aimed at the block, leads; *facing the
block* is offered only when no arrow already does that), as a
click on a view of interest's point opens its card with *Stand here*; and while the road view is open sample points and sensitivity units
do not take plan clicks (inspecting a sample and adopting a unit are steps 1 and
3's jobs). Drawing and point picks own the clicks while they run.

**Swapping viewpoints keeps the road view.** Standing at an inventory
viewpoint, or going back to the road, changes the scene's viewpoint, so the
run is made again. While it runs the road view's map stays mounted
(`roadViewHeld`): its WebGL context, style, tiles, terrain and layers are kept,
only the camera waits, and a "Moving to …" note shows over it. Before, the map
was destroyed and rebuilt (style, fonts, tiles, DEM, shaders) for each swap. The
drawn stand still regrows, because its patch grid is anchored on the viewpoint.

**Off the road.** Walking off the road (W A S D) no longer adds a status line to
the road view's bar: the *Reset look* button turns amber with a warning
triangle, its tooltip says how far off the road (or viewpoint) you are and that
the red ground is still the nearest station's view, and clicking it (or R)
walks back as well as resetting the look.

**Tree-free areas.** *Drawn timber → Draw a tree-free area* traces a polygon on
the plan, with the road view left open, where the drawn stand leaves its stems
out: a pullout, a cleared stretch of roadside, a field. They join the stand's
clearings beside the road strip and natural-opening masks, are kept on the scene
(`treeFreeAreas`, `treeFreeAreas.ts`), and are display only: out of
`AnalysisInput` and out of `sceneFingerprint`, so drawing one never stales the
run. The ground under one stays forest floor, not cut soil.

**The viewpoint clearing.** A stood-at viewpoint — a spot, or a pullout no
longer than twice `PULLOUT_METERS` (*Stand here*'s, or a hand-drawn one; the
same test as the bar's `spot`) — is a maintained lookout, and the VIA photos
show it open. Without a clearing the stand grew to the eye and the view was
trunks. `viewpointClearingArea` (`treeFreeAreas.ts`) adds a tree-free fan of
120 m within ±70° of the bearing to the block faced (the arrow's bearing when
facing one; whole degrees, so looking around never regrows the stand) and a
15 m circle round the eye. It is on by default; *Drawn timber → Viewpoint
clearing* turns it off or sets the radius (15–500 m), kept as
`scene.viewpointClearing`. It is a tree-free area like any other: drawn on the
plan, in `forest.clearings` and so in the engines' scene package, and out of
`AnalysisInput` and `sceneFingerprint`. The run's own screening clearing
(`screeningEyeClearingMeters`) is separate.

**Where a view's stations stand.** A viewpoint stood at (a spot, or a
pullout no longer than `STOOD_AT_MAX_LENGTH_METERS`) is assessed from the eye
itself: one station where the eye stands (`standingPoint`), as the handbook
assesses from the viewpoint. This is calculation 2
(`settings.stationsAt: 'eye'`, `stationCalculation`, `runCalcVersion` in
`replayComparison.ts`). Before it, every run stood such a view on the 30 m
pullout's own stations, its two ends 15 m either side of the eye, so the eye
height was the picture's but the sightline figure came from 15 m away. That is
calculation 1, and a scene or a run saved without the setting reads as it
(`parseScene` never gives an absent value the eye): old projects, archives and
sightline replay archives replay exactly, and the replay names the
calculation its archive used. New scenes start at the eye; *Simulation
settings → Views stood at* switches either way, and the choice is a run input.
Roads and spots are assessed the same under both. The Methods table prints
the calculation (*Views stood at*), and a view's row, standing there under
calculation 1, still says how far the run's stations are from its eye.

Measured on the Purden Lake sample before the switch (23 November 2026; 14
stands along Hwy 16, each a pullout square to the line of sight to the block,
terrain zoom 13, bare earth): the perspective figure moved a median 0.07
points, under 0.5 points at 11 stands, 0.5–0.8 at two, and 3.8 and 9.3 points
at two. Those two are stands where one end of the pullout saw over near ground
that the eye does not: at one, the block was 26% visible from the ends and
hidden from the eye. The block's visible share moved a median 0.3 points, and
the landform's a median 2.1 (up to 14.8): two stations 30 m apart see more of
the landform between them than one does. The planimetric figure does not
depend on the station and did not move. The figures from real assessments are
still to be measured, when the VIA research folder is back.

**A surveyed eye elevation.** At a stood-at viewpoint, step 2's *Where you
stand* takes the eye's absolute elevation (`viewpoint.surveyedEye`,
`viewpointStand.ts`), kept with the point it was entered for so it lapses if the
viewpoint moves more than 5 m. It is a run input: `buildSceneInput` passes it as
`viewpoint.eyeElevationMeters`, every station's ground becomes it less the eye
height (`terrainGroundElevationMeters` keeps the model's reading for the
Viewpoint summary), and the fingerprint carries it only while it applies. The
road view stands the eye there within 20 m of its point (`surveyedEyeAt`), the
pose says so (`eyeSurveyed`), and the figure's camera block prints "(surveyed
elevation)" on the position line; the observer height line is unchanged.
Simulation settings shows it, read only, under *Eye height* while it applies,
and points to where it is entered; it is never edited there. At
Marblehead VP2 (Duncan Dam Scenic Viewpoint, printed 636 m) the Terrarium DEM
reads 645.8 m at the printed position at z13–z15 (644.1 m at z12): about 10 m
high, not low, on a gentle slope falling west toward the view (643 m 30 m west,
635 m 100 m west, 609 m 100 m south-west), with no cliff within 100 m. The
printed elevation is met 35–50 m south-west, so it is a position or datum
difference rather than DEM smoothing; the eye sitting "among the trees" there was
the stand growing to the eye, which the viewpoint clearing answers.

Two MapLibre details this depends on:

- The camera is placed from an explicit position, altitude, and rotation
  (`calculateCameraOptionsFromCameraLngLatAltRotation`), not by framing a point
  at some zoom. Standing on a road needs a real eye height above the terrain.
  **Roll must be passed explicitly** — MapLibre copies the omitted argument
  through as `roll: undefined`, and `jumpTo` treats the key as present and
  normalises it to NaN, which leaves the transform's projection matrices null
  for every later frame.
- Pitch is clamped to 85°, MapLibre's supported ceiling. A block sitting above
  the horizon is framed slightly high rather than centred.
- A **fixed look** (a lined-up photo) can ask for the horizon exactly, which is
  a map pitch of 90°. MapLibre's renderer crashes the page's GPU process at
  exactly 90° with 3D terrain on, so `horizonSafePitch` holds any requested
  pitch 0.1° short of it — too little to see, measured as the cause of a
  "target crashed" on the first panorama that was lined up level.
- **The eye stands on the drawn ground, not the analysis grid.** MapLibre's
  terrain renderer reads a DEM sample at its pixel's top-left corner; the
  analysis grid (`ElevationGrid`) reads it at the pixel centre. The half-pixel
  difference is about 3 m at zoom 14 — a metre of height on a 24% grade, and on
  a 40% slope it put the camera at, and briefly under, the drawn ground. The
  preview therefore reads its fixed mosaic through `renderedGroundSource`, which
  reproduces the drawn ground exactly (0.00 m mean difference, measured), while
  the analysis keeps the pixel-centre reading. It is still a fixed mosaic, so
  rendered terrain detail never moves the eye or the tree bases.

### How it holds up on different roads

Driven in GPU Chrome against the live terrain, recording every camera frame
(heading, position, eye height above the drawn ground, and whether the road
10 / 30 / 60 m ahead is inside the field of view):

| Road | Speed | Worst heading off the road | Road 10 m ahead in view | Eye above drawn ground |
| --- | --- | --- | --- | --- |
| Straight, 1.2 km | 80 km/h | 0° | 100% | 1.6 m in every frame |
| 90° curve, radius 400 m | 80 km/h | 1.5° | 100% | 1.6 m |
| S-curve, two 70° bends, radius 150 m | 50 km/h | 3.6° | 100% | 1.6 m |
| 180° hairpin, radius 25 m | 20 km/h | 10.3° | 100% (30 m ahead: 70%, it is round the bend) | 1.6 m |
| Coarse GIS road, 200 m vertices, 35° kinks | 60 km/h | 19.6° vs. the segment — the camera takes the bisector at a vertex, as a driver's line does | 100% | 1.6 m |
| Straight climb, 142 m over 1.5 km (24% max) | 50 km/h | 0° | 100% | 1.6 m |
| Stress test, 39% slope | 30 km/h | 0° | 100% | 1.6 m (was 0–2.7 m before the fix above) |

Travel speed held within 0.2 km/h of the setting at 56–60 fps; the fastest
turn was 34°/s through the coarse kinks. `driveCurves.test.ts` pins the curve
cases without a browser. Calling `map.project()` every frame under 3D terrain
crashed the renderer on the coarse-kink road in testing — the page never does
that while driving, but a measuring harness should not either.

### Checking the view against a field photo

Handbook 3.2 photographs each viewpoint, and 3.3.4 checks the simulation
against the photo: viewpoint coordinates, view direction, focal length, tree
heights, past alterations. Step 2's **Field photo** does this with a
street-level photo from Mapillary, or with a photo of your own.

- **Find photos facing the cutblock** searches Mapillary along the road
  (in boxes of 0.01°, at most 24, so a long corridor is sampled, and says so)
  and keeps photos within 30 m of the road line whose axis points within 35° of
  the cutblock's visible centre, nearest first. Or paste any photo link.
- **Line up the road view** stands the eye on the road line nearest the photo,
  turns the camera to the photo's computed bearing and pitch (from Mapillary's
  reconstruction, `computed_rotation`; the compass alone when there is none),
  and sets MapLibre's vertical field of view to the photo's lens (`fieldOfView`
  from the normalised focal length). The photo is laid over the road view at
  the map's full height, rotated by its roll, with an opacity slider.
- The overlay draws, in the photo's own pixels (`photoPose.ts`): the **terrain
  skyline** out to 25 km from zoom-11 terrain loaded around the photo, the
  **cutblock outline** on the ground (hidden parts included), and the block
  ground the nearest analysis station **sees**, as red dots. When the drawn
  skyline sits on the photographed ridgeline, the pose is right; the arrow
  buttons nudge heading by 0.5° and pitch by 0.25° until it does.
- Measured on the Hart Highway (image `433510958589782`): Mapillary's rotation
  reproduces its own computed compass angle to 0.001°, the camera was mounted
  12.3° nose-up, and the drawn skyline landed on the photographed hills with no
  nudge. The comparison also showed what the illustrative forest gets wrong
  there: open water 15 m from the road where the basemap's river polygon
  starts at about 40 m.

- **Line up automatically** fits the pose to the photo itself
  (`skylineFit.ts`). It reads where the sky ends in each column of the photo —
  starting at the first clear run of sky in the top third, so a dashboard
  visor is skipped, treating cloud as sky, and stepping past a cloud's lower
  edge when the sky below it is as blue and bright — then searches heading and
  pitch, coarse then fine, for the pose whose terrain skyline agrees. A column
  agrees when the photo's skyline falls between the bare-ground ridge and the
  same ridge with 25 m of canopy on it; sky showing *below* the bare ridge
  counts three times against a pose, since terrain cannot be missing, while
  trees standing above it cannot be told from a ridge and are not counted.
  Ridges nearer than 1 km are left out: their canopy is too tall in the frame
  to pin anything. It only moves the pose when at least 20 columns across 15%
  of the frame agree, 80% of them within the band; otherwise it says why and
  leaves the pose alone. On a dashboard photo facing Tabor Mountain
  (`1147829723589426`) it agreed on 76 columns across 40% of the frame (99%)
  and moved the pose +0.10° in heading and +0.36° in pitch; on the Hart Highway
  photo, whose skyline is all roadside timber, it declined (14 columns).
- **360° photos.** A search asks Mapillary for panoramas separately (a busy
  road fills the ordinary limit before any appear), and any panorama can be
  turned to face the block: `reprojectEquirect` cuts a pinhole view out of the
  equirectangular image at a 60° vertical field of view, shaped like the map,
  and the overlay draws the skyline and block in that virtual camera's pixels.
  Lining one up starts it level, facing the block. There are none around Prince
  George yet; a Kelowna panorama (`1078030356492958`, Insta360 X3) was used to
  check it.
- **Street photos while driving.** With "Show street photos while driving" on,
  a desktop inset shows the photo taken nearest the camera's point on the road
  (within 60 m of it along the road) whose axis is within 50° of where the
  camera is looking, with how far ahead or back it was taken; **Line up**
  jumps to it. It stays hidden while a photo is lined up.

- **Find the location of a photo without GPS.** In Camera, choose **Pick a search area** and click an approximate
  centre on the plan. PGMaps tests nine locations over a 1 km square, searching every heading against the terrain
  skyline (`photoLocationSearch.ts`). The search keeps the field of view fixed. Set the lens and, for an aerial
  photo, the altitude before searching. One skyline reader is kept for the whole search, so every location is scored
  against the same reading of the skyline (`searchByOneReader`): the colour reader at every location, kept alone when
  its best fit settles; else every reader that finds a believable skyline in the photo, the one whose fits sum to the
  highest `searchRank` over the locations. Losses read on different readers' lines are never compared, and a near tie
  is judged within the one reader. When one fit stands clearly ahead it offers up to three starting
  cameras. When fits are about as good as each other (a near tie between places, or a heading with a runner-up as
  close) it lists them with how far apart they are, in metres and as an arc of headings, and offers none of them as
  a start: the top of a tie is not a suggestion. A start taken from the search reads in the Position step as *a
  start from the location search*, still to confirm, never as where the photo was taken. Check the chosen camera
  against recognizable terrain and mapped features before accepting it. A cropped or obscured ridge can still need
  paired landmarks. The photo stays in the browser.

- **A photo of your own.** *Line up photos of my own…* (under the Mapillary
  part, and available without a Mapillary token, at the head of the one block
  that also attaches simulation, map and design images and lists every field
  record; photographs come in only through this window) opens one window
  (`OwnPhotoDialog.tsx`) in three tabs: *Photos*, *Camera* and *Use*. Photos
  are read in the browser; nothing is uploaded.
  - **Photos** (`PhotoStrip.tsx`) takes many JPEG, PNG, WebP or HEIC files at
    once, picked or dropped, and *Field records* photographs (kind `photo`)
    from their stored copies. Each photo becomes a field record of kind
    `photo` as it is read (`photoRecordFromOwn`, `photoRecords.ts`), so it
    outlives a reload in the assessment tools' storage and the project file:
    the record's image is a re-encoded JPEG, and the original bytes stay the
    project attachment, linked by the record's id. A workspace holds at most
    `MAX_FIELD_RECORDS` (24) records, and a set that would pass it is refused
    before anything is read. Photos are grouped into **flights**
    (`photoFlight.ts`: a gap over half an hour starts one) and ordered by the
    camera clock where its time zone is recorded, else by GPS time: on the
    test flight an iPhone's GPS stamp lagged the shutter by 0.5–22 s. Each
    frame shows what it needs as a dot and a word or two
    (`photoStripState`, `photoOptions.ts`): *Check it* for a camera the
    skyline settled, *Needs a landmark* where more than one heading fits,
    *No skyline*, *Ready to accept*, *Accepted*. A status alone does not
    sort a set, since every searched photo is *options ready*. Times are the
    camera's own clock (`cameraClockTime`), the time of day where the photo
    was taken; a photo with only a GPS stamp shows it marked UTC.
    - **Reading a set.** Photos are read several at a time
      (`heicDecodeConcurrency`: one fewer than the cores, at most four, two
      where the browser reports under 8 GB) and each joins the set and the
      queue as soon as it is read, so the first photo's search starts while
      the rest decode. HEIC photos decode in workers kept between photos
      (`heicDecodePool.ts`), each compiling the decoder once and ending
      after eight idle seconds. The set opens on the first photo read, then
      on an earlier one in time when it arrives, unless the reviewer has
      opened another. The strip shows a 320-pixel thumbnail made with the
      record's image, never the full photo. A first set stays on *Photos*;
      a single first photo opens on *Camera*.
    - **On the other tabs** the set stays in reach as one row of small
      pictures under the tabs (`PhotoFilmstrip`), each with its dot, beside
      the queue's place and its pause and cancel. A click opens that photo
      on the tab the reviewer is on.
  - **The automatic queue** (`useFieldPhoto`, rules in `photoQueue.ts`) works
    through the set one photo at a time, in time order, and can be paused,
    resumed or cancelled: terrain round the photo, the 360° horizon, the
    photo's skyline, the search over every heading, and model views for the
    winner and the runner-up. The features check is read after the searches
    (`featuresNext`): the open photo's as soon as its search is done, the
    others' in time order once no search is running or waiting, and only the
    open photo's while the queue is paused or cancelled. A read is six
    requests and megabytes of shapes from DataBC, and inside the queue it
    held each next search back about three seconds. It applies the winner
    only while the heading is still the phone's, the road view's or a
    default; it never overwrites a pose the reviewer set, typed or matched,
    and never accepts one. Each frame ends *options ready* or *failed*, with
    its reasons: *not settled*, *no skyline*, *outside terrain*, *cropped
    lens*, *phone heading only*, *disagrees with frame N*. Far from the road
    is a note, not a block. The horizon, the hit buffer, the model views and
    the drape run in one worker (`photoWork.worker.ts`), never on the page's
    thread.
    - **The model view is coloured from the hit buffer** (`colourHits`,
      `photoViews.ts`), one walk outward along each azimuth, never a ray cast
      through every pixel. Cast per pixel a 320-pixel view took several
      seconds (7.9 s in a benchmark) and was nearly all of the queue's time;
      from the hit buffer it takes about a tenth of a second and is the same
      picture but for a pixel here and there along a ridge
      (`photoViews.test.ts` pins it against `castRay`). Measured on the
      fourteen-photo flight, 17 November 2026, same machine and browser:
      every photo in the strip after 4.9 s (18.7 s before) and every camera
      searched after 23.8 s (152 s before); about 30 s since the brightness
      readers were added, which most of these photos go on to try.
    - **Caches.** Terrain, imagery, horizons, pixels, read skylines, search
      results, hit buffers and feature reads are kept in small
      least-recently-used caches (`PhotoCache`), each held to a count and a
      byte budget and keyed so a burst's frames share them: the horizon by
      position to 4 decimal places and altitude to the metre, imagery by
      place to about 100 m. A photo queued again with nothing changed
      finishes from them.
    - **Bursts.** A frame within 20 s and 500 m of an accepted frame
      (`burstNeighbour`) is searched first round that frame's camera
      (heading ±15°, pitch ±10°). The result is shown as supporting evidence.
      The queue still searches the full circle for competing ridges.
    - **Lenses.** `FocalLengthIn35mmFormat` already includes the iPhone's
      digital zoom, so it is applied once. A photo whose decoded size differs
      from the size its tags record was cropped after it was taken: it is
      flagged *cropped*, and its search tries lenses from the tagged one down
      to 40% of it (`lensRangeFor`). Each candidate keeps its own lens and a
      competing heading can come from a different lens.
  - **Camera** shows the active photo with what is drawn over it, the
    **options card** (`PhotoOptionsCard.tsx`, `photoOptions.ts`) and the
    comparison. The card has a row per candidate: the skyline's winner and
    runner-up, the phone's heading (marked as possibly far out from an
    aircraft), an accepted neighbouring frame's camera with its time gap, a
    point solve and a matched camera. Each row gives heading, pitch and roll,
    agreeing sky columns and their span, the model view's score beside its
    thumbnail, and the sun; the rows are ranked by that evidence, and *Use*
    makes one the camera. When the skyline is ambiguous or is too small to
    fit, *Pair a landmark* starts matching the same point on the photo and
    the plan. *Adjust* opens the hand tools (`PhotoAdjustPanel.tsx`):
    where the photo was taken (typed or **Pick on the plan**, *Taken from the
    air*, altitude or eye height), the angle and lens numbers with each
    value's source and the declination, held angles, the search again near
    this camera, the matched-camera file, paired points and drag-to-align.
    - **Drag-to-align** (`SkylineDragHandles.tsx`, `skylineAlign.ts`): a
      cross at the drawn skyline's middle moves it, and a handle at each side
      turns it about the cross. While dragging, what is drawn follows as a
      picture; on release the drag becomes heading, pitch and roll, set as the
      reviewer's, and the search can refine it from there.
    - **The paired-point table** (`PairedPointsTable.tsx`, `pairResiduals.ts`)
      gives each pair's residual against the solved camera in pixels and in
      metres on the ground, with each pair on or off. An off pair stays drawn
      and measured as a check point: the solve never saw it. The reviewer's
      click and the solved spot are drawn on the photo and on the plan, joined
      by a line.
  - **Use** (`PhotoAcceptPanel.tsx`) accepts the camera and links the photo
    to its jobs (below).
  - **The footer's primary action follows the photo's state**
    (`ownPhotoTabs.ts`, DOM-free): *Add photos*, *Searching 3 of 14* with
    Cancel, *Accept camera*, *Make a viewpoint*, *Stand here*, then *Next
    photo*. There is no separate check step: the check images are drawn
    whenever a photo's camera is on screen. A disabled one says why. The step states
    (`ownPhotoSteps.ts`, DOM-free) say what a camera rests on, never that it
    is right; the phone's own heading counts as still to find.
  - **The sidebar keeps a summary** (`OwnFieldPhoto.tsx`): the set at a
    glance (photos, flights, accepted, where the queue is), the active
    photo's name, camera and state, the way back into the window, and *Stand
    here*. The window's open state, tab and everything it works on live in
    `useFieldPhoto`, so they outlive the window.
  - **Steps that need the plan hide the window.** Picking the spot or a
    paired point hides it while the plan's banner says what to click, with
    the photo and the spot being paired small in the corner; it comes back
    after the click or Cancel.
  - **Layers on the photo** (`PhotoWithOverlays.tsx`, `photoLayers.ts`,
    `photoOverlay.ts`, `photoOverlayDraw.ts`) are drawn in the photo's own
    pixels, never through MapLibre, which cannot stand at an aircraft, forces
    roll 0 and has no lens. The worker casts a ray from each pixel of a
    525-pixel-wide copy to the ground (`photoHitBuffer.ts`) and keeps where
    it lands, how far away and how high. A projected vertex is in sight when
    it is no further than its pixel's hit × 1.03 plus one cell; hidden parts
    are dotted. On by default: the skyline, proposed blocks, recent cutblocks
    and openings, and lakes. Off: the landform, sensitivity units, EVQO,
    private land, rock, sub-landform dividers and lines of force
    (candidates: drawn, never adopted), streams, roads, VRI, inventory
    viewpoints, views of interest, and the reading aids (a level line,
    bearing ticks every 5°, distance contours at 1, 2, 5 and 10 km). Every
    layer takes the figure style's or the block-sheet catalogue's symbol, so
    the photo and the analysis sheet look the same, and labels go through
    `labelOps`. Hovering a layer row tints the ground it covers in the photo.
    The choices are kept in this browser.
    - **Where the layers come from.** The scene's own (blocks, openings,
      landform, private land, views of interest); the features check's
      reads; and what the page holds (`photoPageFeatures.ts`): the scene's
      visual inventory with the box it was read for, the terrain candidates
      found in the landform, and the inventory viewpoints read round a block.
      A photo whose ground lies outside the scene's read reads the visual
      inventory and VRI for the ground its camera sees
      (`usePhotoInventory.ts`), and only once such a layer is switched on.
      A read that failed says *Not read* with its reason, never *None*, and
      is never replaced by another.
    - **Click the photo to read the map** (`photoPick.ts`): distance,
      elevation, slope and aspect, and the block, opening, unit, stand or
      lake under the pixel, tested with `preparePolygons`. Terrain only, for
      the camera as it stands. A clicked spot can become a paired point.
    - **The features check** (`photoFeatures.ts`) reads FWA lakes, rivers,
      wetlands and streams, FTEN roads and consolidated cutblocks of the last
      30 years live from DataBC's WFS, for the box of ground the camera sees
      (`photoSeenBounds`), not the scene: from the air a photo looks many
      kilometres past the scene's data. Lakes should sit on water, roads on
      roads and recent cutblocks on clearings. Each source says what it read
      or *Not read*, and *Read again for this camera* follows a moved camera.
  - **A sky the colour reader cannot read.** The search tries the colour
    reader first and, when its fit does not settle the camera, three
    brightness readers side by side (`SKYLINE_READERS`, `skylineFit.ts`):
    from a row known to be sky, the first run of pixels well darker than the
    sky above. They read a sky lit from behind, under dark cloud or in haze,
    where the land is a silhouette, and the result that fits best is kept
    (`searchRank`). Two frames of the test flight shot toward a low sun gave
    the colour reader 0 and 27 agreeing columns, 140° and 95° from the
    camera; with the brightness reader they read 140.7° and 138.9°, the
    second the camera the photo-matching bench had solved. A best heading
    with fewer than 12 agreeing columns is now *no skyline*, never a best
    fit.
  - **When the skyline does not settle a photo**, the queue compares its
    cameras by the ground as *Combined camera search* does on a click
    (`compareUnsettled`), after the searches, and keeps the result on the
    photo. Depth is used only where this browser already holds the small
    model: the queue never starts a download. Until then an unsettled photo
    offers *Compare with depth* (27 MB, once), after which every unsettled
    photo is compared with it. A photo's depth estimate is kept by record
    and model, in memory and in this browser's database
    (`photoDepthFor`), so it is worked out once. Where the comparison
    favours a camera more than 15° from the one in use, the window says so
    under the options with *Start from it*, which takes that camera and then
    searches the skyline within 20° of its heading. On the frame whose
    skyline is one straight ridge the automatic pick was 207.6°; depth
    favoured 270° (correlation 0.99), and the search inside that sector gave
    263.5° with 280.0° as runner-up, either side of the 275.7° the bench's
    hand-traced skyline gave. It is a start to check, never an acceptance.
  - **One picture at a time.** The *Camera* tab shows either *Layers on the
    photo* or *Against the model view*, switched above the picture, never
    both stacked: stacked they were taller than the window and the second
    could not be seen beside the options. Pairing a landmark or dragging the
    skyline brings the photo back. Above the options one sentence says what
    the open photo needs, and the options card comes before the ways to
    help it (landmarks, flight matching, the combined search).
  - **The comparison** (`PhotoCompare.tsx`): the photo against the model view
    for its camera at the same size, blinked (hold B) or swiped, with the
    agreement score and imagery coverage beside it. For an ambiguous skyline,
    *Compare skyline candidates* opens the photo, the best and runner-up
    model views, and their difference. Both candidates stay available after
    picking one. Use *Field photos* in *Visit* to reopen the comparison while
    standing at a saved viewpoint.
  - **Accept** (`photoAcceptance.ts`, DOM-free) is the reviewer's, never
    automatic, and it is one click with nothing asked first. Initials and a
    note are behind a fold, theirs to add or leave out. The gate
    (`acceptGate`) refuses one thing: a point-solved camera whose held-out
    pair lands more than 40 px off in a 1,050-pixel-wide frame, a measured
    failure. Putting a photo to a job that draws from its camera (a
    viewpoint, the before image, a check of the drawn forest) accepts the
    camera in the same click (`ensureAccepted`). The acceptance goes on the
    photo's field record: when, how the camera was found (skyline, points,
    matched, neighbour, phone or typed), the pose, the evidence (agreeing
    columns and span, settled or not, the runner-up's heading and score, the
    model-view scores, the sun, held-out metres, a neighbour's agreement)
    and whether the check images had been drawn for that exact camera
    (`checksDrawn`), with initials and a note when given. Moving the camera
    afterwards lapses it, and the window says so. Until 18 November 2026
    the gate also asked for the checks to be drawn, initials, and a note for
    a fit that was not settled; a form before every use of a photo was not
    how a reviewer works through a flight.
  - **Jobs.** One record holds the photo and its acceptance; every job is a
    link to it, never a copy (`uses`): a viewpoint, the before image of a
    pair, ground conditions (no accepted camera needed), a check of the drawn
    forest, regrowth over time (evidence for a field green-up judgement,
    never the check itself) and landform evidence. Removing a photo, from
    the window or from *Field records*, removes its record and its original
    and unlinks any view of interest made from it; the view stays.
  - **The project file** keeps each value's source and the last skyline
    search's summary beside the open photo's pose, so a reopened photo says
    where its values came from.
  - **Across a reload** (`useOwnPhotoPersistence.ts`, `toolsStorage.ts`) the
    set comes back by itself: every project attachment's bytes, each
    photo's order and camera, and its depth estimate are kept in this
    browser's database beside the workspace, and the set is opened again
    from the originals once the workspace has loaded, as a project file's
    photos are. Removing a photo removes its original and its row; *Close my
    photos* empties the set and leaves the originals with their records;
    opening a project replaces both. Measured: fourteen photos back in the
    set 4.9 s after a reload.
  - **A line that is not a skyline** is dropped before it is searched
    (`believableSkyline`, `skylineFit.ts`). Every reader will find a line
    in a frame with no sky at all: a shadow's edge across forest, a
    clearing's edge. A read is kept only when the side above it is clearly
    brighter than the side below (`SKY_BRIGHTER`, 1.3 times) or clearly
    smoother (`SKY_SMOOTHER`, 0.75 times the row-to-row texture). On the
    test flight's fourteen frames real skylines read 1.3 to 3 times
    brighter or 0.2 to 0.7 times as textured; the one frame of forest
    filling the picture read 1.1 to 1.2 and 0.8 to 1.1 by every reader,
    and before the check its "best fit" was a camera rolled 14° at the
    edge of the pitch the phone's tilt allows, with 74% of 89 columns
    agreeing. The other thirteen frames' cameras did not change. The
    thresholds rest on that one flight: widen the evidence before moving
    them. A photo with no believable skyline reads *No skyline*, and the
    queue then compares cameras by the ground for it too.
  - **Headings the ground leaves open** (`undecidedHeadings`,
    `photoCombined.ts`): when the cameras that score within `TIED_SCORE` of
    the best look more than `UNDECIDED_SPAN_DEGREES` apart, the window
    names the arc they span and offers no camera to start from. An even
    slope of forest gives depth one fact, which side is nearer; on the
    frame above depth narrowed the heading from every direction to the arc
    from 240° round to 0° and could go no further. On a frame with relief
    it does tell headings apart: the camera the bench solved scored 0.93
    against 0.47 and 0.43 for the other two.
  - **Where things are in the Camera tab**: the picture stands in the same
    place whichever of *Layers on the photo* and *Against the model view*
    is chosen. *Layers* is a button on the photo's corner whose list opens
    over the photo and scrolls inside the window; how to compare (swipe,
    blend, blink) and *Fine-tune camera* are under the picture.
  - **The photo whole in view, and zoomed.** The window is one height for
    every tab and photo, and the picture's column is as tall as the window
    shows of its content (measured, not a share of the screen), so the
    photo is always whole in view. It is sized to that space by its own
    shape (`fitBox`) before it has loaded, so nothing moves when it does,
    and zoomed and panned in place with the shared `ZoomPan` (wheel or
    pinch about the pointer, drag, the buttons in its corner; up to 8×).
    What is drawn over it is redrawn finer at each doubling; numbered
    points and the reading card keep their size. The features check sits in
    the right column so the photo keeps the height.
  - **Nothing is taken away to be put back.** Measured on a set of fourteen
    photos before these rules, the window changed under the reviewer at no
    click of theirs: between every two photos of the queue its line read
    "12 waiting" with no Cancel for a frame or two (the next photo was
    started in an effect, after a paint; it is a layout effect now);
    whenever the queue's follow-up work loaded another photo's terrain, the
    open photo's left the two-entry cache, its camera had no ground, and
    everything drawn over it went away for about 0.4 s (the open photo's
    terrain is now held for as long as it is open, `heldOwnTerrain`); and
    choosing a camera stripped the layers for about a second while its
    ground was cast. The last drawing now stays up, faded, under the
    skyline that already follows the new camera, until the new one is
    ready, and is never read against (`PhotoWithOverlays`'s `held`).
  - **Views drawn ahead.** Every row of the options card has its model
    view, not only the skyline's two: the others (the phone's heading, a
    neighbour's camera, a point solve, a matched camera) are drawn in the
    background, the open photo's first and the rest once nothing is being
    searched or read (`optionViews`, `drawOptionView`), about a tenth of a
    second each in the worker once the place's imagery is held. They record
    no check, because nobody asked for them. The ground under each of the
    open photo's option cameras is cast ahead too (`optionHits`, kept apart
    from `hits`, which the set's other photos fill), so *Use* goes from one
    complete drawing to the next. *Against the model view* draws its view
    by itself as soon as a camera is looked at and keeps the last view up,
    said under it, while the next is drawn; its box has the photo's shape
    whether or not a view is in it. A row's view has the same place before
    and after it arrives.
  - **Off the page's thread.** The camera comparison's scoring of each
    candidate (imagery seen from it against the photo, and the terrain's
    depth from it) is one worker job (`cameraCues`); on the page's thread
    it held it about a tenth of a second a camera, 4.4 s over one traced
    session. The layers on the photo are laid in the worker too, a layer at
    a time for a camera (`overlay` job, `usePhotoLaidLayers.ts`), and kept
    by camera and by what the layer holds (`layerSignature`: the list of
    features is made again at every change of camera, so naming a layer by
    its list laid everything again each time). Once the camera in use has
    its layers the same layers are laid for each option camera in turn.
    Measured with roads on, *Use* went from a strip and about a second, to
    0.4–0.7 s with the page held, to about 0.1 s from one complete drawing
    to the next. A camera not laid ahead (a typed heading, a drag) keeps
    its last drawing up, faded, until all of its layers have come: they
    never arrive one after another over an old picture. One more layer
    switched on for the camera already drawn joins the others as it comes.
    The depth model's worker is kept between photos with its session
    (`photoDepth.ts`) and let go a minute after the last estimate; it was
    started and loaded again for each photo.
  - **Zooming and side by side in the comparison.** *Against the model
    view* is zoomed and panned like the photo, with the same buttons.
    Enlarged, a drag moves the pictures, so the swipe's divider is then
    moved by its own handle; fitted, a drag anywhere still moves it. *Side
    by side* sets the photo and the model view next to each other at one
    size sharing one view, so zooming or moving either moves both, and the
    pointer over one is ringed on the other. The model view is drawn 320
    pixels across, which is what it is scored at: enlarged it shows where
    things are, not detail.
  - **What the comparison offers sits under the options.** The camera the
    ground favours (*Start from it*), the headings it leaves open and
    *Compare with depth* come after the options card, not before it: they
    are worked out a second or more after a photo opens, and above the
    options they pushed the rows down the window under the pointer. The
    one sentence on what the photo needs stays on top, with room for two
    lines whatever it says.
  - **Photos imported before** are listed under the set on the Photos tab:
    every photo record that is not open. *Open* (and *Open all*) carries on
    with that record, its id, the camera it holds, its acceptance and its
    jobs; it never files a second one (`openOwnRecords`). The photo is read
    from its original where one is kept, so it comes back at full size with
    its EXIF, time and lens; a record with no original (filed before
    originals were kept, or brought in by a workspace file, which carries
    none) reads *Small copy only* and opens as its stored 1,600-pixel copy.
    A file chosen again is the record it already is when its name and its
    instant both match (`recordOfPickedPhoto`, `photoRecords.ts`): it opens
    that record, gives it the original it lacked, takes no new room in the
    workspace, and the window says how many were opened that way. A file
    with no recorded time matches nothing. *Remove*, on a row, on the open
    photo, on the Use tab and in *Field records*, asks once in a popover
    (`ConfirmRemoveButton`) and then deletes the record and its original. Measured with fourteen
    photos: one record opened from its original in 1.7 s at 4,284 pixels
    wide, twelve at once in 4.0 s, the same fourteen files chosen again in
    5 to 6 s with no record added.
  - **Layers on the photo** are listed by the shared `LayerList`
    (`src/components/ui/layer-list.tsx`): the switch and the symbol first,
    then the name and a word on its state, each group with its count and a
    switch for the whole group, and *Back to the usual layers*. Anything
    with map geometry and a symbol can be added beside the built-in layers
    as a `PhotoCustomLayer` (`photoLayers.ts`), with no new case in the
    photo tools: its features are laid on the terrain and hidden behind
    nearer ground as theirs are. The scene's road to assess is the first
    (`scenePhotoLayers`, `photoPageFeatures.ts`).
  The starting pose (`exifPose.ts`, DOM-free, unit-tested) comes from the
  field record's camera first, then EXIF (read with `exifr`, already used by
  Field records), then the road view as it stands, then defaults:
  - position from `GPSLatitude`/`GPSLongitude` (a 0, 0 fix is ignored);
  - heading from `GPSImgDirection`. A `T` reference is true north and used as
    is. `M` (magnetic), or no reference, starts the view on the recorded value
    but is labelled not-true-north and offers a declination field (degrees
    east, added to the recorded heading); nothing models declination for you;
  - field of view from `FocalLengthIn35mmFormat`, split along the frame's own
    diagonal (43.27 mm), or else `FocalLength` with the sensor size from
    `FocalPlaneX/YResolution` and the pixel dimensions, turned with a
    quarter-turn `Orientation`; it is the vertical field of view that sets
    MapLibre's lens;
  - `DateTimeOriginal` shown as the camera clock, and the GPS altitude. On the
    ground the eye is placed at the ground under the spot plus the eye height;
    the GPS altitude places it only when the reviewer marks the photo **Taken
    from the air** (phone GPS altitude over ground is too rough for eye level,
    and fine from a helicopter hundreds of metres up).
  Pitch and roll start level (EXIF records neither); eye height starts at the
  settings' observer height. Every value is editable behind *Adjust* — latitude
  and longitude typed or **Pick on the plan**, heading, pitch, roll, field of
  view and eye height — and each says where it came from. The road view's
  overlay adds narrower/wider
  field-of-view buttons beside the turn and tilt arrows; with an own photo the
  arrows and *Auto-align* change the pose itself, and Reset returns heading and
  pitch to where they started. **Save this pose to the field record** writes
  the camera back to the record it came from (altitude as road-view ground
  plus eye height) and leaves its "I checked…" box unticked for the reviewer.
- **Find the camera.** The queue runs the skyline search by itself; *Adjust*
  holds the ways to find the camera again by hand, with no road view, so they
  work for a photo taken far from the scene's road: the skyline search
  (*Search every heading*, *Search near this camera*), *Paired points* and
  *Matched camera*, with *Hold an angle near a
  value* folded under the first two. Every result is a row of the options
  card and is checked like any other. The options follow functional specifications of Pic2Map and
  QCALVIEW written under route A
  (`docs/forestry-road-design/reference-repo-licensing-and-conversion.md`);
  their code was not opened by the implementer.
  - **Skyline search** (*Search every heading*) searches heading, pitch and roll from
    the photo's skyline over every heading (`wideOrientation.ts`, in a
    worker), the browser form of the photo-matching bench's `orient.ts`.
    From an aircraft a phone's recorded heading can be 50–140° out, which
    defeats *Auto-align*'s ±3° search.
    - **Terrain:** zoom 11 to 25 km over a zoom-9 ring to 90 km, about 20
      far tiles.
    - **Search:** a coarse search in angles first. Turning about the
      vertical never changes a ray's elevation, so each pitch and roll is
      worked out once and every heading is a shift along a horizon table.
      Both distinct headings receive the same finer search over heading,
      pitch and roll. `fitSkyline` checks the best candidate against the
      bare-ground and canopy lines.
    - **Pitch:** an iPhone's tilt sensor (Apple maker note, `appleTilt`)
      narrows pitch to ±6° while it reads gravity alone.
    - **Result:** says when another heading at least 15° away fits about as
      well (**not settled**), and shows where the sun was (from the GPS
      fix's UTC time) for both candidates. Select either candidate in the
      camera options.
  - **Hold near a value.** Heading, pitch and roll can each be held near a
    value within a tolerance, from the flight track, the tilt sensor or a
    landmark. The search and the point solve keep them there, so a runner-up
    outside the tolerance is never considered.
  - **Landmark.** *Pick the spot at the photo's centre on the plan* sets
    heading and pitch toward it (with Earth curvature) and holds them, ±20°
    and ±5° by default.
  - **Pair points.** Click a spot in the photo, then the same spot on the
    plan: a road bend, a pond, a block corner. With the position known,
    rotation follows from two pairs in closed form (Horn 1987). Then
    Levenberg–Marquardt runs over position (held near the GPS, ±25 m across
    and ±30 m up), angles (free or held) and the lens (held).
    - **Accuracy:** each pair is left out in turn and measured with the
      camera solved without it, in pixels and metres on the ground.
    - **Warning:** a solved camera that rolls past 30° or moves far from the
      GPS fix is flagged as probably mis-paired.
    - **Plan marks:** the paired spots and the landmark are marked on the
      plan.
  - **Photo on the plan.** Lays the photo on the plan for the camera or the
    runner-up (`photoViews.drapePhoto`, in the worker): each ground cell to
    25 km is coloured from the photo pixel it projects to, and ground hidden
    by nearer terrain is left out. A wrong heading puts the photographed
    roads, openings and lakes in the wrong place, and spreads sky over the
    ground. See **Photo on the plan** below.
  - **Model view.** Draws satellite imagery as the camera would see it
    (`renderModelView`, in the worker) for the camera and the runner-up.
    It scores each against the photo by brightness and edge correlation over
    mapped ground (`modelAgreement`). Adjacent imagery pixels are blended
    to reduce jagged edges. Missing tiles can fall back to coarser imagery. Areas without imagery and the terrain horizon contribute no edge
    score, and a sparse model has no agreement score.
    - **Fine-tune camera** sits beside the model view. The reviewer can
      nudge heading, pitch, roll and field of view, or move the camera in
      metres. Choose *Blend* to compare features overlaid or *Swipe* to
      see both views. The small preview redraws after edits pause. *Restore
      starting camera* returns to the pose and sources held when fine-tuning
      opened. A preview alone does not record a camera check.
  - **Guide with landmarks.** Pair one visible spot in the photo and on the
    plan to get a starting heading and pitch. With two spread landmarks, solve
    the roll as well. With three and a recorded position, the solve can adjust
    the position and report held-out error. A guessed position needs four
    landmarks to hold one out while freeing horizontal position. Check a
    different mapped feature before accepting a one-landmark camera.
    [Input experiments](research/photo-landmark-input-2026-11-18.md)
  - **Match flight photos.** Check and accept one reference camera in the
    *Use* tab, then choose *Find shared features* in the *Camera* tab. For each
    unaccepted photo in the flight, the tool tries up to six accepted references
    within 90 seconds and 1.5 km. A browser worker matches image features at
    several scales. The camera must also pass a check on image regions held out
    of the fit. The tool prefers a terrain-checked camera. It can also offer an
    orientation from the two images with the target position kept at its starting
    coordinates. *Adjust* opens the existing camera controls. Once a reviewer
    checks and accepts the result, rerun to include it as a reference for more
    photos. [Archive measurements and methods](research/photo-flight-matching-2026-11-17.md)
    - **Matcher** (`photoMatchers.ts`): *XFeat*, built in, or *ALIKED +
      LightGlue*, a trial. The second is a learned detector and matcher
      (`NOTICE-PHOTO-MATCH-MODELS.md`) for pairs descriptors alone leave
      unmatched. Its two files (48 MB) are not in the repository:
      `npm run photo-match:fetch-models` puts them, checked by size and
      SHA-256, in the git-ignored `public/models/photo-match/`, and a site
      without them says so when the matcher is chosen. Nothing deploys them
      yet. On the test flight (18 November 2026, two pairs, in the browser):
      from IMG_9319's accepted camera XFeat offered IMG_9320 at 142.2°,
      −3.2°, −1.4° on 229 shared features (held-out 2.2 px median) and the
      learned pair at 139.5°, −5.9°, +0.2° on 584 (0.6 px), against a known
      139.0°, −5.9°, +0.2°. Between two frames 3.6 s apart taken with a
      26 mm and then a 52 mm lens XFeat found no overlap and the learned
      pair 292 shared features. It took 16 s for the two pairs against 2 s.
      Two pairs of one flight: widen the evidence before making it the
      default. Every suggestion names the matcher that paired the photos.
    - **Points too far to take sides** (`sidesOf`, `photoRelativePose.ts`):
      a motion between two cameras is checked by which side of both cameras
      the matched points fall on, and only a point with parallax can say. A
      far ridge seen from two places a few hundred metres apart has none;
      counted as behind the camera, such points threw out pairs matched
      mostly on distant ground (the learned pair's 584 features on IMG_9320
      gave no camera until they were left out of the count). A pair with
      fewer than `MIN_JUDGED_RAYS` points to judge by, or under
      `MIN_JUDGED_SHARE` of its matches, stands on its held-out error alone.
    - **A reference whose camera is wrong is refused, not carried.** The
      image-only orientation must move the camera the way the two GPS
      positions say it moved (within 65° once they are 60 m apart). With
      IMG_9310 accepted at the skyline's unsettled 207.6°, no camera was
      offered for IMG_9311 although 292 features matched: run outside the
      page over every heading, the pair fits the GPS only with IMG_9310
      between 290° and 300° (held-out 0.9 px at 294°; 3.9 px at 282°,
      4.4 px at 310°), which puts IMG_9311 near 275°. The page does not
      search for that; it is a way to check an accepted reference that is
      not built.
    - **Left open** (18 November 2026): XFeat against the model view, which
      picked the true camera sharply in a trial but needs an ONNX export of
      its LighterGlue matcher that nobody publishes; serving the learned
      matcher's 48 MB of models from the deploy, without which the live
      site reports them missing; and the default, which stays XFeat on
      two pairs' evidence.
      [Trials and measurements](research/photo-camera-model-trials-2026-11-18.md)
  - **Combined camera search.** Compares ground appearance with available
    skyline, paired points, and terrain-checked overlap from flight matching or the bench.
    A weak skyline opens a coarse search around the photo's position. Turn
    off *Use the skyline when visible* to compare ground cues alone. An
    optional local Depth Anything model contributes relative depth on pixels
    that show ground for every candidate. Model files download on demand and
    the browser can cache them. The search offers starting cameras for visual
    review and fine-tuning. Open a candidate's score to see the weighted
    contributions, both depth correlations, and available held-out feature
    error at a common image width. [Browser and archive
    experiments](research/photo-combined-camera-2026-11-17.md)
  - **Tested on fourteen helicopter photos (November 2026):**
    - **Search replay:** With the same decoded skylines and live Terrarium
      terrain profiles cached for both runs, the median CPU search fell from
      12.7 s to 1.0 s on the test machine. Twelve frames had a competing
      heading, one had too little bare-terrain agreement to settle, and one
      met the skyline check. Camera accuracy needs independently paired
      landmarks.
    - **Original agreement score:** it ranked the skyline's winner above its
      runner-up on all five photos checked, three of them ambiguous. In the
      browser, on a photo 70 km from the scene's road, it scored 0.30 for the
      winner against −0.06 for the runner-up.
    - **Point solve:** on the real terrain under three photos, with mapped
      road and stream vertices as the pairs (pixels from the trusted camera
      plus 2.5 px of noise), it recovered heading to 0.05–0.3° from the
      phone's heading 85–146° out. Three pairs were enough, and held-out
      errors were 1–40 m.
  - **HEIC.** Chrome and Firefox cannot show an iPhone's HEIC photos, so one
    is decoded in the browser (`src/lib/heic/`): Safari shows it itself, and
    elsewhere a worker decodes it to upright sRGB pixels and hands back a
    JPEG held in memory, in about a second for a 24 MP photo. The file is
    known by its `ftyp` brands, not its name. The tags (position, heading,
    lens, tilt, GPS time) are read from the HEIC itself with `exifr`; the
    JPEG carries none. The picked file stays the original for the project's
    attachment. *Field records* imports read HEIC the same way.
    - **Decoder:** `heic_decode.wasm` (420 KB) is built from
      `crates/heic-decode`, a thin interface over the heifer crate (MIT OR
      Apache-2.0, pure Rust, decode-only build; `NOTICE-HEIFER.md`), with
      `npm run wasm:heic`. The file's rotation is applied and Display P3 is
      converted to sRGB from the ICC profile, which is what a browser draws
      for the same photo exported as JPEG. libheif-js was tried beside it
      and not used: it is LGPL-3.0, which this repository does not ship as
      WebAssembly, three times the size, and returns Display P3 values
      unconverted.
    - **Tested on the fourteen helicopter photos (17 November 2026):** both
      decoders read all fourteen, at the same size and orientation. Against
      macOS's own decoder heifer measured 49.3–51.3 dB (worst channel error
      4–6 of 255) and libheif-js 46.6–51.9 dB (worst 16–32); heifer took
      0.3–0.75 s a photo in Node and libheif-js about 10% less. In the
      browser each opened in 0.6–1.3 s. IMG_9297 opened as HEIC gave the
      camera its JPEG export had given: heading 48.9°, pitch −5.7°, roll
      1.0°, 195 sky columns, 99% agreeing, model-view agreement 0.35.
      IMG_9310 matched its JPEG to 0.1–0.2°. IMG_9320 was *not settled* either
      way, with a different best guess from each file: where the skyline is
      weak, small pixel differences choose between candidates, which is what
      *not settled* reports.
- **From the air, and matched cameras.** An own photo can carry an absolute
  altitude (`OwnPose.altitudeMeters`, metres above sea level): its GPS altitude
  when it was taken from the air (*Adjust* → *Taken from the air*), or the
  altitude of a **matched camera**. *Use a matched camera…* (*Adjust* →
  *Matched camera*) reads a case file of the photo-matching bench
  (`scripts/forestry/photo-matching/`, `matchedCamera.ts`, DOM-free and
  unit-tested), and the camera becomes a row of the options card. From the
  air a phone's heading can be 50–140° out; the bench fits heading, pitch and
  roll to the photo's skyline over all headings, and can refine position
  against mapped features, so its camera replaces every value, each marked
  *from the matched camera*. The panel shows how the camera was found and its
  held-out accuracy, and warns when the case was made for another photo,
  stands more than 300 m from the photo's GPS fix, or carries a skyline fit
  the bench did not trust. Select multiple named case files to supply starting
  cameras to the matching open photos. Preferred candidates from photo review
  remain provisional until checked. Its height over the road view's ground
  (`eyeHeightOver`, the terrain the drive camera stands on) is shown beside
  the altitude, derived and never stored.
- **Photo on the plan.** *Show on the plan, beside the photo* (Camera tab)
  lays the active photo on the plan and closes the window; the photo then
  docks to the right of the plan (`DockedPhotoPane.tsx`) for as long as it is
  laid there and the window is closed, at up to half the plan pane's width
  (its left edge resizes it). Closing the pane leaves the photo on the plan.
  - **A component, not page code.** `PhotoDrapeLayer` draws the drape and
    `PhotoCamerasLayer` the cameras, both mounted in plan mode, with the
    legend's `photo:*` rows (`photo:drape`, `photo:footprint`,
    `photo:camera`, `photo:track`, `photo:pair`). The plan never flies to
    the drape by itself.
  - **The card** (`PhotoDrapeCard.tsx`) switches between the camera's and the
    runner-up's drape (blinking between them settles a *not settled*
    result), between three looks (*Filled*; *Edges*, the photo's edges
    draped in one colour so the imagery stays readable, the most telling
    check from the air; *Footprint*, the frame's outline), sets the opacity,
    and blinks to the imagery while B is held. Ground the frame covers but
    nearer terrain hides is hatched, labelled as terrain only, not the run's
    visibility. *Show the photo's ground* and *Back to the scene* move the
    plan; *Take it off* removes the drape.
  - **Live.** The drape follows the camera: redrawn coarse 200 ms after a
    change, then in full once it has settled for 700 ms. Until then the card
    says which heading it was drawn for and where the camera stands now.
  - **Range.** The drape and the cone reach the frame's far hit, up to 25 km,
    where the zoom-11 terrain round the photo stops.
  - **Linked cursor** (`photoLinkedCursor.ts`): hovering the plan puts a
    crosshair on the docked photo; hovering the photo puts a marker on the
    plan. Hover takes no clicks.
  - **Cameras and track.** Every open photo's camera is drawn with its cone
    (the active photo's out to its frame's far hit), and each flight's
    cameras are joined by a dashed track in time order. A click on a camera
    opens that photo, except while the road view is open (a plan click moves
    it there) or something else is being drawn or picked.
- **Standing at a photo viewpoint.** An accepted camera becomes a view of
  interest only through `viewFromAcceptedPhoto` (*Make a viewpoint*): see
  **Views of interest**. *Stand here* stands the road view at that view, at
  the photo's altitude (the stand's surveyed eye), with its heading, pitch
  (through `horizonSafePitch`), roll and lens. There is no walk off the road
  and no distance limit, so a photo taken far from the scene's road is stood
  at all the same. A photo with an altitude widens the terrain the road view
  loads to a wedge along its heading, its frame and 10° either side, out to
  25 km (`photoStandReach`), within the road view's 128-tile budget: a wider
  box is loaded at a coarser zoom, never as more tiles. A fixed look may
  look down to 88° below the horizon, and keeps its roll. Red ground is
  still the nearest road station's view. The Mapillary path is unchanged and
  still stands on the road line.

Limits: a Mapillary photo's eye stands on the road centreline, not the photo's recorded spot (the panel says how far apart they are, and refuses
beyond 60 m); an own photo's lens is assumed distortion-free, and a cropped one's is searched between the tagged lens and 40% of it, not read; the layers on an own photo and a click's reading are terrain only, with no canopy; photo dates are the camera's clock and can be wrong (that image
says January 2016 on a 2020 camera, in summer). Photos are CC BY-SA 4.0 and
every view credits the photographer. The client token lives in `.env.local` as
`VITE_MAPILLARY_TOKEN` — a client token is built for browsers. No client
secret is used or needed. Without one the street-level part is left out of
*Field photos* with no notice; your own photos and evidence stay.

Still open for own photos (`docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md`, section 6): the
overlay is heavy with every layer on (about 1.8 MB against 155 KB for the usual layers); the own-photo panel
leaves the sidebar while the road view stands at a viewpoint; saved figures of a photo view are level although
the road view takes the photo's roll; the 2×2 comparison and a full paired-point solve have not been driven in
a browser; and on the fourteen-photo flight only two photos settle on the skyline alone.

### Water and the road's class

Also found by that comparison: the illustrative stand grew timber across the
Crooked River, and a 20 m roadside clearing hid the skyline a highway's wider
right-of-way leaves open. Both now come from the basemap's own vector tiles,
read while the overview map is showing (`basemapContext.ts`,
`BasemapContextProbe.tsx`): stems are kept off mapped `water` polygons, and the
cleared width starts from the road's class (trunk 40 m, secondary 30 m, track
12 m, and so on) until the reviewer sets a width of their own. Neither enters
any figure.

### Map scale

The overview map carries a scale bar (`MapScaleBar`, bottom right, desktop),
measured great-circle across the map's middle the way MapLibre's own control
is, so Web Mercator's 1.7× stretch at Prince George is accounted for. It hides
above 60° of pitch, where one bar length no longer holds across the view. At
Tabor Mountain it read 5.522 m per pixel against MapLibre's own projection of
two points 5.510 m apart per pixel. In the road view the stand's metres are
converted with `meterInMercatorCoordinateUnits` at each stem's own latitude,
and a terrain skyline computed from the DEM landed a median 0.5 px (0.04°)
from the one MapLibre drew, 90th percentile about 14 px (1.1°) — the far
hills, where MapLibre draws coarser terrain tiles than the analysis reads.

### Standing the timber up

"Stand the timber up" draws the stand as instanced 3D conifers on the terrain.
It is a drawn picture, not an inventory: timber fills the view at a height you
set, and the proposal, every existing opening, and the road corridor take it off
again. The point is that a cutblock then reads as a **gap in the canopy**, which
is what a visual quality objective is actually written about — a coloured
polygon on a bare hillside tells you where a block is, not whether you can see
it.

### How a stem is drawn

Three ways, and the panel switches between them so they can be compared at the
same camera and the same stem count. *Baked from 3D*, the default since
16 November 2026, is a card taken from the tree's own 3D model (see **Baked
tree cards** below); *Stable silhouettes* and *Billboards* are the drawn
silhouettes described next, at three or two planes a near stem; *Solid cones*
is the third.

**Billboards** put the tree in a texture and stand each stem up as
two triangles, turned to face the camera. It is what forest visualisers do,
because a stand you can see a cutblock across is tens of thousands of stems and
modelled geometry at that count buys detail nobody can resolve past a hundred
metres. At 41,000 stems that is **0.08M triangles a frame against 1.44M** for
cones — eighteen times less — and it looks far better, because a drawn
silhouette with a bole and drooping whorls reads as a tree and a cone never does.

**Solid cones** carry real geometry and real normals, so they light correctly
from any angle and are honest from directly above. They are kept for that, and
for comparison.

Species and height come from **RESULTS forest cover** wherever the province has
surveyed the ground — the same query that feeds screening already carries
`I_SPECIES_CODE_1` and `I_SPECIES_HEIGHT_1`, so a fifteen-year-old opening draws
as nine-metre regeneration of the species planted rather than as mature timber.
Coverage is managed openings only, so most of a view falls through to a regional
mix, and the panel says how much did. Run "Look up this view" first to have any
of it.

The silhouettes are generated in `impostor.ts` rather than shipped as assets:
nine BC interior species (lodgepole pine's long clean bole and short crown,
interior spruce's spire, subalpine fir narrower still, interior Douglas-fir's
broad, open, level-limbed crown, trembling aspen's rounded crown over a pale
stem, paper birch's over a white one, western hemlock's hanging sprays under a
nodding leader, black spruce's thin column with a club at its top, black
cottonwood's open crown on a heavy grey bole), four drawn variants each.
Nothing to license, nothing to download, and the stand can be redrawn for a
different species mix without an art pipeline.

Seven more drawings stand where a species' mature one is the wrong shape
(`TreeForm`, `TREE_DRAWING_IDS` in `forest.ts`), sixteen rows of the atlas in
all:

- **A young conifer**, one for each of the six conifers. A conifer in a stand
  shorter than `CANOPY_CLOSES_AT_METERS` (12 m, the height the page already
  takes a canopy to close at) keeps its branches to the ground, because nothing
  has shaded them out yet. The mature drawing shrunk to 5 m stood a
  regenerating opening on bare stems. Its crown width is still its stand's
  closure's; only the shape that width is stretched from changes
  (`YOUNG_CROWN_RATIO`). The form is read off the stand, never drawn from the
  stem's own random numbers, so marking a stand young moves no stem.
- **The tall shrub.** A thicket's stems (alder, willow: VRI's tall shrub, 3 m)
  were small aspens on bare boles, which read as umbrellas along a road. They
  are several stems from one root under leaves from near the ground.

Both change how much of an eye-level view a stand hides, the shrub most: it is
leaves to the ground where the thicket was see-through below its crowns. On
the Purden Lake sample the drawn stand covered 2 to 6 points more of five
views after these drawings than before (`scripts/forestry/tree-views/README.md`
has the table). The figures the run reports do not read the drawing and did
not move; the *with drawn timber* figure of a saved view does.

### Species from the whole inventory record

VRI records up to six species per stand with their percentages
(`SPECIES_CD_1…6`, `SPECIES_PCT_1…6`) and the projected heights of the leading
two. The run reads them all (`bcVegetationInventory.ts`), and each stem in a
surveyed stand draws its species from that mix (`speciesMixFromInventory`,
`placeTrees`), at its own species' height where VRI records one and the
stand's elsewhere. Around Prince George this matters: a stand led by 30%
cottonwood is 70% spruce, birch and subalpine fir, and drawn by its lead alone
it was a cottonwood stand. Crown widths still come from the stand's closure
(`crownWidthForClosure`); the mix only shares that width out by species.

Douglas-fir (`FD`, `FDI`) is its own species rather than drawn as subalpine
fir: it leads or shares about a quarter of the stands around Prince George
(51 of 189 polygons in a November 2026 query south of the city), and its broad,
open crown reads nothing like a fir's spire.

Western hemlock, black spruce and black cottonwood have their own drawings
too, added on 15 November 2026 from a tally of VRI rank 1 by area over a box
round each sample scene (the share of treed cover):

| Species (VRI code) | Tabor Mountain | Purden Lake | Drawn before as |
|---|---|---|---|
| Interior spruce (`SX`) | 38.5% | 37.6% | spruce |
| Subalpine fir (`BL`) | 18.2% | 10.5% | fir |
| Western hemlock (`HW`) | 0% | 16.4%, leading 17% of stands | fir |
| Paper birch (`EP`) | 12.7% | 6.7% | birch |
| Trembling aspen (`AT`) | 11.0% | 4.6% | aspen |
| Lodgepole pine (`PLI`) | 9.9% | 9.1% | pine |
| Douglas-fir (`FDI`) | 5.2% | 6.6% | Douglas-fir |
| Cottonwood (`AC`, `ACT`) | 3.4% | 1.4% | aspen |
| Black spruce (`SB`) | 1.1% | 4.3% | spruce |
| Western redcedar (`CW`) | 0% | 1.7% | fir |

Hemlock was the second most common tree round Purden Lake and drew as a
subalpine fir's spire. Cedar has no drawing of its own: it takes the hemlock's,
which its drooping conical crown is nearer than the fir's (a judgement, at
1.7% of one scene). The regional mix (`DEFAULT_SPECIES_MIX`) is unchanged:
hemlock grows on one of the two scenes and not the other, so it is drawn only
where the inventory records it.

The new species' crown proportions (`SPECIES_CROWN_RATIO`) are drawing choices,
as the first six are, not measurements. Their snags fall by the curves they
fell by before, now named as borrowed (`borrowedBy` in `stand/snagDecay.ts`):
hemlock the subalpine fir's, black spruce the spruce's, cottonwood the aspen's.

### Ground the inventory says is not forest

VRI also says what non-treed ground is (BC Land Cover Classification, levels
2–5). `groundCoverFromBclcs` reads it as water, wetland, rock, herb, low shrub
or tall shrub. None of these grows the regional mix any more — before, every
meadow and rock face the inventory recorded fell through to it and drew as
mature timber. Tall shrub grows a low broadleaf thicket (3 m, dense); the rest
grow nothing, and the road view colours the ground by cover (meadow paler than
forest floor, rock grey, wetland olive). Display only: the green-area
denominator still reads level 2 as before, and screening still reads treed
stands only.

### Tree shading, and detail when the view is still

Settings beside *Display quality*, all display only:

- **Tree shading.** *Lit* (the default) shades each card as the crown it
  pictures: a normal bent outward from the card's centre line so the sunny side
  of the crown is lit and the far side is not, the lower crown in its own
  shade, light through the needles when the eye looks toward the sun, and a
  little brightness and saturation variety per tree. Solid stems get wrapped
  light and crown-depth shading. *Flat* is the drawing's own colours, as
  before. Lighting never changes which pixels a tree covers.
- **Tree light.** *Fixed* lights every tree from one late-morning direction, as
  the page always has (`FIXED_TREE_SUN`). *Site date and time* lights them from
  where the sun is at the date and time set for the view, the clock the other
  renderers are given (`engineEnvironment`, `treeSunDirection`), kept at least
  12° above the horizon (`LOWEST_TREE_SUN_DEGREES`): on a November afternoon at
  54° north the sun is under 10°, and a stand lit from there is black against
  its sky. The sun is not part of the forest's configuration, so changing the
  hour never regrows the stand.
- **Tree shadows.** The stems within 140 m lay a soft shadow on the ground,
  away from the trees' light (`treeShadows.ts`). A stem the viewing gap leaves
  undrawn lays none: a wedge of bare ground under the shadows of the trees
  taken out of it was a black band across the foreground. MapLibre draws the ground and
  gives a layer no way to light it, so this is not a shadow map: each stem lays
  one dark quad as long as its height and the sun's elevation make it (1.8
  heights at most), bent over the terrain at its foot, middle and end.
  Overlapping shadows darken together, as the floor under a stand does. A
  trial: on ground steeper than three points can follow, part of a shadow can
  sit a little off the surface. Drawn before the trees, so it covers no part of
  one.
- **While moving.** *Lighter* draws the road view at 1.25 device pixels to a
  CSS pixel while it moves and at the screen's own 350 ms after it stops
  (`MovingResolution.tsx`): about 60% fewer pixels a frame on a high-density
  screen. The drive camera places itself by the canvas's size in CSS pixels,
  which this does not change. Off by default: on the machine the test views
  were measured on a moving frame was already under 12 ms.
- **Detail when stopped.** While the view moves every stem is a card, which
  keeps driving smooth. Once the camera has held still for half a second
  (`DETAIL_SETTLE_MS`, read off the frame's own matrix, so turning the head
  counts as moving), the stems within 80, 150 (default) or 250 m are drawn
  again as detailed meshes (`detailedTreeMesh`: branches in whorls with uneven
  extension and gaps, lower limbs drooping more than upper ones, foliage
  sprays from a third of the way out, normals bent outward so a crown shades as
  a volume). The same stems at the same positions, heights and crown widths;
  the cards step back from that ring for the frame. *Faster* turns it off.

  Each spray was an eight-faced solid, and a crown of them read as a heap of
  diamonds. The road view now builds the same tree, branch for branch, with
  each spray as two crossed cards cut out by a bough's picture
  (`foliage: 'cards'`, `treeSprays.ts`: a conifer bough, a pine's needle tufts,
  a hemlock's hanging spray and two leaf clusters, generated like every other
  drawing here). That is 40 to 50% fewer triangles, so a stopped frame takes
  about half the time it did. A stem's mesh is coloured from its drawing's own
  foliage and bark (`drawingPalette`) with the card's tint, where every mesh
  used to be one green and a birch lost its white stem on stopping; limbs
  inside the crown are drawn part bark, part foliage (`LIMB_BARK`). There is a
  mesh for each drawing and each of two trees of it, so the stem that stops is
  the tree that was moving. The solid build is what the scene package still
  hands the other renderers, which have no spray sheet.
- **Distant trees.** *Off* (default) or *Out to 8 km*: a coarse background
  stand on the hills behind a small scene, on terrain and open ground read for
  it. Changing it grows or drops the background band's patches only: the core
  stand's patches never depend on it; see **The far
  forest** for what it reads and what it leaves to the road view's own ground.
  The sightline run, the camera and the scene package never read it. A saved
  view is a picture of what the road view draws, so one saved with it on shows
  the distant trees, and its *with drawn timber* figure counts them; while the
  read is out the stand is not ready (*distant trees loading*), so no saved
  view has them in one of its pictures and not the other.

These follow techniques surveyed in `forestry-visual-tools-trial-2026-11-12.md`
§10 (Sylva's canopy cards, VistaWASM's wrap and back-light, OpenWorldGen-SDK's
crown occlusion, BakedVoxelLighting's whorls), re-implemented here; no code or
asset from those projects is copied.

**Screening is pinned.** The trial measured that a tree's drawn shape alone
moves the share of a view a stand hides by 10–12 points at the same density and
closure. `screenCoverage.test.ts` rasterises every drawing's far card and its
detailed mesh side-on and pins both areas to within half a percent, holds
the detailed mesh within 15% of its card, and holds its baked card (the mean of
its sixteen views) within 3% of its drawn card, so neither stopping nor
choosing *Baked from 3D* changes the screening a viewer sees. The first six
species measure what they were pinned at on 12 November; the later drawings'
meshes were sized to their cards (`SOLID_SPRAY_SIZE`), and every drawing's
bough cards to its drawn card (`BOUGH_CARD_SCALE`, solved by bisection: solve
them again after changing a mesh, a silhouette or a spray picture). Change a silhouette or the mesh and that test fails:
update its figures only on purpose. The first draft of the detailed fir covered
0.79 of its card and the Douglas-fir 1.20; both were tuned against the test.

**Distant crowns keep their coverage.** The atlas's mipmaps are built on the
CPU (`atlasMips.ts`) with each cell's alpha rescaled so the share of texels
past the cut-out threshold matches the full-size cell's. A GPU box filter
thins a ragged crown with distance, and a thinner far canopy would screen less
of a block than the stand it stands for.

### Baked tree cards

*Baked from 3D* (`impostorBake.ts`), the default, takes each tree's card from
its own detailed mesh instead of from a separate silhouette: an orthographic picture
from eight sides round the stem, the surface's normal kept beside its colour.
Three things follow.

- **The card is the tree.** The stem that stops is the stem that was moving,
  in outline and in colour. On the Purden Lake views the stand covers the same
  share of the view moving and stopped to within a point and a half.
- **It shows the side the eye stands on.** Each stem has a turn of its own,
  read off where it stands (`stemTurn`), the same turn its mesh is drawn at,
  and shows the view nearest the bearing from it to the eye. Passed on a road,
  a stem goes through two or three views instead of swivelling one face after
  the camera, and no two neighbours show the same face. Near stems are one card
  each: the crossed planes a silhouette needs are not drawn.
- **It is lit as the mesh is.** Card and mesh go through one function
  (`CROWN_LIGHT_GLSL`), the card from its baked normal, corrected for a stem
  drawn wider than the tree its card was taken from.

A stem shows **one** view, never a blend of two: a blend of two cut-out
outlines ghosts every branch. It changes to the next at an angle of its own
between the two, through a short dither, so a stand never changes at once and
the share of stems showing each view is the share of the way round. A stand's
cover is then the mean of its views' cover, which is what the coverage test
pins.

The far bands' clump cards are built of the same baked trees
(`bakeClumpAtlas`), eight to a card as the drawn clumps are laid out.

**Why not the octahedral grid.** The method is three.ez's octahedral impostor
(MIT; `NOTICE-OCTAHEDRAL-IMPOSTOR.md` says what was taken and what was
changed), which pictures a model from a hemisphere of directions on an
octahedral grid, in square cells round its bounding sphere, and blends the
three nearest. The road view looks within 45° of level and a tree is close to
round, so the views here ring the stem at eye level; a square round a tall
tree's sphere is seven tenths empty, so each view is as narrow as its tree;
and the bake is rasterised on the CPU, so it is the same bytes on every machine
and runs in the unit tests. The grid and its three-view blend would earn their
keep for a camera that looks down on the stand: an aircraft photo match or an
oblique figure, where the crown still changes to a flat disc at 58°
(`TOP_DOWN_SIN`). Not built.

**Cost.** Sixteen drawings, two trees each, eight views: 256 cells of 58 × 192
pixels in two sheets of 928 × 3,072, about 30 MB on the GPU with their
mipmaps, against under 3 MB for the drawn atlas. Baking takes a little over a
second and is done a drawing at a time between frames the first time the
road view opens; until it is ready the stand is drawn from the silhouettes.
*Display quality* → *Detailed* draws baked cards whatever style is chosen, and
*Faster* the two-plane silhouettes. A
near stem's card is 192 pixels tall however near it stands, so a moving near
tree is softer than a stopped one, and a wide shrub's card, stretched from a
narrow cell, softer still. Depth toward the camera is baked into the second
sheet and not yet used.

`scripts/forestry/tree-atlas/export.ts` writes the baked sheets, the clump
cards and the spray sheet as PNG files to look at
(`node --import tsx scripts/forestry/tree-atlas/export.ts`).

### Ground under a stand, and relief over the ground

The road view's forest floor was one colour everywhere. The floor under each
surveyed stand is now a little darker the more its canopy closes
(`forestGround.shade`: nothing at 25% crown closure, to 20% of a dark green at
80%). It was first tried at 42%, which drew the stands' own outlines as
hard-edged patches wherever the viewing gap bared the foreground.

The map's relief shading sat under the first label, and the road view's ground
(floor, open cover, cut soil, road scars) is draped over it at 82–95%, which
all but hid it: a cutblock on a hillside was one flat tan shape. `GroundRelief`
lifts that same layer above those fills and above the block's own cut-ground
colour while the road view draws its own ground (not over imagery, which
carries its own, nor in the note screenshot look or under the analysis
colours, where ground is painted to be read flat), lights it from where the
trees are lit from, and fixes the light to the map: with MapLibre's default
anchor it turned with the head. Its shadow is a dark green at 55%, not the
plan's near-black, which a metre from the eye is ink. It moves and re-lights
the terrain component's layer and adds none. Display only.

### The far forest

**Distant trees** (View options, off by default; `driveForestTerrain.ts`) adds a background band,
one stem for every 160 m, out to 8 km when the road and assessment terrain cover a smaller scene.
It reads its own coarse terrain mosaic (up to 25 DEM tiles at zoom 9–11) and VRI's open ground over
the same square, each kept by request so a road view closed and opened again gets the very read it
had. Only a whole read is kept (no terrain tile missing, no inventory tile failed, capped or cut
short by the time limit); a partial one is drawn but read again next time, and a retry reads afresh
once, its read then kept like any other. The band's ground is the road view's own where it has one and the mosaic only past it, and only
inside a box the open-ground read came back whole for: ground that could not be read stays empty,
and a stem beside it stops its canopy tile short of it (`placeTrees`' `canopyKnownAt`). Its stands
follow the core's rules (`groundCoverFromBclcs`): water, wetland, rock, herb, low shrub and other
non-treed ground grow nothing, tall shrub a low thicket, a sparse stand its own closure, and a
polygon whose record does not say what covers it is unknown, not open, so it grows the regional
stand as the core does. They are listed after the road view's own inventory, and a polygon wholly
inside the run's own read is dropped, so the core read decides wherever it has an answer; a canopy
tile in this band reads the stand that wins its ground, as a stem does (`canopyOpenByFirstStand`), so
a taller core stand listed first is never held back by an open polygon of the background's, and a
winning stand not above canopy closure (a block's regrowth inside its regeneration lag) is open. The
core bands keep the stricter rule: any open polygon keeps a tile off its ground, whatever is listed
first, so a fresh block listed as regrowth before its herb polygon is never roofed.

Turning it on or off grows or drops only the background band's patches: their keys carry the read
(`@key`), every core band keeps its patches, and the reach is not part of `forestPatches`' key. The
reach is set as soon as it is asked for, and the band's ground and
inventory reach `ForestOverlay` apart from the forest configuration (`background`): the core stand
is drawn as soon as the road view's terrain loads, and when the background read comes only the
background band's patches grow, keyed to that read, with nothing else regrown. The read is asked for
while the stand is kept, not while the road view is open, so closing the road view or holding it
across a swap keeps it. The bands still grow nearest first, 0 to 3, the background last. If the
background read is unavailable the road view keeps its own extent and View options says so. While
the read is out the stand is not ready, so a saved view waits for it. The camera, the sightline run,
the scene package and other renderers keep the road view's own ground and inventory and never read
the background band; a saved view's picture shows what the road view draws. Not yet built: ground
inside 3.5 km that the road view's own mosaic does not cover stays empty, as before, because
filling it would regrow the 80 m band when the read comes.

Across a valley is where a block is judged, and past 600 m a drawn stem stands
for many. Five things make that hillside read as one (November 2026; the view
they were worked out on is the Purden Lake sample from 5 km along its road,
the block 2 to 4 km off):

- **A canopy between the cards.** A far card is as tall as its trees and no
  taller, and in the 80 m band the next row up a 20° slope stands 27 m higher:
  the cards stopped reaching each other and the hillside between them was
  forest floor, in stripes. Each far stem now also lays a **canopy tile** over
  its own patch of ground (`TreeInstance.canopy`, the card's second plane in
  `treeLayer.ts`): a square a quarter wider than the band's spacing, at 0.62 of
  the stem's height so the top third of every card stands through it, tilted
  with the slope under the stem. It is crowns seen from above, cut out to the
  stand's crown closure as the eye sees it: along a slanted sight line the
  share of gap is the share straight down to the power of the path's length
  through the canopy (Beer–Lambert), so a stand 45% closed from above is 97%
  closed from across a valley and opens again from a hill above it. Crowns are
  5 m across while that is more than a few pixels, then groups of them twice
  the size at each step, so a far canopy's gaps are gaps between clumps and
  never a speckle. Tiles begin 900 m out and are fully drawn by 1,800 m; nearer,
  the cards close a stand by themselves and a tile would read as a plate. A
  tile turning edge-on, as over a crest, thins out and leaves the skyline to
  the cards.
- **No tile over open ground.** A tile's ground is sampled on a grid
  (`canopyReachAt` in `placeTrees`: 16 m apart out to 3 km, 25 m past it), and
  the tile stops one sample short of the nearest clearing, block, water, edge of
  the stand or ground the inventory calls open. So nothing 20 m wide is roofed
  out to 3 km, and nothing 25 m wide past it, where a road is a few pixels.
  Laying tiles moves no stem and adds none (`farForest.test.ts`).
- **The hill's light.** Every far card was lit as a crown on level ground
  facing the camera, so a sunlit spur and a shaded draw were the same green.
  A far stem carries the slope under it (`TreeInstance.slope`, read across
  about half the band's spacing in `growForestPatch`), and its card and tile
  are lit by that slope against level ground's, between half and 1.45 times,
  coming in between 600 and 1,500 m.
- **Trees on the crest.** MapLibre draws distant ground from coarser elevation
  than the stems are stood on. A summit 3.6 km off was drawn about 30 m lower
  than its trees' feet, which stood them in the sky with a strip of it under
  them (the feet agreed with the elevation MapLibre holds there to 2 m; it is
  the drawn surface that falls short). A far card now runs on 45 m below its
  foot (`FAR_CARD_SKIRT_METERS`) as more of its own crowns, a little darker:
  where the ground is drawn as measured the run is under it and never seen, and
  on such a crest it is what stands between the hill and its trees. The tops
  stay where they were, so the skyline's height does not change.
- **Distance.** A far stand was as saturated as a near one. A card or tile now
  loses colour and takes the sky's by Koschmieder's law at a 14 km reach
  (`withDistance`): 7% at 1 km, 19% at 3 km, 43% at 8 km, never past 65%, with
  a little of its saturation going first. It was a straight 4.5% a kilometre.

All of it is display only and none of it is in the run. What it does to the
picture, measured on that view against the page as it was (same camera, same
168,904 stems): the drawn stand covers 61.1% of the far hillside's part of the
view against 53.6%, and of the block's cut ground showing with the stand
switched off, 76.9% still shows with it on against 76.4%. The canopy closes
the hillside and leaves the block as it was. *Baked from 3D* gives 60.3% and
75.6%: its far clump cards hide about a point more of the block's lower edge
than the drawn ones. A frame takes no longer than it did (7 to 12 ms moving on
the machine measured, as before). `scripts/forestry/tree-views/README.md` has
the table.

**The stand is kept through a change of style.** The placed stand was thrown
away and grown again whenever how a stem is drawn, shaded or detailed was
changed, half a minute at that view; it is now kept for as long as it is
placed the same way (`forestPatches` in `DevForestryVisuals.tsx` is keyed to
what places a stem and nothing else).

### Harvested ground

After harvest a block's ground is soil; three more things make it read as a
cutblock from a road (`harvestedGround.ts`, display only):

- **Slash and stumps.** Piles of lying logs and stumps, about one per 12 m
  square, on cut ground within 600 m of the eye (`placeDebris`, `debrisMesh`),
  seeded per absolute cell so they never move.
- **A hard edge.** Up close the stand is drawn stem for stem and a block's edge
  is already a wall. Past about 250 m each drawn stem stands for several and
  the edge went ragged by half a band's spacing, so the coarse bands also stand
  a row of edge stems just inside the timber along every opening
  (`placeEdgeTrees`), each the species and height the inventory records there.
- **Road cut and fill.** Across a side slope the road leaves a cut bank uphill
  and a fill slope downhill, bare and paler than the forest floor. `roadScar`
  works out each from a bench section (1:1 cut, 1.5:1 fill, capped at 30 m)
  and the drawn ground's cross-slope; no timber grows on either.

Retention patches left inside a block are standing timber when the block
carries them as holes (an inner ring), which is how a block with group
retention imports; `harvestedGround.test.ts` pins it. Existing openings are
drawn at their regrowth height (`regrowth.ts`, *Existing forest*), as before.

### Stand prescriptions: which trees a block takes

A retention or partial-cut block can carry a **stand prescription**
(`TargetPolygon.prescription`, `src/pages/dev-forestry/stand/`): which of the
block's trees are cut and which stay, tree by tree. Step 2's block row opens it
(*Prescribe trees…*); the dialog has the prescription, a stand table and
graphs. It is display only, like the drawn stand it shapes: it is kept out of
`AnalysisInput` and `sceneFingerprint`, so no edit to it stales a run, and
Table 5 and 6 keep reading the row's own retention, volume removed and residual
height. *Use for Table 5/6* copies the prescription's figures into those
fields on the reviewer's click — basal area standing in for volume — and never
otherwise.

**The trees are the drawn stems.** `buildStand` reads the block's stand from
`placeTrees` with the road view's nearest band (4 m grid, seed 1, the scene's
anchor latitude), clearings less the cut blocks, and its grid cell as each
tree's identity (`stemCellKey`). The prescription therefore chooses among the
stems the view shows before harvest, and after harvest the road view draws
exactly the trees it kept, where they stood, at their own heights and crowns:
`Thinning.prescribed` makes `placeTrees` skip the stems it names on that grid,
and coarser bands keep each stem with the share of trees kept around it
(a summed-area table), so groups still read as groups at a few hundred metres.
Placement, species, heights and crowns are `placeTrees`' own, so the stand
keeps its VRI crown closure (`screenCoverage.test.ts` unchanged).

**Diameters are a drawing assumption.** Each stem's DBH follows a
height–diameter curve (`DBH_CURVE`, dbh = a·(h − 1.3)^1.1 with ±12% seeded
spread) scaled per stand so the drawn stems carry VRI's quadratic mean diameter
(`QUAD_DIAM_125`, else from `BASAL_AREA` and live stems); without either the
curve's own `a` gives about 30 cm at 25 m and the stand table says so. Where
VRI records more stems than the 4 m grid can draw (about 587/ha), each drawn
stem stands for several (`expansion`), and every per-hectare figure counts
them.

**Two patterns.**

- *Dispersed*: mark trees from below or above (by diameter or height) or at
  random ("proportional") until the stand left meets the target. After WinSVS's
  thinning dialog (USDA Forest Service, public domain), re-implemented from its
  manual and a written review, with its metric-SDI and target-counting defects
  left out.
- *Grouped*: keep everything that must stay, then keep clumps of trees, larger
  diameters first, each clump sized to bring the kept clump-size distribution
  toward the target (ICO classes: individuals, 2–4, 5–9, 10–15, 16+), until the
  target is met. This is the method published for RxGaming (Bartl-Geller et al.
  2025, *Journal of Forestry* 124:307–320), after Churchill et al. 2013's ICO
  approach, written from the paper alone: RxGaming's code carries no licence and
  was not read. Trees nearer than 6 m share a clump, and membership carries
  through (`readClumps`). The default target distribution is a starting point,
  not a BC reference condition: none is published for interior stands.

**Targets**: the block's recorded share (retention's share kept, or a partial
cut's volume not removed, read as basal area; 50% assumed and said so until one
is recorded), basal area or stems per hectare left, either as a share of the
stand, or Reineke's stand density index (metric: stems/ha × (QMD/25.4)^1.605).
A target that cannot be met says what held the stand: protected trees, the
diameter limit, or the species and diameter window the prescription may cut
(RxGaming's case study shows the same with a diameter limit).

**Limits and outcomes.** Trees can be protected one by one by clicking them
on the plan map (not while the road view is open, when a plan click moves it),
and a diameter limit keeps every larger tree. A *marking efficiency* under
100% leaves that share of marked trees standing, as a crew does. What a cut
tree leaves is the prescription's outcome: hauled (a stump), felled and left
with its crown, or felled and limbed (a log), lying along a felling bearing
with a spread (`treatedStems`, `stumpMesh`, `felledTreeMesh`, `logMesh`), drawn
within 600 m of the eye like slash. The road view's *View options → Tree
colours: by treatment* colours the trees marked to cut before harvest and the
trees kept after it, protected trees in both (`TREATMENT_TINTS`); a colour
only, so every tree covers the same pixels. The plan map draws every
prescribed tree kept, cut or protected, with its record on hover.

**Files.** *Save & export → Prescribed trees* writes every prescribed tree as
CSV or GeoJSON points, the same tree before and after harvest: species,
diameter, height, crown, expansion, why it was kept, what it was left as, its
felling bearing and the size of its clump after harvest. Another renderer gets
the kept trees through the scene package as before (they are the drawn
stems); stumps and felled stems are PGMaps' own drawing.

**Imported tree lists.** *Trees from: Imported tree list* replaces the drawn
stems with measured ones (`treeListImport.ts`, `buildStandFromImport`): a CSV
of LiDAR-detected trees (FUSION's CanopyMaxima or TreeSeg, lidR's
`locate_trees`/`crown_metrics`, RxGaming's tree approximate objects), a stem
map, GeoJSON points, or the LiDAR page's own crown segmentation (each crown's
centroid is the stem, its area the crown). Columns are suggested from their
names and every one can be changed; the coordinate system and the height and
diameter units are asked and never guessed, preselected only where the file
states them. At most `TREE_LIST_MAX_TREES` (25,000) trees are kept, saved in the
scene packed (`packImportedTrees`). An imported tree keeps its measured height
and crown (a list without crowns takes 0.16 × height), takes the recorded
stand's species where the file gives none, and the height–diameter curve
scaled to VRI where it gives no diameter. Each is one tree: tree approximate
objects can hide co-dominant and understory stems, and the stand table says
so. The road view then draws the list itself in place of the near band's grid
stems in the block (`PrescribedCells.replace`); coarser bands thin their grid
stems by the share kept, as for a drawn stand. Measured crowns set the drawn
cover there, not VRI's closure: that is the point of measuring them.

**TASS plot (trial).** *Trees from: TASS plot (trial)* draws a TASS III stem
table (PLOTSY `.tdt`, AppType `Tass_Stems`) over the block
(`tassStandImport.ts`, `TassStandSource.tsx`). It is a trial: remove those two
files and the dialog's `tass` mode to drop it. Columns are read by name from
the export's `.tcl` (PLOTSY column metadata, not Tcl) with their units checked;
without one, only TASS 4.3.1.2's bundled `Tass_Stems` layout is read, and only
when every row has its 28 fields. A `.tcl` that remaps columns (`*ColID`) is
refused. Only live stems over breast height are drawn; snags and down wood are
counted and left out. Which corner the plot coordinates start from is asked
and never assumed: TASS's help puts X/Y at the south-west corner and
row/column at the north-west, and the bundled schema labels its X and Y
"Row" and "Column". The plot is centred on the block, turned to the chosen
bearing and, by default, repeated edge to edge; past `TREE_LIST_MAX_TREES` the
copies nearest the centre are kept, so a large block is drawn as a patch round
its centre and its stand table's per-hectare figures read low. Each tree keeps
TASS's height to crown base (`crownBaseMeters`, packed only when a tree has
one, so other lists save as before), and the near cards and detail meshes draw
the crown from there (`TreeInstance.crownBase`, `TreeLayerOptions.crownBaseOf`,
an identity for every stem without one, so `screenCoverage.test.ts` is
unchanged). It is display only, like every imported list: the run's sightlines
keep the regional canopy. The ministry's sample files are read only by the
env-gated test (`TASS_SAMPLES`), never committed.

**Snags.** *Snags* leaves the largest trees taken, so many per hectare,
topped at the snag height and standing dead (`snagMesh`) instead of felled or
hauled; the tree file lists them as `snag`. Drawing only.

**Snags over time.** *Shown at N years after harvest* draws the snags as they
stand that many years on (`snagDecay.ts`). Each snag's fall year is drawn once
from its species' published survival curve, the inverse of the share still
standing at a seeded draw per tree, so the same snag falls in the same year
every time and one standing at 10 years stood at 5. WinSVS instead re-applied
its reductions to the already-reduced stand each cycle, compounding them. A
fallen snag lies as a log where it fell, and a standing one loses height at
the FVS Fire and Fuels Extension rates (2.28% × the species multiplier of its
height a year until half is gone, then 1% ×; Rebain 2010, rev. 2022, Tables
4.10.2–4.10.3, the BC variant taking the Inland Empire values, which are
workshop values, not BC measurements). The dialog's stand table lists the
snags standing at 0–50 years, as drawn and as the curves expect, with each
curve's source; the tree file gives each snag's fall year.

| Species | Share standing | Source | BC data |
| --- | --- | --- | --- |
| Lodgepole pine | 99% at 5 yr, 72% at 8, 20% at 17.5 | Lewis & Thompson 2008 (CFS MPB Working Paper 2008-30, SBSdk/SBSmc3; mean 28% down at 6–10 yr, 51% on dry sites); Lewis & Hrinkevich 2013 (over 80% down by 15–20 yr, a synthesis) | Yes |
| Subalpine fir | 50% at 25 yr, 3% at 80 | Everett et al. 1999 (Washington Cascades burns, 23–41 cm); BC's Huggard 1997 (ESSF) measured slow early fall by decay class only | No year-by-year curve |
| Spruce | 50% at 25 yr, 18% at 80 | Everett et al. 1999 | No |
| Douglas-fir | 50% at 15 yr, 10% at 80 | Everett et al. 1999 | No |
| Trembling aspen | half-life 15.1 yr | Angers et al. 2010 (boreal Quebec, stem counts); BC aspen cavity trees (Edworthy et al. 2012, Riske Creek) lasted a median 9 yr | No |
| Paper birch | takes aspen's curve, and says so | no western data found | No |

Past a curve's last point the share falls on at its last span's rate. What is
left out, on purpose: no study of topped wildlife-tree stubs was found (pine
fails at its base, so topping is not assumed to slow a fall); diameter, which
Lewis & Thompson found had no effect on pine; and exposure in openings, where
BC aspen cavity trees fell 1.3–1.45 times faster but no difference was
detected for dead trees (Edworthy & Martin 2013). Mountain pine beetle snags
on dry sites fall about twice as fast; the curve is the field mean.

**The profile strip on the plan.** While the dialog's Graphs tab is open, the
plan map outlines the strip its side view is cut from (`profileStripPolygon`,
legend row *Stand profile strip*), following the bearing and width set there.

**Other renderers.** The scene package carries the stems the prescription
leaves in an optional `treated` array (`SCENE_TREATED_FIELDS`: position, kind
stump/felled/log/snag, length, diameter, heading), within the tree radius and
absent when no block has a prescription; the kept trees are in `trees` as
before. The engines' adapters outside `src/` still ignore `treated`.

**Seeds.** Every random choice is seeded from the prescription's `seed` and
each tree's cell, so the same prescription marks the same trees every time;
*Draw again* takes the next seed.

| Limit | Value | Constant |
| --- | --- | --- |
| Grid a stand is read on | 4 m, seed 1 | `STAND_SPACING_METERS`, `STAND_SEED` |
| Largest block read tree by tree | 400,000 grid cells of bounding box (about 640 ha) | `STAND_MAX_CELLS` |
| Clump distance | 6 m (settable 1–20 m) | `ICO_CLUMP_DISTANCE_METERS` |
| Largest clump built for the 16+ class | 25 trees | `LARGEST_CLUMP` |
| Marking efficiency | 50–100% | `parsePrescription` |

**Why TypeScript, not a Rust/WASM crate.** A 98 ha block (54,000 trees) reads
in about 70 ms and either pattern runs in about 100 ms (Vitest, November
2026): sorts, union–find over a grid hash and summed-area tables, none of it
near the cost the cable layout's search has. The stand is cached per block, so
editing a prescription re-runs only the prescription. Move it to a worker, or a
crate, only when a measurement on a real block says to.

### Screen height: how tall timber must be to hide a block

Step 3's *Screen height* (`screenHeight.ts`, `ScreenHeightPanel.tsx`) answers
the design question EnVision's seen-area depth grid answered: from the
station (the road view's, else the assessment viewpoint), how tall a screen of
standing timber would have to be to hide each part of a block's ground. Each
block sample's sightline is walked over the road view's terrain with the run's
curvature, refraction and 0.5 m allowance; terrain that already hides it is
counted apart, missing elevation makes it unknown (never hidden or visible),
and otherwise the smallest clearance between the sightline and the ground
where a screen may stand is its required screen height. By default a screen
stands only outside the block and beyond the run's 50 m eye clearing
(`SCREEN_HEIGHT_NEAR_EYE_METERS`). The panel draws the share of the visible
ground hidden against screen height (0–60 m), the heights that hide half,
three quarters and 90%, and the share hidden at the block's stand height. It
is a design aid for leave strips and screening retention, run on demand in
slices (`runCooperatively`): never a run input and never a VIA figure, because
the run's own figures already include the recorded timber.

| Limit | Value | Constant |
| --- | --- | --- |
| Block samples | at most 2,500 (spacing widened past it) | `SCREEN_HEIGHT_MAX_SAMPLES` |
| Screen heights read | 0–60 m in 1 m steps | `SCREEN_HEIGHT_MAX_METERS`, `SCREEN_HEIGHT_STEP_METERS` |
| No screen near the eye | 50 m, the run's screening clearing | `SCREEN_HEIGHT_NEAR_EYE_METERS` |

### How dense the stand is drawn

From VRI, not from taste. Mature stands (rank 1, treed, 60+ years, 15+ m)
queried in September 2026:

| | Beside the sample road | Tabor Mountain west face | Prince George area |
| --- | --- | --- | --- |
| Live stems/ha, median | 548 | 664 | 426 |
| Crown closure, median | 50% | 50% | 45% |
| Height, median | 25.6 m | 20.9 m | 25 m |

Where a VRI stand covers a stem it is drawn at that stand's own
`VRI_LIVE_STEMS_PER_HA` and `CROWN_CLOSURE`; elsewhere at `REGIONAL_STAND` —
550 stems/ha, 45% closure, 25 m — and the regional species mix, which is
spruce-leading (37%) with fir, aspen and birch through it and pine only a trace:
the beetle took most of the mature pine here, and the mix had been pine-leading.

Crown width is not a species constant any more. `crownWidthForClosure` sizes
each crown so the drawn stems close the canopy by the stand's recorded closure,
allowing for crowns overlapping at random (closure = 1 − exp(−N·a)): 45% at 550
stems/ha is a 3.7 m crown, which is what a 25 m interior spruce carries. Two
corrections make the drawn canopy match: stems sit on a jittered grid and
overlap less than random crowns, so crown area is scaled by 0.8
(`GRID_CROWN_AREA`), and crowns scale with their stem's height draw, so width
is raised by 1/√0.9025 to restore the mean area. Rasterised at 0.5 m, a 45%
stand draws 44–46% in each band, and 25% and 60% land within 2 points. The
species ratios share the width out within the regional mix — a fir narrower,
an aspen broader — relative to that mix's own mean; a surveyed stand of one
species keeps the stand's width. Regeneration the inventory gives no closure
for closes its canopy with height, reaching the regional value at 12 m, and no
crown is drawn wider than four times its tree is tall. Live crown starts about a third of the way up a spruce or fir, as it
does inside a stand, so the view reaches in under the first row.

The old drawing got this wrong in both directions. Crowns were 0.34 × height —
nearly 9 m on a 26 m spruce — so the stocked shell near the road closed to about
80% while the real stands are 45–50%, and the camera faced a wall. The coarser
far shells widened crowns by a fixed 1.7× and 3.5×, which closed them to only
25% and 10%, which is why distant hillsides looked bare. Every band now draws
the same closure: the first 300 m stem for stem at 4 m spacing, the rest at
coarser spacing with crowns widened to hold the closure (at 80 m spacing one
card stands for a clump). About 210,000 stems in all against 172,000 before.
Solid cones are divided by their base diameter (`CONE_BASE_DIAMETER`) so they
are as wide as the billboards, and where one band fades into the next the two
dither against complementary halves of the same noise, so the seam does not
thin.

Past 600 m a card stands for many stems, and one tree stretched to that width
read as a pancake on the skyline while the hillside between cards showed bare.
Closure seen from above is the wrong quantity there: from the road a distant
hillside is seen side-on, through far more canopy per metre of sight line than
the few far cards hold. So the 24 m and 80 m bands draw **clump cards** instead
(`impostorClumpShapes`, a separate atlas): eight whole trees of the stem's
species side by side, one of them full height, on a card 1.6 × the closure
crown width wide (`CLUMP_WIDTH_FACTOR`) — about 1.2 × the band's spacing, so
the rows overlap and a mature hillside closes from across a valley, as it does.

Even so, 80 m cards leave ground between them, and past about 3 km that ground
was the pale basemap — the hill face read as bare. From across a valley the
ground between crowns is shaded forest floor, so the road view drapes a dark
forest-floor colour over the terrain wherever the stand is drawn, bare soil on
cut ground only (a clearcut block, counting disturbance), a muted vegetated
colour under retention and partial cuts, and the basemap's water over both.
The road clearing is a viewing aid, not cut ground, so widening it leaves
forest floor, not a band of soil.

**Facing a block** from the road otherwise shows the roadside trees and
nothing past them, since the assessment station is chosen on bare-earth
sightlines. So while facing a block the stand leaves out a **viewing gap**: a
wedge from the eye toward the block, as wide as the block looks plus 3°, out to
30 m short of its nearest edge (1.5 km at most), as a pullout or a gap in the
roadside timber would give (`viewingGapToward` in `forest.ts`). It is culled in
the tree shaders against a per-frame uniform (`u_gap`), not cut as a clearing:
a clearing that moved with the eye would regrow every forest patch each frame.
*Viewing gap: on/off* on the road-view panel puts the timber back; no number
moves either way.

The silhouettes are drawn at crown ratios near what the closure gives (spruce
0.17, fir 0.12) on cards 0.3 of the tree's height wide, so a near card is not
squeezed into a column; the per-stem tint touches foliage only (tinted bark
turned birch stems pink); and the shader divides colour by coverage, which
takes out the dark fringe filtering left around every crown.

Three details the billboard path turns on:

- **Cut out, do not blend.** Blended foliage needs back-to-front sorting and a
  stand has no back to front. A hard alpha edge costs some aliasing and keeps
  the depth buffer honest, so trees behind a ridge stay behind it.
- **The view direction comes out of the matrix.** MapLibre publishes no camera
  position, and the one place it keeps internally is the value that misleads
  deck.gl. The row of the projection matrix that produces clip `w` measures
  distance from the camera along the view axis, so its gradient
  `(m[3], m[7], m[11])` is the view direction — enough to turn a cylindrical
  billboard, and it cannot disagree with the matrix that drew the ground.
- **From overhead the card lies down.** A cylindrical card seen from straight
  above is edge-on and draws nothing, which left the report's overhead render
  bare ground. Looking down more than about 58° (`TOP_DOWN_SIN`), each card lies
  flat at three quarters of the stem's height as one crown-wide disc sampled
  from the middle of its crown picture, darker at the rim. The road view looks
  near level and the oblique renders 30° down, so neither reaches it, and what a
  tree covers there (`screenCoverage.test.ts`) is unchanged.

### Growing the patch

Three things this needs to get right, all learned the hard way:

- **The patch follows the eye, not the map centre.** With the camera at ground
  level and pitched at the horizon, `map.getCenter()` is where the view ray meets
  the ground plane — ten-odd kilometres out and, in MapLibre's model, below sea
  level. A patch grown there is a two-pixel smudge on the skyline. The forest is
  grown around the current viewing station instead.
- **The road is a clearing.** A 25 m tree standing 15 m away subtends 62°, so at
  a true right-of-way width the near timber fills the frame and nothing beyond it
  can be judged. The corridor is buffered out of the stand, and the cleared width
  is a control — widening it is a viewing aid and moves no number.
- **Four shells.** Stem for stem to 300 m (4 m spacing), then 9 m to 600 m,
  24 m to 3 km and 80 m beyond, each fading into the next. At a kilometre a stem
  is a pixel or two and only the texture matters, so the same budget goes much
  further; the canopy closure is held constant across them (above).

It draws through a **MapLibre custom layer**, not a deck.gl overlay, and that is
deliberate. deck.gl's MapLibre integration derives its camera height from
`map.transform.elevation`, documented as the ground elevation under the map
centre. Under this drive camera that value is a camera-fitting residual — about
−294 m at Tabor Mountain — and deck.gl's camera lands at sea level while
MapLibre's is on the hillside at 707 m. Nothing draws, with no error anywhere:
the layer is added, the model is built and instanced, `render` is called, and
`gl.getError()` is clean. Taking `modelViewProjectionMatrix` straight from the
render call sidesteps the question — the trees are projected by exactly the
matrix that projected the ground under them.

### The scene for other renderers

*Save & export* → **3D scene** writes `forestry-scene-package.json` while the road view is open
(`scenePackage.ts`, format `pgmaps-forest-scene` v1). It holds the road view's
scene, renderer-neutral and display only:

- every stem the road view draws (the same patches and seeds as
  `ForestOverlay`; each band up to the middle of its overlap, so no stem is
  written twice);
- the drawn ground on a grid;
- openings, slash and road scars;
- the eye, bearing, pitch and vertical field of view;
- each species' own detailed model.

The package names six species (`PACKAGE_SPECIES_IDS`). The other renderers
build their trees by species name and draw one they do not know as a spruce, so
a cottonwood would come out a conifer there: a hemlock goes as the fir, a black
spruce as the spruce and a cottonwood as the aspen each was drawn as before it
had a drawing of its own (`packageSpecies`), and a stem's young or shrub form
is not sent. The package is what it was; teaching an engine the new species is
a change to the engine and then to this list.

The models are `detailedTreeMesh`, which stands exactly one unit tall, so a
stem's recorded height is the height it is drawn at.

Other engines read the package through adapters kept outside the app
(`docs/forestry-visual-tools-trial/engines/`). Nothing in `src/` imports
them. The VistaWASM bench (AGPL-3.0) is installed only in its own folder and is
never shipped.

### Choosing the renderer

View options → **Renderer** picks what draws the road view: *PGMaps* (its own
map, the default), *threejs-worldgen* or *Nanite Forest*
(`externalRenderers.ts`, `ExternalRoadRenderer.tsx`). The engine draws over the
road view's map, which stays mounted underneath and keeps driving: the engine
takes no pointer input, so dragging to look round, the drive bar and every
control still act on PGMaps' map, and the engine follows it. An engine runs one
of two ways (`EngineSurface.tsx`, `engineChannel.ts`):

- **As a worker PGMaps starts** (both engines). PGMaps lays a canvas over the
  map, hands it to the worker as an OffscreenCanvas
  (`pgmaps-worker-init`), sends its size as it changes
  (`pgmaps-worker-viewport`), and places it where the engine says its
  letterboxed drawing sits (`pgmaps-engine-viewport`). The worker has its own
  thread, so a stand it builds never blocks the page, and it is same-origin, so
  it needs no second site. Each engine's script is built from its submodule
  (`vendor/threejs-nanites`, `vendor/threejs-worldgen`) into the git-ignored
  `public/engines/<id>/` by `npm run engines:build`
  (`scripts/build-engines.mjs`, run by `predev` and `prebuild` too; it
  rebuilds an engine only when its submodule's commit moves). The engine's own
  scene code runs unchanged in its page and its worker through a host
  (`examples/pgmaps/host.ts` in Nanite, `example/pgmaps-host.ts` in
  worldgen).
- **As its own page in a frame**, only when `VITE_FORESTRY_WORLDGEN_URL` or
  `VITE_FORESTRY_NANITE_URL` names one: a release, or the engine's dev server,
  to compare against. Nothing of the engine is bundled; the frame is found by
  URL.

- **The bridge** is `postMessage` (`pgmaps-engine` v1, described at the top of
  `externalRenderers.ts`), the same to a worker as to a frame: the engine says
  hello, the page sends a scene package
  and then the camera on every map move (once a frame at most), in the
  package's local metres. A new package goes when the stand changes (harvest
  phase, forest records, openings, terrain) or once the eye is a third of the
  tree radius (200 m) from the package's origin. Display switches never send one.
- **Where an engine is**: its worker at `engines/<id>/pgmaps-engine.js` under
  the site's base, or the page its variable names. A worker that was never
  built says to run `npm run engines:build`. Nanite also needs WebGPU (in a
  worker as well); worldgen falls back to WebGL2.
- **Display only, but for the analysis sheet.** Saved views, *Image* and every
  figure but one come from PGMaps' map, never the engine's frame. Engines draw a
  tree differently, and a drawn shape moved screening by 10–12 points in the
  trial, so the status line under an engine says its figures are PGMaps' own.
- **The analysis sheet from an engine** (`engineCapture.ts`,
  `engineFramedCapture.ts`). *Save viewpoint* with an engine chosen asks the
  engine for the sheet's frames (`pgmaps-capture`), not PGMaps' map: first a
  scene whose terrain reaches a kilometre past the landform and blocks
  (`captureTerrain`, up to 12 km, near 800 posts across), then, for each frame
  of the framing plan, the picture, a class pass in the sheet's own palette with
  the engine's trees (white) and water (orange) as classes of their own, and
  depth in metres along the view axis, all from one scene and one camera. The
  reply is checked frame by frame (`readCaptureReply`) and refused when the
  engine drew from another camera (`cameraMismatch`), because the sheet's
  outlines and callouts are projected with the camera asked for. The engine
  returns two class passes: the ground pass (`classes`: the class polygons on
  its terrain, no trees drawn, nearer ground still hiding farther ground) and
  the screened pass (`screened`: its trees drawn, each in the class of the
  ground under its own stem, so a landform's own forest is the landform and
  only trees standing off every class polygon, or in water, screen). Outlines
  and the sheet's pixel measure come from the ground pass, so they run on the
  ground over the forest as the VIAs' own renders draw them; a second line
  prints the screened figure. Painting every tree as screening had shredded the
  landform at a lake viewpoint and nearly doubled its pixel figure. A line under
  the measures names the renderer and its version, and another lists, in short
  phrases, what was drawn without data; the measures wrap, shrink and then
  ellipsize to their cell (`fittedLines`);
  the sightline figure stays PGMaps' run. A capture's scene carries stems half a
  kilometre past the farthest class polygon (`captureTerrain`), so a far block
  reads as a cut in forest, and coarse terrain to 15 km (`farTerrain`, from a
  skyline mosaic, `skylineTerrain.ts`) so the ridges behind it are real. Past
  that, the frames' own skyline is scanned on a wide mosaic (`skylineReach.ts`:
  earth curvature and refraction k = 0.13), and when it stands past 15 km a
  coarsest grid (`skylineTerrain`, curvature already dropped from its heights)
  reaches the farthest skyline point plus a tenth or 2 km, at most 60 km: Lost
  Ledge's peak on the left stands 17–19 km off, Gun Lake VPT1's 26–32 km. The
  saved figure keeps the capture's
  provenance (`FigureIllustration`: renderer, version, scene date, the light and
  weather drawn, depth range, and what was drawn without data). VQO zone
  shading is not drawn on an engine's picture.
- **Retention in the class pass.** `retained` masks (wildlife tree patches,
  group reserves) are cut out of the blocks' class layers
  (`classPassLayers`), as the run already treats them: every sheet's pixel
  figure, PGMaps' map included, had counted a block's reserves as cut.
- **Water, light and weather.** The package carries the basemap's lakes and
  rivers that reach its terrain (`water`, each at the lowest ground round its
  shore). With an engine chosen, View options adds *When* (date and time),
  *Clock*, *Sun*, *Ground* (bare or snow) and *Weather* (clear, overcast, rain,
  snowing); they go as their own `pgmaps-environment` message
  (`engineEnvironment`) and never rebuild the stand. PGMaps' own drawing
  ignores them.
- **Ground cover and burns.** The package's terrain carries a cover code per
  post (`terrain.cover`, `SCENE_COVER` in `sceneCover.ts`: forest, sparse,
  shrub, herb, rock, water, cut, burnt), its crown closure (`canopy`) and the
  year of the last fire (`burntYear`), with the fires themselves in `fires`.
  Cover comes from VRI rank-1 BCLCS, live from DataBC's WFS; a post steeper
  than the bluff slope is rock under any polygon; a coastal stand whose VRI
  non-vegetated components record `ROCKY_GROUND_PERCENT` (10) or more of
  bedrock, talus or blockfield is rock under its trees, which still grow
  (fitted to 12 registered Visual Nature Studio renders: it marks 26% of the
  inland ground they draw as rock and 1.6% of what they draw as forest).
  Most pale bands in those renders are not rock in any record: 31% of the rock
  cells lie within 60 m of a transmission line, which no cover code draws.
  Burns come from the BC Wildfire historical fire perimeters
  (`PROT_HISTORICAL_FIRE_POLYS_SP`, `bcWildfire.ts`, `fetch` passed in, box in
  `CQL_FILTER`): a post that reads as forest or sparse forest inside a
  perimeter from the last `BURNT_RECENT_YEARS` (20) is burnt, drawn by both engines as standing snags at the
  pre-fire closure over ground that greens with the years since the fire.
  A polygon whose inventory records a burn in that window
  (`EARLIEST_NONLOGGING_DIST_TYPE` a `B` code and its date, `VriStand.burnYear`)
  is burnt too, whatever cover it now reads: an inventory updated for a fire
  reclassifies the standing dead timber as shrub or herb. At Gun Lake's
  Lakeview viewpoint the 2023 fire K71649 covers 99% of the landform, and the
  updated record calls 66% of it non-treed; Sentinel-2 greenness there fell from
  0.80 (2022) to 0.40 (2025). The consultant's 2025 render draws the pre-fire
  forest. Other herb or shrub ground stays so. Cover is display
  only: no figure reads it, and the class pass never draws it.
- **The site's clock, not the computer's.** The date and time are read in the
  site's time zone (`siteTimeZone`: Pacific; Mountain in the East Kootenay;
  Mountain standard all year in the Peace, Fort Nelson and Creston; *Clock*
  overrides it), and the message carries that zone, the offset and the UTC
  instant. Read in the computer's zone, the same "15:30" was a different moment
  on a reviewer's laptop in Alberta. The zone screen is coarse at its
  boundaries; the unit test pins the towns on each side.
- **The sun asked for and the sun drawn.** *Sun* is *True position* by default:
  the engine lights the scene from where the sun is, with no sunlight at night.
  *Kept to daylight* is the engines' own look, which lifted a low sun (Nanite
  lit at no less than 6°) or moved a night clock to dusk (worldgen). Each engine
  reports the sun it computed and the one its light came from (`sun` in its
  stats), and the status line says so when they differ, so a matched sun angle
  is never taken for matched shadows.
- **Clouds and visibility.** *Clouds* (none, few, scattered, broken; full in
  overcast, rain and snow) and *Visibility* (no haze, or 100 to 4 km) go in the
  environment as `cloudCover` and `visibilityKm`, and every engine draws exactly
  that sky, so renderers are compared under one sky. Visibility follows
  Koschmieder (extinction 3.912 / visibility); *No haze* (`NO_HAZE_KM`) turns
  haze off and is the default for now, as the VIAs' own renders draw none.
- **Wind and look.** *Wind* (calm 0, light 2, breezy 5, windy 9 m/s; default
  calm) and *Look* (*VIA convention*, the default, or *Photo match*) go in the
  environment as `windMs` and `look`. Wind sets the water's roughness (Cox–Munk:
  calm is a mirror with the far shore in it, wind ripples it toward the sky's
  reflection). The two looks exist because the references disagree: the
  consultants' renders draw a dark olive canopy, mirror lakes and no haze to
  8–10 km, a photograph blue-grey far forest, haze from *Visibility* and
  rippled water. Display only, like the rest of the environment.
- **Final render** (`quality: 'final'`, `finalStand.ts`). The analysis sheet's
  capture from an engine asks for the report's still rather than the road
  view's frame: the engine freezes the pose, waits for every stream and LOD,
  fits its shadows to the frame, accumulates `samples` (24) jittered samples a
  frame, and draws the forest past the distance where a tree is under
  `canopyCutoffPx` (4) pixels tall as a canopy surface (Visual Nature Studio's
  dissolve rule). With the request goes the frame's forest at real density
  (`stand`, transferred, not copied): the road view's near-band placement
  (`forestPatches` tiles of its 4 m band, `growForestPatch`, the same seed) out
  to the farthest class polygon plus a kilometre (`finalStandRadius`) within
  the frames' bearings and 3° each side (`finalStandBearings`). Species, heights,
  VRI stems/ha (up to the band's 590/ha) and crown closure, clearings,
  openings, thinnings, reserves and tree-free areas follow the road view's own
  rules, and inside 300 m the stems are the road view's own; crowns come from
  `crownWidthForClosure` at that density (about 3–4 m) and never pass 0.35 of
  the stem's height. Patches grow nearest first; at `FINAL_STAND_MAX_STEMS`
  (1.5 M) growing stops and the stand's radius comes in to the nearest ground
  not grown, so it is always complete out to the radius it reports. A Gun Lake
  VPT1-sized stand (landform to 6.3 km, one 50 mm frame) is about 1.0 M stems
  (28 MB) grown in about 0.6 s in the browser; four frames across 166° hit the
  budget at 4.6 km (1.38 M stems, 0.8 s). The ground class pass is unchanged
  (it never draws trees); the picture, the screened pass and depth use the
  final stems. The engine reports what it drew (`final`: samples, stems drawn,
  canopy cut-off, time), kept in the saved figure's `FigureIllustration` with
  the stand PGMaps sent; the renderer line prints "final render: 24 samples,
  1.38 M stems", or "active render (final not drawn)" for an engine that
  ignored `quality`, whose capture is still taken. Display only: the stand is
  never an analysis input, and the sightline figure stays PGMaps' run.
- **One sun for every engine.** PGMaps works the sun out itself
  (`sunPosition`, `src/lib/geo/solarPosition.ts`, NOAA's equations) and sends it
  as `sunPosition`; engines light from it rather than their own ephemeris.
  threejs-sky's put the same moment 0.25° lower and 0.7° round (0.6° against
  0.9° at 16:15 on 20 January at Prince George), so worldgen now nudges its sky
  clock (about 2 minutes) to stand its sun at PGMaps' elevation and reports the
  shift. The viewshed tool keeps its own low-order ephemeris.
- **Stable trees across phases.** A harvest removes stems from the package and
  never moves or resizes the rest (`scenePackage.test.ts`), and both engines now
  give a stem its model from its own size on a fixed ladder (worldgen by height,
  Nanite by crown ratio) seeded by species and rung, never from the population
  present, so a retained tree keeps its shape from before to after. Stumps,
  slash and piles are seeded from their own geometry, not record order.
- PGMaps' map still draws underneath while an engine is chosen; the two share
  the GPU.

## Files

| Path | Role |
| --- | --- |
| `src/pages/dev-forestry/scenePackage.ts` | The road view's scene as a renderer-neutral file, for the other-renderer trial |
| `src/pages/dev-forestry/externalRenderers.ts` | The road view's renderer choice: engines, where each is found, the camera in package metres, the message protocol |
| `src/pages/dev-forestry/ExternalRoadRenderer.tsx` | An engine's frame over the road view and the `postMessage` bridge that feeds it |
| `src/pages/DevForestryVisuals.tsx` | Page: scene state, the tiled workspace and its two maps, drawing, import/export |
| `src/pages/dev-forestry/VisualQualityLayers.tsx` | The scene's map layers, drawn in the plan map (`mode="plan"`) and the road view (`mode="eye"`) |
| `src/pages/dev-forestry/visualsWorkspace.ts` | The workspace's panes, presets and which panes show before the road view opens |
| `src/pages/dev-forestry/viewpointSummaryRows.ts` | The viewpoint summary's rows, read from the run |
| `src/pages/dev-forestry/ViewpointSummary.tsx` | The summary pane and its settings dialog, on the shared `MetricSummary` |
| `src/lib/forestry/terrain/terrain.ts` | DEM tile maths and the elevation mosaic (from `@pgmaps/geo-toolkit/terrain`) |
| `src/pages/dev-forestry/visibility.ts` | Sightlines, sampling, areas, perspective weighting |
| `src/pages/dev-forestry/analysis.ts` | The run itself — stations, grids, reduction |
| `src/pages/dev-forestry/analysis.worker.ts` | Off-thread wrapper: fetch terrain, then trace |
| `src/lib/forestry/terrain/demLoader.ts` | Tile fetching and decoding, with an injectable decoder (the toolkit's loader, with PG Maps' tile store) |
| `src/pages/dev-forestry/vqo.ts` | Visual quality classes, both threshold scales, VAC, green-up, partial cutting |
| `src/pages/dev-forestry/via.ts` | The VIA handbook's steps and Tables 1–7: ocular class, X, adjustments, final rating |
| `src/pages/dev-forestry/ViaPanels.tsx` | The headline and the step 2, 4 and 5 fields that record the reviewer's judgements |
| `src/pages/dev-forestry/Sidebar.tsx` | The five handbook steps, and the page's panels placed in them |
| `src/pages/dev-forestry/photoPose.ts` | A photo's camera: OpenSfM rotation to bearing/pitch/roll, lens to field of view, projection, terrain skyline |
| `src/pages/dev-forestry/mapillary.ts` | Mapillary Graph API: parse a link, fetch a pose, search along a road, rank photos facing a block |
| `src/pages/dev-forestry/skylineFit.ts` | Reading the sky line out of a photo, and fitting heading and pitch to the terrain skyline |
| `src/pages/dev-forestry/useFieldPhoto.ts`, `FieldPhoto.tsx` | Step 2's field photo panel, the registered overlay, and the street-photo inset |
| `src/pages/dev-forestry/landformFromTerrain.ts`, `TerrainLandformFinder.tsx` | A candidate landform from the terrain: facing, slope, drainage and water edges |
| `src/pages/dev-forestry/basemapContext.ts` | Water polygons and the road's class from the basemap, clearing width by class |
| `src/pages/dev-forestry/scene.ts` | The page's document: persistence, export, map features |
| `src/pages/dev-forestry/shapeImport.ts` | Zipped shapefile and GeoJSON import |
| `src/pages/dev-forestry/bcVisualInventory.ts` | DataBC parsers, the inventory WFS request, and live harvest/forest-cover queries; `visualInventoryQuery.ts` reads the inventory |
| `src/pages/dev-forestry/DriveCamera.tsx` | Eye-level camera and playback |
| `src/pages/dev-forestry/TerrainSupport.tsx` | Hillshade, 3D terrain, and sky |
| `src/pages/dev-forestry/reverseViewshed.ts` | Working backwards: which roads can see a block |
| `src/pages/dev-forestry/roadSnap.ts` | Roads from the basemap; locking a drawn line onto one |
| `src/pages/dev-forestry/forest.ts` | Cone geometry, stem placement, species mix, and the road buffer |
| `src/pages/dev-forestry/impostor.ts` | Drawn tree silhouettes and the atlas they are packed into |
| `src/pages/dev-forestry/treeLayer.ts` | The MapLibre custom layer that draws the stand |
| `src/pages/dev-forestry/impostorBake.ts` | Tree cards baked from the detailed meshes, eight views a tree, and the clump cards built of them |
| `src/pages/dev-forestry/treeSprays.ts` | The bough and leaf pictures a detailed mesh's foliage cards are cut out by |
| `src/pages/dev-forestry/treeShadows.ts` | The shadows the nearest stems lay on the ground |
| `src/pages/dev-forestry/GroundRelief.tsx` | Relief shading lifted over the road view's drawn ground, lit as the trees are |
| `src/pages/dev-forestry/MovingResolution.tsx` | A lower drawing resolution while the road view moves |
| `src/pages/dev-forestry/NOTICE-OCTAHEDRAL-IMPOSTOR.md` | What the baked cards take from three.ez's octahedral impostor (MIT) |
| `scripts/forestry/tree-atlas/export.ts` | Writes the baked sheets and the spray sheet as PNG files |
| `scripts/forestry/tree-views/` | Fixed road-view cameras measured for picture, tree cover and frame time, with the figures recorded |
| `src/pages/dev-forestry/ForestOverlay.tsx` | Which ground to grow, and when to regrow it |
| `src/pages/dev-forestry/visualsNarrative.ts`, `VisualsParagraphPanel.tsx` | Step 5's planning-note summary and the drafted Visuals paragraph |
| `src/pages/dev-forestry/fieldChecklist.ts`, `fieldBrief.ts`, `FieldBriefPanel.tsx` | The VIA stage, the crew checklist, and step 2's one-page field brief |
| `src/pages/dev-forestry/visualsBlockSheet.ts`, `visualsBlockSheetPdf.ts`, `VisualsBlockSheetSetup.tsx` | Save & export's block map sheet: its layers, map style, series plan and file writing from the scene (DOM-free), the browser writer that reads the terrain tiles and loads jsPDF or the rasteriser, and its options form |
| `src/pages/dev-forestry/visualMeasures.ts` | The drafted visual measures for the Site Plan and Logging Plan (pure) |
| `src/pages/dev-forestry/WildlifeTreePatchPanel.tsx` | Step 3's *Draw a wildlife tree patch* and the patches in the scene |
| `src/pages/dev-forestry/viewpointInventory.ts`, `ViewpointFinderPanel.tsx` | VLI viewpoints and arrows, rec sites, screenings and tenure road names around a block |
| `src/pages/dev-forestry/ridgeLayers.ts` | A candidate landform as the ridge layer seen from the road |
| `src/pages/dev-forestry/viewsOfInterest.ts`, `viewsOfInterestGeometry.ts`, `ViewsOfInterestPanel.tsx`, `ViewsOfInterestLayers.tsx` | Step 2's views of interest: the model, its plan geometry, the panel and the plan's points, cones and arrows |
| `src/pages/dev-forestry/useViewCapture.ts`, `viewCapturePlan.ts` | Capturing planned views as saved views without driving, and its decisions (waits, place, replacement, single-frame framing) |
| `src/pages/dev-forestry/summaryViewSwitch.ts` | The Viewpoint summary's planned-view switcher |
| `src/pages/dev-forestry/viewLandform.ts`, `ViewLandforms.tsx` | The site landform and each view's own: a view's visible face read from its place, a candidate adopted for that view only; who is assessed against what, and a view's landform following the site's objective and VAC |
| `src/components/ui/map-satellite-imagery.tsx` | Satellite imagery under the page's layers (shared with the road-design plan) |
| `src/components/ui/map-sketch.tsx`, `map-measure.tsx`, `src/lib/geo/mapSketch.ts` | The plan's Measure tool and the drawing of roads and areas (shared with `/dev/interact` and the road-design plan) |

`terrain.ts`, `visibility.ts`, `vqo.ts`, `via.ts`, `photoPose.ts`, `skylineFit.ts`, `landformFromTerrain.ts`, `ridgeLayers.ts`, `visualsNarrative.ts`, `fieldChecklist.ts`, `fieldBrief.ts`, `basemapContext.ts`, `shapeImport.ts`, `reverseViewshed.ts`,
`roadSnap.ts`, `forest.ts`, `viewsOfInterest.ts`, `viewsOfInterestGeometry.ts`, `viewCapturePlan.ts`, `summaryViewSwitch.ts` and `viewLandform.ts` are pure and carry unit tests; `analysis.ts` takes an `ElevationSource`, so a run can be driven
against synthetic terrain or real tiles outside a browser. `demLoader.ts` takes
an injectable decoder for the same reason — the browser path uses
`createImageBitmap` and `OffscreenCanvas`, which Node has neither of.

End-to-end coverage is `tests/e2e/forestry-visual-quality.spec.ts`, which stubs
the DEM with a synthetic flat-terrain tile so the expected answer is geometry
rather than whatever the real world does today.

Its basemap stub must not carry `glyphs: ''`. MapLibre never resolves an empty
glyph URL template, so the style never finishes loading, the map context's
`isLoaded` stays false, and everything gated on it — 3D terrain, hillshade, the
3D stand — silently does nothing while tests that only read sidebar text carry on
passing. The drive and stand tests now assert `map.getTerrain()` and the tree
layer's own stem count rather than the copy beside them, and both fail if either
component is reduced to a no-op.

## The planning note's Visuals paragraph

Save & export's **Block note** options (step 5's *Visuals note…*) head the block the way a BCTS block
report does — block, licence, cutting permit and opening when the imported
attributes carry them (`planningIds` in `shapeImport.ts`, any case of
`BLOCK_ID`, `LICENCE_ID`, `PERMIT_ID`, `OPENING_ID`), its area, and the EVQO
classes under it — and drafts the **Visuals** paragraph of the report's
"Other Considerations" sheet from the run. The reviewer's text
(`viaReview.visualsNote`) is kept once written; the draft stays beside it, each
sentence with the measurement it was written from. `viaReview` stays out of the
scene fingerprint, so editing the paragraph never stales a run.

`visualsNarrative.ts` writes it in the order planners do, read off eight real
paragraphs (BCTS Prince George 2026, CHU_26_1–4 and ML_26_1–6) that
`visualsNarrative.test.ts` pins:

1. **Overlap** — the EVQO classes under the block, from the visual inventory
   inventory's `REC_EVQO_CODE` (read live from the WFS), sampled at about 2,500 points. Over 90% of the
   block reads as the block overlapping; over 60% as "most of the block"; less
   as "the eastern portion"; under 10% as "very minor", and "just around the
   edges of the block boundary" when every overlapping sample is within 50 m of
   it. A sample in two units counts toward the stricter.
2. **Visibility** — from the run's viewpoint, and from up to two inventory
   viewpoints or rec sites the reverse check found it in view from (rec sites
   and major viewpoints first; a point within 300 m of the run's own road is
   that road's view, not another). Over 15% of the block in view is "will be
   visible", any less "may be"; hidden only by timber is "may not be visible
   directly … due to screening along"; within 2° of eye level adds "relatively
   flat terrain". Bare ground in view across flat country, with no timber in
   the run, stays "may": that is what roadside trees hide best. When the
   classes are seen differently the sentence splits by class ("the area that
   overlaps the 'R' polygon is not visible …, however the area that overlaps the
   'PR' may be").
3. **Recommendations** — a WTRA where a P, R or PR part (not a sliver) is in
   view; pulling the boundary back with a windfirm screen toward a tenure road
   within 100 m (named from FTEN, "Davie Lake FSR"); "do not expand the boundary
   north or east" into a sliver of a stricter class; an internal WTRA and no
   straight/angular boundaries when a Modification block is plainly in view;
   "Based on desktop review" against Table 2 when the landform's initial X was
   measured; and "Complete VIA post layout", naming openings within 1 km.
4. **Screenshots** — "See screenshots below." when views are saved, and their
   captions.

The thresholds are judgement calls fitted to those paragraphs, not handbook
rules. They are `NARRATIVE_LIMITS`, and the panel's (i) quotes them.

The run records, per sample, whether the bare ground is clear from some station
(`anyBareEarthVisible`, from `testSightline`'s `occludedBy`): a sample hidden
with it set is screened by timber, not behind a ridge. When timber blocks a
sightline first, the march carries on over the bare ground to tell the two
apart. Runs saved before it read every hidden sample as hidden by terrain, never
as screened.

## Inventory viewpoints and their arrows

Standing at an inventory viewpoint, the road view draws that viewpoint's
arrows on the ground as a guide for looking, the faced one heavier. They are no
part of the view: every picture read from the road view's map (*Save
viewpoint*'s screenshot, the framed capture of a figure, a before-harvest
render, the report's renders) hides the layers on the guide source
(`ROAD_VIEW_GUIDE_SOURCE`, `mapCapture.ts`) for the frames it takes and puts
them back. Before, a view captured at a viewpoint printed its magenta arrows
across the foreground.

Step 2's **Add from viewpoints and rec sites** reads five DataBC WFS layers within 12 km
of the block (`viewpointInventory.ts`): VLI viewing points
(`REC_VIEWPOINT_POINT_SVW`), their landscape arrows
(`REC_VIEWING_DIRECTION_LIN`), inventory screenings (`REC_SCREENINGS_POLY`),
recreation sites (`FTEN_REC_SITE_POINTS_SVW`) and tenure road sections
(`FTEN_ROAD_SECTION_LINES_SVW`). Three facts about the data shape the code:

- The ArcGIS view of the viewpoints (MapServer layer 5) advertises queries but
  answers with no rows; the WFS has all 12,396. Every one carries an expiry
  date in the past, so expiry is shown, not filtered on. Rows typed `ERROR` are
  kept as flagged candidates (`inventoryError`), never dropped: `ERROR` is a
  code on the record, not proof the point is wrong. Near one real block 12 of
  the 13 viewpoints within 12 km were typed `ERROR`, the one its planner stood
  at for the Visuals assessment (beside a forest service road, 2.7 km off)
  among them, so dropping them hid the viewpoint a planner used. A flagged row
  is named plainly ("VLI viewpoint 7"), shows *Inventory: ERROR* with an
  explanation behind its (i), ranks after an equally good unflagged row, keeps
  its arrows (joined on `VIEWPOINT_ID` like any other) and is added in one
  click like the rest. Photo markers label it "Viewpoint 7 (inventory: ERROR)".
- The arrows are polygons, and `COMPASS_BEARING` is 0 on every row. The bearing
  runs from the arrow's viewpoint (joined on `VIEWPOINT_ID`, a median 8 m from
  the tail) to the vertex farthest from it. Read from the shape alone — the
  wider end as the head — it was backwards for 33 of 294 arrows around Bear
  Lake, so the shape is only the fallback.
- Forest service road names come upper case ("DAVIE LAKE FSR") and are title
  cased; permit road codes ("DABE 2000") are kept as written.

Viewpoints rank nearest first, raised when an arrow points within 30° of the
block and for major viewpoints and rec sites; an arrow aimed elsewhere does not
drop one, because people at a site look around. **Check which of them see the
block** sends them through the reverse run as one-point roads, bare earth at eye
height. A visibility run resets the shared worker's reverse state, so the page
keeps the viewpoint rows, with the block they were checked for, until the next
check. **Add** plans a row as views of interest for the block, without
standing there (see **Views of interest**); the finder sits under that list in
step 2.

## Ridge layers

**From the terrain** has a second reading, now the default: **Ridge layer
seen** (`ridgeLayers.ts`), the landform as a planner reads it off the view —
each layer of continuous ridge seen from the road is one landform. From each
station it sweeps rays (0.25°, 25 m bins) across the 5 km around the block,
keeping the running horizon, and joins visible bins that touch along a ray or
across to the next; a ridge hiding the ground behind it breaks the run. The
block's layer is the one most of its visible ground falls in, unioned over up
to eight stations along the drive. Flat ground (under 8%) below the block is
valley floor and stops it — across a broad valley nothing hides the foreground,
and without that the layer ran down to the highway at Bear Lake. Hidden pockets
inside are filled, so the run's own sightlines decide what of the landform is in
view.

It reports which edges are skyline, a nearer ridge in front, or valley floor,
how many stations see the block, and outlines the other layers seen from the
first one. On the redesigned CHU_26_1 from Hwy 97 it found a 548 ha landform,
layer 2 of 6 from the road, seen from 4 of 8 stations. Like the facing reading
it is a candidate, adopted only on "Use this landform".

## The workspace: plan map, road view and summary

The page is a shared `TiledWorkspace` (`visualsWorkspace.ts`): the plan map in
one column, the road view over the **Viewpoint summary** in the other. The
layout picker over the panes offers four presets — *Map · road view*, *Map ·
road view · summary* (the default), *Map only* and *Road view only* — plus the
panel list and saved layouts, each remembering its pane sizes on this device.

The plan map and the road view are **two MapLibre maps**. The scene's layers
are `VisualQualityLayers`, drawn once in each with `mode="plan"` or
`mode="eye"`: every layer that used to switch on whether the one map was in the
road view now switches on the map it is in. The corridor, its stations,
drawing, inventory points, terrain candidates, the scale bar and the basemap
probe exist only in the plan; the drawn timber, ground cover, mapped water, the
road surface and haze only in the road view. 3D terrain, `DriveCamera`, the
tree stand, the photo overlay and inset, *Save viewpoint* and *Image* use the
road view's map; the table bridge and the legend stay on the plan. The plan
keeps the union of what every station sees while the road view shows its own
station's red ground. The basemap probe still reads only while the road view is
closed, so the road view's water and road class stay as they were when it
opened.

**Until the road view opens, its pane is withheld** and the map takes its
space; the summary waits for a run. The road view's map is mounted only while it
is open and on screen, so a closed road view costs no second WebGL context, and
reopening it builds its map afresh. The stand's placed patches are kept by the
page (`ForestOverlay`'s `patches`), so a reopened road view reuses the timber it
already placed rather than placing it again. Closing it unmounts its contents
first and the map one commit later: React runs a removed tree's cleanups parent
first, and removing both at once left `MapTerrain` and `ForestOverlay` cleaning
up against a removed map, which took the page down. Both now also tolerate a
removed map (the toolkit's `releaseMapTerrain`), but keep the two-commit close:
`DriveCamera`'s exit still moves the camera. Opening the road view shows its pane
whatever the layout last hid; picking a layout without it (or unticking it)
closes the road view, since it has no life off screen. On a phone one pane
shows at a time behind a tab bar, the road view takes the screen when it opens,
and leaving its tab pauses playback.

The road view's pane has a close button that leaves the road view, as *Return to
map* does. A road view narrower than 640 px — a phone, or the pane beside the
plan — opens its bar folded to the player row, judged by its own map's width, so
a pane dragged narrow folds too; *Show options* opens the harvest phase, *Save*
and *Image*. While the map shares the screen with the road view or the summary,
its legend starts folded; opening it holds until the arrangement changes.

While the road view is open the plan map marks the viewer with the shared
`MapViewerCone`: a dot at the viewing station (the pose's ground position,
never the eye map's centre) and a wedge along the look bearing, as wide as the
road view's horizontal field of view (`horizontalFov`, from its vertical field
of view and frame). Dot and wedge are one GeoJSON source updated by a single
`setData`, rounded to about 10 m and 5° so the plan redraws a few times a
second, not every frame. A click on the plan's road line seeks the road view to
the nearest point along the road (`distanceAlongRoad`, `driveMath.ts`); at a
single spot there is nothing to seek.

The **Viewpoint summary** is the shared `MetricSummary` over
`viewpointSummaryRows.ts`. It reads, never recomputes, what the run holds for
the road view's station — or the assessment station while the road view is
closed: the viewpoint (km along, ground elevation and eye height), the block's
ground in view there or *terrain incomplete*, perspective alteration from that
station against the objective's perspective range, planimetric denudation for
the landform against the planimetric range, the objective and whether the
inventory established (EVQO) or recommended it, nearest and farthest visible
ground with their viewing zones, the VIA rating with X and the adjusted
figure, mean slope with the run's slope-class green-up height, and whether the
run is provisional. Each card keeps a short label and names its scale (or
*whole road*, *this station*) on the line under it, so every percentage says
what it was measured on; the visible distances, which the run holds only over
the whole road, say so there. Both alteration figures are withheld from a
provisional run as the results panel does, and only the **Numerical figures**
row says why. Rows open as values, with their detail on the card's tooltip.
Right-click a row (or Shift+F10) or use the gear for its settings: each row
hidden, value, or value and detail. It is a readout; every control it
describes stays in the sidebar, but for the planned-view and block switchers
under its heading (see **Views of interest**).

Two groups of cards follow the station's rows; in the gear's settings each can
be shown, and most start hidden so the stack stays short.

- **Results** (`runResultMetrics`), the step 3 Results panel's figures read
  from the run: the landform's alteration at the assessment station (*perspective
  · the run*, shown by default) and its existing + proposed parts, block ground
  seen and apparent size in view over the whole road, landform seen, the
  forested area the planimetric figure divides by, screening, and the viewing
  stations.
- **Land checks** (`landStatusChecks.ts`, run by `useLandChecks`): one card,
  shown by default, sums nine checks — treaty land, Indian reserves, private
  land (ParcelMap BC), parks and protected areas, community watersheds, legal
  OGMAs, ungulate winter range, wildlife habitat areas and recreation sites or
  trails — and each has a card of its own (hidden by default) saying how many
  hectares of which block overlap which feature, or that it lies only in the
  landform, or none. Each check is a layer of the block planner's ground
  catalogue (`packages/legal-rules/ground/instruments.json`,
  `docs/forestry-ground-instruments.md`), read through the catalogue's own
  reader (`src/lib/legal/groundLayerRead.ts`), the one *On this ground* uses:
  the layer, its fields, its filter (every instrument the layer holds) and the
  cut of each record to those fields (`keepFields`) are defined there once.
  Treaty land and reserves are the catalogue's two context layers, read whole
  and with no reach cells. Each layer is read live from DataBC's WFS by the
  blocks' and the landform's own parts (`INTERSECTS` per part, by POST, the
  geometry field named in `propertyName`), never their box, 800 ms after the
  shapes last change; the landform is left out, and given no figure, when it
  takes the shapes past 0.4°, and nothing is read when the blocks alone are
  that wide. A read keeps at most 300 features (`MAX_LAND_CHECK_FEATURES`) and
  says when there were more. Overlaps under 0.05 ha are boundary slivers and
  are not counted. A check is a screen, not a legal determination: it never
  writes a mask or changes a figure (add private land as a mask in step 3 for
  that), and a layer that fails says *Not read*, naming the layer, rather than
  *None*. The reads go through `inventoryFetch`, so *Keep inventory copies*
  answers one DataBC cannot (a form POST is kept under the URL its form would
  make as a GET).

  What changed when the checks moved onto the catalogue (24 November 2026):
  the recreation check counts only what the catalogue's recreation site
  instrument holds, active recreation sites, interpretive forests and
  trail-based recreation areas, and no longer the 1,532 recreation reserves
  (not established under FRPA s. 56, which the card's own wording names);
  parks, ungulate winter range and habitat areas read every record as before,
  since their instruments together hold the whole layer. Names in a note are
  listed in the layer's key order rather than DataBC's own. On the Tabor sample
  that day the checks found the blocks inside ungulate winter range u‑7‑022
  (conditional harvest zone, 258 ha in the two blocks) and 797 ha of 118
  private parcels in the landform; the recreation card, which had counted the
  Tabor Mtn Areas recreation reserve (185 ha of the blocks), now finds the Tabor
  Mtn. staging area recreation sites in the landform (23 ha). The parks layer,
  intersected with the landform's own ring, took about 5.7 s to answer, the
  others under 0.5 s.

## The road view's layout

The bar over the map plays: play and pause, the route position with 10 m
steps, speed, the harvest phase, **Save**, **Image**, **View options** and **Drawn timber**, reset
look, the keys behind an (i), and the way back to the map. *View options*
(`RoadViewOptions.tsx`, the shared `ToolbarPopover`) holds how the view looks,
in four groups: **Look** (where to look, a jump to a view of the block, the
lens),
**Show** (analysis points, the note screenshot look, EVQO polygons, the landform,
distance haze, as checkboxes), **Figure** (figure and label style) and
**Drawing** (display quality, tree shading, detail when stopped). Every option
is one `OptionRow`: its label and explanation on the left, its control in one
fixed-width column on the right, so the panel's rows line up; only the engine's
date and time stack under their label. *Drawn timber* (the tree button,
`DrawnTimberButton` over `DrawnTimberPanel`) holds whether timber stands, its
height and cleared width, the viewpoint clearing, clearing private land,
tree-free areas, how a stem is drawn and the viewing gap; tracing a tree-free
area keeps its drawing controls in the sidebar, where the other drawings' are. Its badge counts what is drawn over
the plain view. Satellite imagery is the road view's Layers button. What the
stand is drawn from — block colours, the drawn timber, existing forest and
regrowth — stays in step 2, first in that step while the road view is open. One status line over the map reads the
harvest phase and the share of the block's ground in view; its assumptions are
behind an (i). Loading, saving and data issues share one status line under the
bar and are absent when there is nothing to say. On a phone the bar opens to the
player row; *Show options* adds the phase and saving, and a held arrow pad walks
off the road. The roadside demo's *View opening* and *Replay approach* sit with
its cue, not on the bar. Explanations everywhere in step 2 are (i) tips rather
than paragraphs.

**Landform** (off by default) drapes the landform being assessed and, for a
ridge-layer landform, its other bands. **Distance haze** (off by default)
drapes rings around the eye faded by Koschmieder's law, `1 − exp(−3.912 d / V)`
with `V = 60 km` (`hazeRings`); MapLibre's own fog is unusable at eye level. Both
are display only. The road view's sky keeps MapLibre's fog off the ground
(`fog-ground-blend: 1`, `TerrainSupport.tsx`): MapLibre places terrain fog from
the camera's height above sea level, so from a shore or the water it began tens
of metres out and every coastal hill drew the fog colour, white behind the
unfogged trees. Mapped water is drawn over the road surface and its scar, so a
road that starts at a boat launch or a sea viewpoint does not lay a tan strip
across the lake in the foreground. See the
[planner review](forestry-visual-quality-planner-review-2026-11-10.md).

## Walking off the road, imagery and the note screenshot look

In the road view, **W A S D** (held, Shift to hurry) or the on-screen pad walk
off the road while paused, along where the camera looks: 6 m/s, 30 m/s with
Shift, at most 2 km out. The eye stands on the same fixed ground mosaic as on
the road (`renderedGroundSource`), and `DriveController.canStand` refuses a step
onto ground the mosaic does not hold rather than dropping the eye. Red ground
still shows what the nearest road station sees. That used to be a status line
in the bar; now the *Reset look* button turns amber with a warning triangle and
says it in its tooltip ("… m off the road" or "off the viewpoint"), and
clicking it or R walks back as well as resetting the look. Play, a seek, or
facing another block puts the walker back on the road too.

**Satellite imagery**, the Satellite basemap in each map's Layers button, drapes
Esri World Imagery under every layer the page draws, below the basemap's first label layer (`map-satellite-imagery.tsx`), never as
a new `styles` object, which would `setStyle` the 3D timber away. Its source
stops at z18: rural BC has no z19 imagery, and Esri's grey "Map data not yet
available" tile otherwise filled the ground under the eye-level camera.

**Note screenshot look** recreates the Google Earth screenshots planners paste
under the paragraph: imagery on, proposed blocks solid white, no drawn timber or
analysis dots. Saved views and downloaded images are captioned the way notes
caption them — "View from Hwy 97 going north", or "looking west toward
CHU_26_1" when the view turns more than 45° off the road — and Step 5 lists the
captions to copy. Saving a view no longer waits for the 3D stand when no timber
is drawn.

## Visual measures for the Site Plan and Logging Plan

Practitioners write the visual measures into the site plan and the logging
plan, so the crew knows how the objective is to be achieved and when to stop
if it will not be. Under the Visuals paragraph, step 5's *Planning note ·
Visuals* drafts that list (`visualMeasures.ts`), each measure with what it was
written from:

1. **Objective** — the landform's EVQO and Table 2 range, the viewpoint, VAC,
   and the run's X with the adjusted figure when step 4 has one. Over the range
   reads "do not start harvesting until the block is redesigned and
   reassessed"; in the top fifth of it (`percentStanding`), "little room for
   change in the field". A stale run's figures are left out.
2. **Wildlife tree patches** — every *Wildlife tree patch / retention* mask in
   or within 500 m of the block, by name, area and place (inside, on the block
   boundary, beside it; read from its outline's vertices). Six are named; any
   more are summed. The basis gives the patches' share of the block.
3. **Harvest system** — dispersed retention's share left standing; a partial
   cut's volume removed and residual height (whatever is recorded).
4. **Design** — only what the design relies on, from step 4's ratings as used
   (the reviewer's, else measured): feathered and irregular edges (good or
   moderate), force lines, natural character and position (good). A poor
   rating is not something the crew can hold to, so it writes nothing. The
   opening's flagged area is always stated, with "any boundary change needs the
   visuals reassessed".
5. **Skyline** — when the run's landform design review puts the block near the
   silhouette from any station. **Roads** — when step 4 rates them visible.
6. **Stop work** — always last: stop in the affected area and contact the
   visual specialist or planning forester if the patches, edges, skyline band or
   retention prescription cannot be kept, or if the boundary has to move or the
   opening would grow past its flagged area (and so could exceed the objective).

Like the paragraph it is a draft the reviewer signs: their list
(`viaReview.visualMeasures`, one measure per line, up to 4,000 characters) is
kept once written and never overwritten from the draft. The panel shows one
list: the draft until the reviewer edits, removes or adds a measure, which
copies the draft in with that change, and theirs from then on, saved with the
scene and so with the project file. A measure that still reads as drafted keeps
its basis line. *Reset to draft* clears the reviewer's list and shows the latest
draft. The last measure cannot be removed, because an empty list reads as "not
written" and would bring the draft back; a measure is one line, so line breaks
typed into one are joined. Typed bullets and numbers are taken off
(`measureItems`) because the files number the list.
`viaReview` stays out of the scene fingerprint, so editing it never stales a run.

## Pre-layout VIA: the field brief and crew checklist

Practitioners run the VIA before block layout and share it with the layout
crew, who then place strategic wildlife tree patches and leave trees where the
block is seen, run the boundary along natural features, confirm the
neighbouring openings have visually greened up, and ground-truth the
viewpoints — which saves a second trip to the field.

- **Stage.** `viaReview.layoutStage` is `pre-layout` or `post-layout`, set in
  the headline. Absent reads as **pre-layout** (`layoutStageOf`,
  `fieldChecklist.ts`): every run here is a desk run on a drawn or imported
  boundary, and post-layout claims the boundary was traversed, which only the
  reviewer can say. Scenes saved before the stage existed read as pre-layout.
  The stage is printed on the field brief and as a *VIA stage* row on the
  block note (Excel *Block* sheet and PDF header). The FS1252 PDF and the
  Markdown worksheet do not carry it yet.
- **Where.** Step 2, *Field brief and crew checklist*, last in the step: the
  handbook's 3.2 is the field visit, and the brief is what goes to the field;
  its summary row reads "Pre-layout · 3 of 6 checked · 1 flagged".
- **The brief** (`fieldBrief.ts`, one page, letter portrait): block, licence
  and permit, area, stage, landform, objective with its Table 2 range (the
  landform's, else the block's), the measured figure X — or "Not yet run",
  "Withheld: the run is provisional", "Not current: the scene changed" — and
  the rating when there is one. Then the viewpoints to ground-truth: the
  road's assessment station (or the road's start before a run; left out while
  standing at a view of interest, whose 30 m pullout is that view), the
  block's views of interest (a view's capture is the view, not a second row),
  each other saved view on this road at its position along it, and views saved
  while standing elsewhere (no position on this road), each with latitude/longitude, the
  bearing to face and *Reachable / Not reachable* tick boxes. Each printed
  latitude/longitude is a PDF link (`mapsLinkUrl`) over the coordinate as
  printed, with no border, so the page prints as before and a crew member
  reading it on a phone opens the place in a maps app: Google Maps' documented
  cross-platform search address (`api=1`, `query=lat,long`), which opens the
  installed maps app or the web map, needs no account and carries only the
  coordinate (a `geo:` address does nothing on iOS and is refused by many PDF
  readers). Then up to three of
  the saved views' screenshots (taken at *Save viewpoint*), numbered as their
  rows. *What to look for* prompts strategic WTP placement, leave trees,
  natural boundary shapes, skyline notches and edge feathering, plus a line
  for a P, R or PR objective, a foreground view, and the run's share of the
  block in view. The checklist lists the existing openings nearest the block
  with *Greened up / Not yet* boxes, ruled lines for where the boundary can
  follow natural features, and *Checked by* / *Date*. Limits are
  `FIELD_BRIEF_LIMITS` (6 viewpoints, 3 images, 8 openings); a later page is
  added only if notes overflow.
- **The checklist** (`viaReview.fieldChecklist`): per viewpoint (keys
  `station:<viewpoint id>`, `voi:<view of interest id>`, `view:<saved view
  id>`) and per opening (target id) a yes/no and a note; every viewpoint is
  answered with its own record, never in a list here: a view of interest in its
  row (*Real and reachable*, `viewFieldCheck`), the road in step 2's *Road
  viewpoint* (`RoadFieldCheck`), and this panel only counts them (a saved view
  of no planned view has no row, so it is printed but not counted); a view is
  keyed by the view so a recapture keeps it, and an answer recorded on its
  capture before (`view:<saved view id>`) still reads
  (`viewOfInterestCheck`); one boundary note. Each answer is stamped with
  *Checked by* (`CheckedByField`, in Save & export's Field brief options, where
  the brief prints it) and the local date (`updateFieldCheck`), and an entry
  with neither answer nor note is removed. Answers for viewpoints no longer
  listed are kept but not counted. Filled answers are printed in the brief's
  boxes with their stamps. Green-up here is only confirmed / not and a note;
  a numeric field-confirmed green-up belongs on the opening itself.
- Photos from the visit go in *Field records* (the panel links to it), not
  in a second upload control.
- Like the rest of `viaReview`, the stage and checklist stay out of
  `sceneFingerprint`, so recording them never stales a run. `parseViaReview`
  adds them only when present, so a review saved before them reads back
  unchanged. `fieldChecklist.ts` and `fieldBrief.ts` are DOM-free (jsPDF is
  passed in; text goes through `pdfText`) and carry the unit tests.

## Why the field workflow is shaped this way

The pre-layout brief, the crew checklist, visual measures, wildlife tree
patches, field-confirmed green-up, own-photo line-up and the before/after
readout came from reading a practitioner's account of doing VIAs for a BC
licensee ("Considering Visual Objectives at All Stages of Block Development",
Cabin Resource Management, December 2024): practice, not guidance; the legal
basis it cites is FPPR s. 1.1. Each feature answers one point in it:

| Their practice | Here |
| --- | --- |
| Consider visuals at planning, before layout | Pre-layout / post-layout stage in the headline (pre-layout by default: only the reviewer can say a boundary was walked) |
| Share a pre-layout VIA with the field crew | One-page field brief PDF (`fieldBrief.ts`) |
| Crew places strategic wildlife tree patches, leave trees, natural boundaries | Brief's "what to look for"; *Draw a wildlife tree patch* (the `retained` mask, relabelled) |
| Crew confirms adjacent blocks have greened up and ground-truths viewpoints | Crew checklist (`fieldChecklist.ts`, in `viaReview`); per-opening field-confirmed green-up (`greenUp.ts`) |
| Composite a field photo with the simulation (VNS + Photoshop, "very tedious") | Line up a photo of my own (`exifPose.ts`, `OwnFieldPhoto.tsx`) |
| Amend blocks when the basic VQC misses the EVQO, before going back out | Before/after readout of the verdict across runs (`runRevision.ts`) |
| Write the measures and a stop-work trigger into the Site Plan and Logging Plan | Visual measures (`visualMeasures.ts`) in the block note |
| Everyone should know FPPR s. 1.1's categories | Resources: the five categories and the regulation |

What each one may change follows one rule: a review record (stage, checklist,
measures, the Visuals paragraph) lives in `viaReview` and never stales the run;
an input to the figures (a complete field green-up check, a wildlife tree patch
mask) is in `AnalysisInput` and stales it; a picture-only setting (tree-free
areas, the basemap, legend switches) touches neither.

## Road view performance (November 2026 traces)

Two DevTools traces against the dev server, read in November 2026 (dev React
inflates React's share; MapLibre's is the same in production):

- **Looking around and walking (49 s):** the main thread, not the GPU, is the
  limit: 87–97% busy while walking, the GPU process 16%. Eye-map frames took
  12.7 s (p50 4.5 ms, p99 23 ms; label placement 1.4 s, tile masks 1.2 s, one
  `uniformMatrix4fv` per draw 2.4 s). React re-rendered the whole page about 20
  times a second from pose reports (7.3 s). Hover queries on the eye map's fills
  forced synchronous GPU readbacks (`readPixels` 1.6 s). DEM tiles were fetched
  twice, once for the hillshade source and once for terrain (150 requests, 57
  URLs).
- **Swapping viewpoints (4 s):** the road view's map was destroyed and rebuilt
  (WebGL context, style, fonts, 13 vector and 22 DEM tiles, shaders), the
  analysis worker restarted, the stand regrew from nothing, and the narrative's
  EVQO lookup blocked for about 250 ms twice.

Done: the map stays mounted through a swap (`roadViewHeld`); the pose's eye is
rounded to about 10 m before it reaches page state; drawn-only eye-map fills
pass `interactive={false}`; the narrative's EVQO class lookup prepares each unit
once (`preparePolygons`, equivalence pinned by `visualsNarrativeClasses.test.ts`).

Not done, in the order the traces suggest: anchor the stand's patch grid
somewhere stable so a swap reuses patches rather than regrowing them (it is
anchored on the viewpoint; placement must stay deterministic and calibrated);
memoize the sidebar and `layerData` as the road designer does
(`memoWithLatestHandlers`), and keep the drive position out of page state
during playback; hide basemap labels the forest floor covers on the eye map
(one style object passed as both styles, never `setStyle`); share or drop the
eye map's second DEM source; reuse an idle analysis worker instead of
terminating it per run. Re-profile against a production build
(`vite build && vite preview`) before ranking React costs again.

## The block note: Excel or PDF

*Save & export* → **Block note** writes it as Excel or PDF (`blockNote.ts`) from
the text its options hold. Both carry the header (block, licence, permit, opening,
area, EVQO classes under the block), the viewpoint, the landform with its percent
alteration in perspective view against its Table 2 range, the Visuals paragraph
— the reviewer's, or the draft flagged "not yet reviewed" — the screenshot of
every view in the package (Save & export → *Package*) with its caption, in the
order saved and from every place stood at,
and a plan map framed on the block and viewpoint.

A view in the package with no screenshot (one saved before screenshots were
kept, or whose screenshot is gone from this session) is not in the note at all:
no caption, no empty box and no line asking for it, in Excel or the PDF. A
caption with nothing above it would read as a picture lost in printing. The gap
is told in Save & export instead, before and after the file is written: the
*Other Considerations* row of the note's contents names those views
(`blockNoteWithoutScreenshot`), so does each one's own row (*Viewpoints in the
report*, or its view of interest), and the file's notice above the preview and
beside a finished download says the same (`missingScreenshotsNotice`, the
build's `BuiltFile.notes`).

- **Excel** follows the planner's own `*_Report.xlsx`: an *Other
  Considerations* sheet with "Visuals" in B2 and the paragraph in C2, the
  screenshots and captions below, so the row pastes into their workbook; a
  *Block* sheet with the header and figures; a *Basis* sheet with the
  measurement behind each drafted sentence and measure.
- **Visual measures** go on a sheet of their own, second, in the same layout —
  "Visual measures" in B2, one numbered measure per row from C2, "Draft from the
  assessment — not yet reviewed." under them until the list is the reviewer's —
  so *Other Considerations* keeps B2, C2 and its screenshots exactly where they
  were, and the rows paste into the site plan and logging plan. No measures, no
  sheet.
- **PDF** (letter, landscape) puts the first view large with the header and
  paragraph beside it, in the style of the report a GIS analyst produced at
  Canfor, then the other views and the plan map two to a page. The measures
  follow the paragraph in the side column when the whole list fits there;
  otherwise they open the next page, after any paragraph overflow.

The draft's closing "See screenshots below." is reworded for where the file
puts them (`paragraphForLayout`): kept in Excel, where they are below; "See the
view at left and the others on the next page" in the PDF, where the first sits
beside the paragraph; dropped when the note has no screenshot. Only that
sentence changes; the rest of the reviewer's text is theirs.

**Viewpoint pages.** Each saved view also keeps its viewpoint record: the
design alternative it was taken under (`matchingDesign`, by the blocks and
retained patches the scene shows), the harvest phase, and what produced the
simulation (position along the road, facing and tilt, eye height, lens, the
timber's source, tree shading and detail, terrain). Where a field photo was
lined up when the view was saved, the photo is captured with it
(`captureImageUrl`). The PDF then gives each viewpoint a page in the layout
consultants' VIA reports use (Forsite's Logan Lake assessment, pp. 8–11): the
field photograph above the simulation from the same eye, the settings beside
them. The workbook gets a *Viewpoints* sheet with the same settings per view.

**Before and after a redesign.** Views saved under one design are shelved, not
overwritten, when another is applied in step 3's *Design comparisons*, and come
back when that design is applied again. Two views from the same place along the
road (within 10 m), facing the same way (within 5°) and in the same harvest
phase, under different designs, get a comparison page of their own
(`designComparisonPairs`) — the planner review's item 8.

Screenshots are taken when *Save viewpoint* is pressed (`captureMapImage`,
JPEG, 1600 px on the long side), because the frame being saved is the one the
reviewer chose; they are kept for the session, and a view saved without one is
listed by caption instead. The plan map is captured at export from the plan
map (`capturePlanMap`), which is a map of its own and stays a plan whether or
not the road view is open. exceljs and jsPDF load on demand and are passed in,
so `blockNote.test.ts` writes and reads back real files.

## Figure styles and analysis sheets

BC VIA packages draw the same few things on their perspective figures — the
landform outline, the proposed blocks, existing openings not yet greened up,
private land, rock, VSU boundaries, block callouts, a legend and a percent
alteration box — each licensee and district in its own look. The page carries
those looks as **figure styles** and uses them in two places: draped on the road
view, and composed onto a saved view as an exported analysis sheet.
`docs/forestry-visual-quality-simulation-formats.md` describes the reference
formats; `/dev/forestry/block-sheets` → *VIA figure styles* shows every style's
legend beside its source values and a sample figure.

**The catalogue.** `src/lib/forestry/viaFigure/presets.ts` holds thirteen presets
(analysis sheets with a magenta, orange or purple landform; existing / proposed /
analysed panels; a board triptych; a district greyscale analysis with lines of
force; a referral montage; calculation-on-photo; forest-plan time-step ramps;
small extras; and *arrows, no outlines* (`arrows-no-outlines`, 01 and 02), which
outlines nothing and points each proposed block and existing opening out with a
label and an arrow over the painted cut). Each drawn thing is a `SheetSymbol` with a `spec` string citing
the reference document by number and the value read from it (PDF drawing
operators where the figure is vector, the median of the ink's pixels where it is
raster). Names are generic: no company or agency name, logo or title-block
artwork reaches a preset, and the analysis sheet's logo slot is the user's own.
`presets.test.ts` checks every colour parses, every legend role has a symbol,
and every printed string fits the PDF fonts.

**In the road view** (step 2, *Figure style*), `FigureStyleLayers.tsx` drapes the
roles the scene has data for through `areaSymbolPaint` / `lineSymbolPaint`, so
the live view and the exported sheet read the same symbol objects. Draped layers
sit in the terrain texture, so nearer terrain hides them exactly as it hides the
blocks. Strokes are drawn `LIVE_STROKE_SCALE` (1.6×) wider than print, because a
stroke draped at a grazing angle reads thinner than one printed flat. The choice
is `DriveState.figureStyle`: display only, never in `sceneFingerprint` or
`AnalysisInput`, like block colours. Hatched and stippled areas (rock, treated
ground) need a `fill-pattern`, which the toolkit's `MapFillLayer` does not take
yet: the road view draws their outline and fill colour, and the export hatches
them (follow-up below).

**The class pass.** *Save viewpoint* takes the screenshot as before, then a class
pass of the same camera (`captureClassPass`, `mapCapture.ts`): every style layer
hidden, the sky and its terrain fog off, and each class painted as one flat,
unblended colour over a flat terrain colour (`CLASS_PALETTE`, built by
`figureClassPass.ts`). Blocks, counting openings, private land and rock are split
at the landform's edge with polygon clipping, and stacked in the VIA precedence
(private land over block over opening over rock over landform: the run counts
no alteration under a private-land mask, so neither does the pixel figure). The pass is read
back unsmoothed at the screenshot's size and decoded (`decodeClassRaster`); an
edge pixel blended between two classes takes its neighbours' class, never a
third. This capture is the one place the page adds MapLibre layers itself: it is
a capture recipe, not a map look, and the map is put back as it was, even on
failure. The road view shows the flat colours for the frames the pass takes.

**Composing** (`src/lib/forestry/viaFigure/composeFigure.ts`, no DOM or network
access) traces each role's pixels to rings with `contours.ts`, so outlines follow
the *visible* edge of each class, including the edge a nearer ridge cuts — what
the reference figures draw, and what a line draped on the polygon's ground edge
cannot. Callouts come from the run, not the picture (`figureCallouts.ts`): a
block the station sees anchors at the screen centroid of its visible samples, a
hidden one at its footprint, with the run's own status (Visible; Possible
Glimpses under `GLIMPSE_PERCENT`; Likely Not Visible; Unknown where terrain is
missing). Boxes go above the skyline over their anchor and are moved clear of
each other (`placeClear`, `src/lib/mapSheet/callouts.ts`). The legend lists only
the roles drawn, each swatch drawn by `swatchOps` from the preset's own symbol.

**Two figures, side by side.** The calculation box prints the preset's own
pixel calculation from the class pass — gross, net of private land, or net of
rock, as the preset's rule states it (`calc.rule`, section **VIA documents**) —
and beside it PGMaps' sightline figure for the
station, which stays the assessment's number. They measure different things:
the pixel figure is what this one picture shows at this lens; the sightline
figure is the run's terrain sightlines in perspective. Neither replaces the
other, and the panel says so.

**A partial cut in the pixel figure.** A partial-cut block is painted in its
own class (`partialIn`/`partialOut`), outlined as the block it is but never
counted as Proposed: the run leaves it out of the cleared-ground ledger and adds
its Table 6 clearcut equivalent to X in step 4 (**Harvest systems** above), and
the 2001 forms keep the partial-cut table apart from the clearcut worksheet in
the same way. The calculation cell says what was left out ("Partial cut, not
cleared ground: N px of the landform, left out of Proposed Blocks") and gives
each cut's Table 6 figure, "added to X in step 4, not to this figure". Paska
Lake VP1 (four partial cuts, 10% removed, 27.5 m left) had printed 76,184 /
134,841 px = 56.5% beside a 0% sightline figure; the pass now counts no
proposed pixel there. The pixels are `FigureCounts.partialCut` and
`AlterationAreas.partialCut`, stated in the document facts and never summed by
an `AlterationRule`; a partial cut takes no `share` of a viewpoint's proposed
figure. The partial-cut colours join the decode palette only when the pass
painted one (`classPaletteEntries`, `engineClassPalette`), so a scene with no
partial cut decodes, counts and prints exactly as before.

**The pixel figure with the drawn timber in front.** The class pass is the
ground under the trees, so a block that riverside timber hides at eye level still
counts in full: marblehead-vp1-hwy31 printed 43.97% beside a picture where
nothing changes. An engine's capture adds its `screened` pass for that. PGMaps'
own renderer adds a third figure, *Pixel measure, with drawn timber*, from the
difference between two pictures of the same framing: the view's before-harvest
render (`captureFramed` from the saved pose, the report's *before* picture) and
its after picture (the figure's `frameImage`). The road view grows its stand from
seeds keyed to each cell's coordinates, so the two renders differ only where
harvest cleared the ground (on that view, 23 of 6.6 million pixels differ by more
than 32 in RGB). A pixel the class pass gives to a proposed block whose colour
changes by more than `TIMBER_CHANGE_DISTANCE` (32) is cut ground seen past the
timber; one that does not change is hidden, and takes the class of the ground in
front (landform inside the landform, other terrain outside), so the landform's
pixels stay the ground pass's and only the proposed count falls
(`timberScreenedClasses`, `src/lib/forestry/viaFigure/timberScreen.ts`, DOM-free
with its tests; `timberMeasureFor` in `FigureSheetPanel.tsx` decodes the two
JPEGs and feeds it). Existing openings are not harvested between the pictures,
so they keep the ground pass's count, and the line says "(existing openings as
on the ground)" when there are any. A cut pixel inside a block that the block's
own gap already showed before harvest does not change, which errs toward less
alteration.

A class pass with the tree stand drawn, each stem in its ground's class, was the
other way; it was not taken because `treeLayer.ts` would need a flat-colour
cutout mode for both its cards and its detailed meshes, matching the coverage
`screenCoverage.test.ts` pins, and a per-stem class lookup, where the difference
needs only two pictures the report already takes. The cost is one before render
per view: the analysis sheet takes it for its view on Preview or Download (once a
session, `timberMeasures` in `useVisualsExport.tsx`), and the VIA report takes it
for every view saved after harvest, a photographed one too, because a field
photograph is not the figure's framing. Without one (the road view closed, a view
saved before harvest, a view with no framed capture) the line reads "not
measured" with the reason, never 0. The figure prints beside the pixel and
sightline figures, never instead of either, and reaches the VIA document facts
as `DocumentViewpoint.withTimber` (an engine's screened pass fills the same
field), the calculation strip as *Pixel figure, with drawn timber*, and 26's
memo, whose visibility line adds it. Painting the blocks reads it as an engine's
screened pass: no tree in front is painted over.

**Against a consultant's pixel figure.** A Visual Nature Studio sheet counts
pixels of a forest render, PGMaps' class pass the bare ground, and three things
part them that no setting here closes (measured on the reference library,
15 November 2026). The landform's top follows the canopy on its skyline, not the
ground: at Gun Lake's West Gun Boat Launch the same traced landform covers about
174 square degrees on the sheet and 130 in the pass, and the camera fitted to
that sheet stands its skyline 34.5 m above the bare ground. The block is the net
block: the form prints G106B at 77.4 ha net of wildlife tree patches against
158.1 ha in FTEN, and until the reserves are entered as `retained` masks (step 3
*Net block footprints*) both figures count the gross footprint, about twice the
cleared ground. And timber in front and scattered single-tree retention screen
the cut: at Nile Point (doc 22) the reference counts 1.70% of Landform 1b where
the ground pass counts 11.9%, the with-timber figure 2.3% and a run with
screening on 0%. Neither the sightline nor the pixel figure is adjusted toward
the sheet; each line says what it measured.

**Framing.** The figure is not the reviewer's road-view screenshot (that stays the
block note's). At *Save viewpoint* the page reads, from the drive's exact pose
over the DEM, the bearings and elevation angles of the landform ground the eye
sees (`landformAngularExtent`, `figureFraming.ts`), and plans the capture as the
reference sheets crop it (`planFraming`, ported from the prototype's
`framing.ts`): the landform mid-frame, about a fifth of the height sky above the
skyline, at most about 12% ground below its base, small side margins, never
stretched. The lens is a field photo's own when the view is lined up on one,
else the lens the view was saved with (*View options → Lens*, or a planned
view's own; see **Views of interest**), else a 50 mm full-frame equivalent
(39.6° across). A planned view framed *One frame along the facing* takes one
frame of its lens instead (`planSingleFrame`); otherwise a landform wider than
one frame takes up to four frames of the lens side by side across its bearings (the
consultants' renders are 60–141° panoramas), and a long, low landform makes a
strip up to 4:1. `captureFramed` (`mapCapture.ts`) stands the eye map at the pose
on each frame (`calculateCameraOptionsFromTo` to a target 40 m ahead, pitch
through `horizonSafePitch`, roll 0), sets a vertical field of at least
`CAPTURE_MIN_VERTICAL_FOV_DEG` (75°), reads the
display and the class pass from the frame's centred window of the canvas, joins the
frames, and puts the camera and field back. The wide field is for the terrain, not
the framing: MapLibre picks each terrain tile's zoom by how steeply the camera
looks down on it, measured from the height between the camera and its centre
point, which an eye-level frame has at almost nothing, and it cuts harder the
narrower the field. Drawn at a 30° frame's own field, The Shores (VP4) put its
blocks 5.5 km out on one z6 terrain tile, whose mesh sagged behind a ridge 3.5 km
out: the picture showed sky there and the class pass 0 px against a 1.82%
sightline figure. Through 75° the tile is z8 and the blocks show. The terrain's
tile manager takes no level-of-detail setting (`setSourceTileLodParams` does not
reach it), and the window is the same pinhole either way, so `projectToFrames` is
unchanged. It draws at the pixel ratio that
gives each frame's window of the canvas the frame's own width
(`capturePixelRatio`: at least the map's own, at most 4×, then MapLibre's 4096 px
canvas limit), restored in `finally`, so the sheet takes drawn pixels rather than
an upscaled crop (a 515 px canvas had been blown up 2.33×, a pixel 12.6 m at
9 km). A one-frame capture from a 321 px road view at 3× took about 2 s with
its class pass; the size changes the drawing buffer only, never the camera or
the tiles loaded. Callouts and lines are placed by a
pinhole from the same eye (`projectToFrames`), which needs no map once the camera
is restored. The sheet prints the lens, field and bearings. Even at 75° the far
ground is drawn coarse: at Argenta Beach (Marblehead VP4) everything past about
1.5 km on the line to block 3, 10 km out, was drawn from the z10 DEM (98 m cells)
while the run walks z13 (12 m). A 572 m knoll 2.6 km out was drawn at 554 m, so
the picture showed block 3 whole where the run's sightlines saw 37% of it: a 7.0%
pixel figure beside a 2.6% sightline figure. The run's own sightlines on the z10
DEM give 6.5%, and earth curvature moves neither figure. So `captureFramed` also
reads, at each frame's camera, the DEM zoom the map draws the seen blocks' ground
from (`drawnDemZooms`: the drawn terrain tile there less its `deltaZoom`, as
MapLibre picks the DEM tile behind it), and when that cell is at least
`TERRAIN_DETAIL_NOTE_RATIO` (4) times the run's the view line, the report's figure
caption and its calculation note say so in one sentence (`terrainDetailNote`).
Neither figure is adjusted to the other. A very large landform seen
as a thin, distant band (Tabor Mountain's 4,489 ha sample landform, 3–11 km out,
takes two frames across 79°) would still leave the strip mostly sky, so after the
capture the landform's rows in the class pass are kept with the view
(`landformCropRows`) and the strip is cropped to them at export by every style that crops
(all but the overlay style, which keeps its sky for the title): about a fifth of the height above its top, at most 12% below
its base, the full width kept, never stretched, and the class pass cropped by the
same rows so the pixel counts match. The lens line then says "cropped to the
landform". The sheet fits the strip into its image box at its own aspect,
centred.

**The inventory circle** (`inventoryBadge.ts`, from the prototype's `vsuBadge.ts`)
is filled from the page's live visual inventory read, which now also asks for
`REC_EVC_FINAL_VALUE_CODE` and `VSU_NUMBER`: the unit under the blocks' visible
ground at the view's station (dominant by visible samples), else the unit the
landform was adopted from, else the unit holding most of the landform. The rule
that chose it is printed small under the circle. With no unit under the landform or
the blocks, the cell holds one line saying so, not a circle of placeholder
labels; the VSU / VSC / VAC / EVC / VQO key is printed only with a circle.

**Label styles** (`LABEL_STYLES`, `labelOps` in `src/lib/mapSheet/callouts.ts`) are
independent of the figure style, which only supplies the default; *Label style* sits beside
*Figure style* in the road view's settings and in the export panel. *Box* is the filled
callout box (cyan, white or red by style). *Underlined label* has no box: bold dark text,
underlined, above the skyline, with a thin leader dropping straight down to the block where it
can. *Underlined label · arrow* (`underlined-arrow`, the overlay style's default) runs the
underline a little past the name's right end and turns it down there into the leader, one line
like an inverted L, ending in an arrowhead at the block; the label sits with that turn over its
block when there is room, above the skyline along its whole width, with the status line small
above the name. Its colours follow the picture as printed (`figureLuminance`: the frame's
brightness with the style's zone and block fills laid over it): the leader is split into runs
(`contrastRuns`, `src/lib/mapSheet/contrastRuns.ts`) that are near-black over light sky or ground
and white over dark forest, the arrowhead taking the last run's colour, and the name and its
underline take whichever of the two reads over the area behind them, with a subtle halo when that
area is busy. A change of colour needs the ground to cross a band (darker than 0.36 to turn white,
lighter than 0.5 to turn back) and stay across it for three samples 2 points apart, so tree
texture does not make the line flicker. The composer cannot read a JPEG, so the page decodes the
frame for this style only (`rgbaLuminance`) and still embeds the JPEG.
*Halo text* is text with a white (or dark) halo and a leader. *Numbered markers* puts small
numbered circles on the features and their names in a key in the legend cell, for crowded views.
In the boxless styles existing openings the station sees are labelled too, in small white text
with a thin white leader and arrowhead. Every label is sized from its measured text as it prints
(the PDF folds "—" to " - ", so the text is folded before it is measured or drawn), with padding
all round; a line wider than 28% of the image wraps at words (at most two title lines and one
body line), then shrinks one step, and only then is cut with "...". The placement then keeps
every label clear of the others and inside the image, or the sheet's image band when the strip
is cropped to the landform, with the leader leaving the edge nearest its anchor.

**Camera information on the image.** Any style can print, at the image's bottom left in white
text with a dark halo, the six lines a licensee's perspective view render prints and the
handbook's Appendix 7 recommends for a simulation: "Composite of *n* simulated *mm* mm camera
images: FOV *deg* degrees", "Observer height: *h* metres above ground" (or "lake level" when the
eye stands on mapped water), "Observer position (UTM zone *z*): *x*, *y*, *z* metres" (WGS84 UTM
through proj4, `cameraInfo.ts`), "Viewline azimuth: *deg* degrees", "Maximum tree height: *m*
metres" (the tallest VRI stand drawn, or "trees not modelled" when the road view drew none), and
"Date of rendering". *Camera info on image* turns it on; the overlay style has it on by default.
A view's own camera keeps the six lines: its lens as entered follows the lens line ("(entered as
50 mm lens x 1.6 crop)"), the position is printed in the zone the place was typed in, a view's
height above the ground is the observer height, and a surveyed eye more than 3 m from the terrain
model's eye adds the model's eye and the gap to the position line.

**Painted block ground.** The reference simulations do not only outline a proposed block: its
visible ground is rendered as harvested ground (03: pinkish-tan slash lumps; 22: sandy cut; 23:
pink-grey cut and grey-green regrowth in the NonV.E.G. openings; 05/06/07: grey or tan cut on the
photo). *Paint blocks* (beside *Camera info on image*) does the same on the exported figure:
`paintBlockGround` (`composeFigure.ts`) paints every pixel the class pass gives to a proposed block,
inside or outside the landform, and, when the style gives a regrowth colour, every counting
opening. Each pixel is the style's base colour (`paint` in `presets.ts`, sampled from its
reference, with the spec citing it) times the picture's own shading (its luminance over the
painted area's mean, so a lit face stays lighter than a shaded one) times a procedural cut
texture seeded by pixel position (the same view always paints the same), with a 1-pixel soft
edge; the outlines are drawn on top. The class pass is the ground under the trees, so for an
engine's capture a pixel is painted only where its `screened` pass also shows the block, and for
PGMaps' own picture where its with-timber pass does (when a before render was taken): a tree in
front is never painted over. Families A and B paint by default; the others, whose references
fill blocks as a flat symbol or not at all, do not. Painting changes the picture only, never a
count, and the page decodes the JPEG frame to paint it and writes it back as JPEG. A style whose
reference burns private land into its render (22: flat magenta, "artificially de-vegetated for
purposes of analysis", under the trees in front and with no outline) gives `paint.privateLand`:
with painting on, private-land pixels take that one colour with the picture's shading and no
texture, the same screened rule keeps trees in front, and the mask's symbol is not drawn over the
picture (its legend row stays). Private land comes only from the reviewer's private masks. Those
VIAs also remove the lots' trees before rendering ("Forest cover on private land not modeled"):
step 2's *Clear private land* (`ForestryScene.clearPrivateLand`, shown once the scene has private
masks) adds the private masks to the drawn clearings, so PGMaps' road view and an engine's package
draw the lots bare and the paint shows only timber standing off them. Display only, saved with the
scene, out of `sceneFingerprint` and `AnalysisInput`.

**Perspective view · overlay text** (`perspective-overlay`, family I) is modelled on the
structure of a licensee's perspective view render (no logo or name): the full framed view (the
strip is not cropped, so the title has its sky) on a tabloid page, the title drawn in the sky at
top centre, a "Visual Quality Objective Legend" panel at top left listing the objectives in view,
the established VQO polygons tinted subtly over the terrain from a second zone pass of the same
frames (`zonePassLayers`, `ZONE_PALETTE`, so a nearer ridge hides them as it hides the blocks),
proposed blocks filled yellow-tan, existing openings paler tan, underlined labels with
arrowed leaders that turn white over the forest (*Underlined label · arrow*; plain *Underlined
label* stays available), and the camera block. The EVQO polygons load whenever this style is chosen.

**Exports.** *Save & export* → **Analysis sheet** composes a saved view in any style as PDF
(`renderPdf.ts`) or PNG (`sheetPng.ts`), with a preview. Family A styles print
the tabloid analysis sheet (title block, figure, facts, visual inventory key,
calculation, legend; the facts are wrapped, then shrunk to `FACTS_MIN_SCALE`, then a list
such as the blocks not seen is cut to "and n more", and only then is a line ellipsized,
`factsOps`); the others print the analysed figure on a page of its own
with the legend inset and the calculation under it. The block note's option *Use each
view's analysis-sheet figure* puts each view's analysed figure in the block note in place of its
screenshot; `blockNote.ts` embeds PNG as well as JPEG, so the planner's Excel
and PDF layouts do not change. A view saved before the class pass existed, or
whose pass failed, still exports, without outlines or pixel figure, and says so.
The figure is drawn over the saved screenshot: save with the figure style off for
a sheet with only its traced outlines.

**Data each role reads.**

| Role | Source |
| --- | --- |
| Landform | The active landform |
| Proposed block, treated ground | The scene's blocks |
| Existing opening (NonV.E.G.) | Openings with `alterationWeight` above zero |
| Private land | Private-land masks: drawn, or ParcelMap BC parcels the reviewer adds (step 3, *Private land*) |
| Rock / non-vegetated | VRI rank-1 `BCLCS_LEVEL_1 = N`, `BCLCS_LEVEL_2 = L` round the landform, from the run's own VRI read (`nonVegetatedGround`) |
| VSU boundary | The sensitivity units the inventory lookup read |
| Sub-landform divider | Candidate: `subLandforms.ts` splits at VSU boundaries in the landform |
| Line of force | Candidate: `terrainLines.ts`, ridges and draws by D8 flow on the road view's DEM with a curvature check |

**Private land** (`parcelMapPrivateLand.ts`) is read live from the ParcelMap BC
parcel fabric (`WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW`, `OWNER_TYPE =
'Private'`) round the landform, with the box in `CQL_FILTER` longitude first and
a narrow `propertyName`, like the vegetation read. Parcels are candidates: the
plan draws the ones not yet added dashed (legend row *Private parcel found*,
`candidate:private`), and the reviewer ticks the ones to add in the panel's list
or by clicking them on the plan, where a ticked parcel is filled. A tick is only
a selection (`usePrivateParcels`, shared by the panel and the plan); *Add N
ticked as private land* makes each a `private` assessment mask, which the run
already keeps out of the alteration, so adding one stales the run. With the road
view open a plan click moves it, so the parcels take no click then. A failed
lookup is an error with a retry, never "no private land".

**Rock** is VRI non-vegetated land (rock, rubble, exposed soil, not water). It
is display and figure only: no number in the run reads it, and the pixel
calculation's net-of-rock figure is labelled as the preset's own.

**Candidates, never figures.** Sub-landform dividers and lines of force are
designer aids. They are drawn when a style defines them, cut in exports to where
the class pass shows the landform (a nearer part of the same landform can still
hide them unseen), and never adopted into the scene or fed into a number.
FWA creek barriers and the far-ridge rule
(`depthLayers`) are not ported: they need the prototype's own renderer
(per-pixel ground position and distance), which MapLibre does not give. Callouts
are drawn on the exported sheet only, not live on the road view. Lines of force are drawn without their arrowheads, live
and in exports: a draped arrow needs an arrowhead icon in `icons.ts` and an
end-only `LineMarker`.

**A calculation per landform.** 23's sheets calculate every landform a viewpoint
assesses side by side (A6, Sechelt Golf Club: Landform 1 (Full) 1.22%, Sub-landform
1a 2.78%, 1b 0.93%). A saved view does the same for the scene's other
`landscape` targets, the ones the reviewer adopted, never a divider or candidate:
`captureFramed` takes one more class pass per frame for each (`landformPasses`,
the same layers split at that landform by `classPassLayers`, at most
`MAX_LANDFORM_PASSES`), decoded and tallied as the landform's own, and the view
keeps each one it sees as `SavedFigure.landforms` (counts, objective, the blocks
with ground in it, `blocksInLandform`). The analysis sheet then prints a column
per landform with alteration in it (`calcColumns`, ordered by number, the whole
landform beside its sub-landforms as "1 (Full)"), each through the figure's rule,
and names a landform seen with none once ("Also seen, no alteration in it"); the
sightline figure stays the active landform's and says so. The sheet also outlines
every landform it calculates, as A6 and A7 outline Landform 1 and Sub-landforms 1a,
1b and 1c: each reading keeps its pass traced (`traceLandform`: the visible outline
in frame pixels and a name place deep inside it, a few hundred points rather than
the pass's code per pixel), drawn in the style's `otherLandform` symbol under the
landform's own line (dashed in the magenta and purple styles, as 23 p19 dashes its
sub-landforms; solid in the orange, as 22 p66 outlines 7a, 7b and 8 alike; not
drawn in styles without one, and no legend row) and named in the landform label
style through `labelOps` (an `inside` label). A name with no clear place nearby,
or the whole landform's beside its own sub-landforms, is left out. The report gives each a
Table 2 row and counts it, gives Table 4 a row per landform with alteration and per
sub-landform seen without (N/A, as 23 prints 1c), and closes Table 5's key
viewpoint with each landform holding proposed ground, sub-landforms first, then
"Overall Landform 1". The reviewer's terms stay the active landform's. A scene
with one landform, a view saved against another landform than the open scene's,
and an engine's figure (one class pass) print exactly as before.

**Toolkit follow-up.** An opt-in `pattern` prop on the toolkit's `MapFillLayer`
(`ahzs645/geo-toolkit`, `map/layers/fill.tsx`), fed by `keepSymbolImages`, would
let the road view hatch rock and stipple treated ground as the exports do.

## The visible face from the viewpoint

A study of BC VIA sheets (November 2026: 31 landforms on 15 sheets, back-projected
from the sheets' own vector outlines onto the ground through a camera registered
to the DEM skyline) found the consultants' landform is the **visible face of one
ridge mass, seen from the viewpoint**, and small: median 1/25 of the named VSU,
1/11 of the face reading, 1/5 of the ridge layer. Its edges, by share of outline:
shoreline 25% (water is never landform), open slope 23% (the toe above the
foreground), skyline 21%, spurs 10%, a crest with farther ground behind 7%, draws
7%, the VSU boundary only 3%. A farther ridge seen behind is a separate landform;
a hidden block is assessed against the face in front of it; nothing outside the
rendered frame is included.

*Find a landform from the terrain* therefore offers a third candidate,
**Visible face from the viewpoint** (`visibleFaceLandform`, `ridgeLayers.ts`). It
reads from one station only (the assessment viewpoint, or the chosen vantage),
across a viewing frame (`VISIBLE_FACE_DEFAULTS.hfovDeg`, 60°, the narrowest
panorama on the sheets, centred on the block). Rays keep a running horizon;
visible land joins along a ray and across neighbouring rays; a hidden run breaks a
ray; water (the basemap's polygons, or ground at `waterLevelMeters`) never joins,
so the bottom is the shoreline; ground within 300 m is foreground. The landform is
the band holding most of the block's visible ground, or, with the block hidden,
the band of the last land seen in front of it on each ray (`seededBy:
'in-front'`). Hidden pockets are filled. In the study this rule took the mean
ground IoU with the consultants' landforms from 0.24 (ridge layer) to 0.42 and the
median size from 5.4× theirs to 1.8×. `visibleFace.test.ts` holds a regression
fixture generated from one study sheet (doc 22, p027: its back-projected landform,
the block, the registered camera and a 60 m Terrarium grid; no image): IoU 0.57
against the sheet's landform, against 0.54 for the ridge layer.

Two options are **off by default**, because each helped some sheets and hurt
others in the study: *stop at the first crest* (a stretch that reappears behind a
hidden gap joins only at the same run order; it took one lakeside face from 0.23
to 0.61 IoU but cut long faces apart elsewhere), and *split at major draws* (1 km²
upstream; a planner's choice of sub-landforms, which helped one sheet and hurt
another). Like every terrain reading it is a candidate the reviewer adopts or
not.

**Visible net block.** The sheets draw only the visible, net part of a block: in
image pixels FTEN blocks covered 1.6–16× the consultants' drawn blocks. Step 4
lists each block's share of footprint seen from the assessment station beside X
(`visibleNetBlocks.ts`), as a reading, not a figure in X.

## VIA documents

A set block produces more than one figure: each reference VIA format is a page
of images, tables, a percent alteration figure read on its own scale, and
sentences. Save & export → **VIA document** fills any of them from one
assessment, so every format comes from the same block, stations, run and class
passes. The format catalogue is `src/pages/dev-forestry/viaDocument/formats.ts`;
each entry names:

- **Recipes**: the images the format needs, each a camera (lens, framing on the
  landform, a panorama or a fixed frame), a scene (harvest phase, block ground
  painted or outlined, private land cleared or standing, trees) and a figure
  style with its passes. Every field maps to an existing setting; the 2001
  analysed-photo and Appendix 1 formats need *existing*, *proposed* and
  *analysed* panels from one camera.
- **Tables**: the columns each format prints (the consultants' initial and
  detailed assessment tables, the 2001 form's viewpoint table, Appendix 1's
  attribute table, the district summary).
- **The arithmetic** (`src/lib/forestry/viaFigure/alteration.ts`): what is added
  (proposed, existing not greened up, other planned), what leaves the landform
  (private land, rock), decimals and rounding, a total built from rounded parts
  (23), parts over the gross landform (22). The figure styles' calculation
  boxes print from the same rule (`CalcBlockStyle.rule`), never from the wording
  of a line. Before this, the net-of-private style printed the gross figure under
  a `(LF - PL)` formula (0.51% where its own areas give 1.14%), and the photo
  styles dropped their `Alteration= x% (class)` line because nothing filled
  `{class}`. The box is resolved once (`resolveCalc`, `composeFigure.ts`): the
  rule, the words for its denominator, the filled rows and the total feed the
  box, each column of a multi-landform box and the pixel figure alike. A style
  names its denominator per rule (`calc.denominatorNames`, keyed by what the
  rule removes); the orange style's formula line prints `LF`, `(LF - PL)` or
  `(LF - PL - R)` with the rule it was handed (a report format's, or the
  scene's net rule, which adds rock), and its private-land and rock rows
  (`{privateDeductedPx}`, `{rockDeductedPx}`) print only when that rule takes
  the ground out.
- **Scales** (`viaDocument/scales.ts`): the handbook's Table 2 (inclusive at
  1.5/7/18/30, through `table2Class`), a district summary's strict `<` bounds,
  the consultants' size words, a referral's single ceiling, and three distance
  scales (VLI zones, a report's 1/5/12 km zones, distance as a design rating).
  A figure on a boundary reads as that document would read it.
- **Wording** (`viaDocument/wording.ts`): sentence templates over named slots,
  and the closed vocabularies (FPPR s. 1.1 visibility terms, level-of-impact
  terms, the five extent-met terms, callout terms). The structure follows the
  reference documents; the words are PGMaps' own except the regulation's and the
  handbook's.

`resolve.ts` fills a format from `DocumentFacts`, which `facts.ts` reads off
each saved view's figure (its class pass's areas, callouts, sightline figure,
distance, lens and inventory unit). **Nothing is invented.** A sentence or cell
that needs a judgement the run never makes (the visibility term of a seen
block, lines of force, edges, position, the extent met) takes it from step 4,
and only for the view standing at the assessment station; otherwise it is left
out and listed under *Reviewer to complete*. A block nothing of which is seen
is the one case where the run supplies the terms ("not visible", "not easily
distinguishable"). The pixel figure is printed on the format's arithmetic beside
the run's sightline figure, which stays the assessment's. A view of the package
without a class pass has no figure: the document is filled without it and lists
it under *Reviewer to complete* as needing a capture with its class pass
(`withViewsToComplete`), never refused for it.

`checkPrintedAlteration` is the start of the checker the report survey asked
for: given a document's own areas and printed figure it reproduces the figure,
or names the arithmetic that does (truncated, rounded twice, a sum of rounded
parts, another denominator, existing openings left out), or says none does. The
tests pin it to the reference documents' printed numbers: 22's Captain Island
truncates 0.326 to 0.32, 07's VP1 prints 1.845 as 1.9 by rounding twice, 09
prints a net VLU but divides by the gross, and 23's Piper Point (1.94% printed,
1.80% from its areas) matches no single change.

What a format cannot fill is listed in its `gaps` and printed under _Not filled
by PGMaps_: viewpoint significance and duration, sub-landform boxes, cm²
measured on a photo-montage, and the reviewer's design judgements.

## VIA reports

Save & export → **VIA report** writes a whole report, not only its figures, in
the structure of a reference VIA (a PDF by default, a Word file, a PDF laid
out from that Word file, printable HTML, or Markdown for review). A
report is a **recipe**: an ordered list of shared **parts**
(`src/pages/dev-forestry/viaReport/recipes.ts`, `parts.ts`) and the VIA document
format whose arithmetic, scale and wording the parts read. The recipes are JSON
in document-kit's recipe format (`viaReport/recipeJson/`, **Recipes as JSON**
below). The reports share most of their parts:

| Report (reference)                                 | Parts beyond the shared cover, viewpoints, sign-off and figures                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Fuel-management form, partial cut (01)             | Block areas and retention, current EVC arrow, criteria by eye, Table 3, the partial-cut table, the 2001 summary   |
| Design rationale with district summary (02)        | Proposal, plans, legislative frame, field observations, recommendations, the summary table on strict bounds       |
| 2001 form with analysis sheets (03)                | Inventory, the 2001 form's four sections, one calculation per viewpoint                                           |
| 2001 form with existing / proposed / analysed (05) | As 03, with project information, the report's own distance zones, recommendations, limitations                    |
| 2022 handbook with Appendix 1 (06, 07)             | Methods, calculations, conclusion, Appendix 1 and Table 7                                                         |
| Simulation against the result (21)                 | The regulation's criteria, the viewpoint comparison (established, simulated, post-harvest), findings              |
| Consultant VIA (22, 23)                            | Regulatory frame, the three elements, Table 7, the term tables, methods, Tables 1-5, block discussion, references |
| Environmental assessment visual memo, no VQO (26)  | Existing conditions from the inventory read, observer viewpoints, visibility per viewpoint, effect criteria       |

**Scales and matrices** (`viaReport/matrices.ts`) are drawn from the tables the
page already holds, never a copy: FPPR s. 1.1's criteria, the Appendix 1 bar
(0 1.5 4 7 12 18 24 30+) with X and the adjusted figure marked, the P-MM arrow,
the partial-cut table (`PARTIAL_CUT_EQUIVALENT`) tinted by class with the cut's
nearest cell marked, Table 3 with each element's rating marked on its row,
Tables 4, 5 and 7, the term tables, viewpoint significance, distance zones, and
an environmental assessment's effect criteria. A mark comes from the run (X,
the class a figure reads, the cut's cell) or from step 4; with neither, nothing
is marked and the table says so.

**The preparer is the office information's evaluator.** *Prepared by* and the
sign-offs print the evaluator's name, designation ("RPF #4521") and own
organisation (`preparerText`); *Licensee* is who the work is prepared for and
never takes the evaluator's organisation. *Use my details*, in the FS1252
office information and under the VIA report's options, copies Your details
(the first row of Save & export) into those fields where they are blank. A
designation fills the sign-off's designation line; the seal, signature and date
stay to complete. The worksheet's *Evaluator* line prints the same name.

**The objective's authority is the order or plan, never a reference.** The
office field *Objective established by (order or plan)* (`sourceDocument`, the
FS1252's source-document box) is the only value an "established by" sentence
prints, and only beside a recorded objective: with no objective the report
says the objective "is not recorded" and lists the objective (and the
authority, when it is blank too) to complete. A document the reviewer read for
context, such as an earlier assessment, goes in *Historical reference — not
the objective's authority* (`referenceDocument`), which prints only among the
references. Values typed into the source-document field before the two were
separated stay where they are until the reviewer moves them: when
*Objective established by* names only files the project carries (each
" | "-separated part the name of one of its attachments, `referenceMoveOffer`,
`referenceMove.ts`), it reads as the historical VIA's reference, as older
project archives wrote it. Opening such a project says so in step 1's receipt
and the header, and both that receipt and the field in the FS1252 office
information offer *Move to Historical reference*: one click appends the text to
*Historical reference* (a part it already holds is not repeated) and clears
*Objective established by*, as one ordinary edit (`movedReference`). Nothing
moves on open, a field naming anything other than the project's files (an order,
a plan, a file it does not carry) is never offered, and nothing else changes.

**Nothing is invented.** Office fields come from the FS1252 office information;
the reviewer's judgements from step 4 at the assessment station's view only;
anything else prints as a blank line and is listed under _To complete before
signing_ after the report's text, before the figure and sheet pages it ends
on, one line per part. Appendix 1 is filled only for the view at the
assessment station with a step 4 record; without one the form prints blank.
A block's distance in the discussion and Table 5 is its own (its nearest sample
seen, `BlockCallout.distanceKm`); without it the report says only that the
block is at least as far as the nearest block in view. Whether the land has an
established objective (26) is said only when the inventory was read
(`SavedFigure.inventoryRead`); otherwise the report says it was not read.

**The visual inventory the reports print.** The page makes one live read of
`REC_VISUAL_LANDSCAPE_INVENTORY` around the scene (`queryVisualInventory`). The
plan's and road view's EVQO drapes use it, and so do saved views and Save &
export. The analysis sheet, the VIA document and the VIA report
(`READS_INVENTORY`) read it before their file when it has not been read yet, as
`RUNS_ON_EXPORT` starts the run (the dialog's `prepare`). A preview never
retries a failed read; a download reads again first. When the read fails, the
file still writes and says the inventory was not read, never an empty
inventory. Each saved view keeps what chooses its unit (`inventoryAt`: the
blocks' visible points, the adopted unit, the landform). A view saved before
any read takes its own unit at export (`withReadInventory`) by the same rules
as its sheet's circle. A view saved after a read keeps the unit its sheet
printed. `buildReportContext` takes the read units as `inventoryUnits`: the
context lists every unit under the blocks with each block's hectares, plus any
unit a viewpoint chose (`inventoryUnitRows`). Both test their points through
`preparePolygons`, because the WFS keeps full-resolution coasts. Around
Captain Island that is 657,000 vertices in 118 units, and a `pointInPolygon`
loop took 15 s for 20,000 points against 82 ms prepared. Only one date is carried:
`UPDATE_DATE`, the day the record was last updated (`BcSensitivityUnit.updated`,
`date` on each unit's values). The layer records no inventory date as such, so
the reviewer's office `inventoryDate` takes precedence. Before 15 November 2026
every report printed "not read". The comparison harness turned on the EVQO
drape, which had its own read, while the views took their unit only from step
1's *Look up inventory*, frozen at save time.

**What the reviewer gives for the reports.** Four inputs the run never makes
are review records (`viaReview`, out of `sceneFingerprint` and `AnalysisInput`),
each entered once. A view's row (step 2, *Viewpoint record*) holds Table 3 per
view, by the view's name (`viewpointRecords`): significance on the MOF 2005
five-point scale, stored as printed ("High (5)", which `significanceScore`
reads), why it was chosen, the viewing experience and the view duration.
`documentFacts` gives them to **every** view as `ViewpointReview.importance`,
`selectionReason`, `viewingExperience` and `duration`; the step 4 judgements
stay with the assessment station's view, which `atAssessment` marks
(`atAssessmentStation` in `facts.ts`, used wherever a part asks which view is
judged). A view's row ticks it as its block's key viewpoint, or the blocks'
together (`keyViewpoints`); `documentFacts` carries it as
`DocumentFacts.keyViewpoints` and `chooseKeyViewpoints` takes it over the
run's choice when that view sees the block (for the group, two or more of
them), a block given its own view leaving the group. The discussion then says
"The reviewer chose this viewpoint for the detailed assessment", with the
reason when given; a choice it cannot take is listed to complete and the run's
stands. Step 1's *Sub-landforms* (inside **Landform and objective**,
`landformRecords`) gives a landform's parent and divider, which reach
`ctx.landforms` for Table 2 and the sub-landform sentences. The lake or
landscape management zone and the inventory date are office fields beside the
FS1252's (`lakeManagementZone`, `inventoryDate`; the FS1252 does not print
them): the district summary prints the date and names its lake row from the
zone. The 2001 header's proposed year of harvest is read from the blocks'
planned harvest years (step 3's *Design comparisons* → *Harvest scheduling
and recovery*), printed once every block has one.

**Key viewpoints and run-written sentences.** In the consultant formats each
block is discussed once, from its key viewpoint (`chooseKeyViewpoints`,
`resolve.ts`). A format chooses per block (22: the viewpoint that sees the
largest share of the block's ground, a landform showing the alteration breaking
ties) or for the group (23: the viewpoint seeing the most blocks, then a
landform showing the alteration, then the largest summed share). The reason is
written from the run (the only viewpoint, the larger share than the runner-up,
or the group); a key viewpoint whose landform reads 0% says the outline misses
the block. The detailed table holds each block there, and a block no viewpoint
sees is said so once. Blocks of another sale or permit (`proposed: false`, or a
name such as "X (TA0000, other planned)") stay in the figure but are named once
and kept out of the discussion, Table 5 and the conclusion. A format also names
what the choice is made by (`keyViewpointRule`): `visibility` (22, the share of
the block in view) or `impact` (23, "the visual impact was most significant when
viewed from this viewpoint"): the viewpoint's Table 3 significance (the
reviewer's 1-5, `significanceScore`), then the percent alteration of its
landform, then the share in view. With 23's significances that picks its
Sechelt Golf Club; without any, the choice rests on the alteration and the
report says so. 22's own choices follow no single rule (EGG16 is assessed from
its least significant viewpoint), so it keeps `visibility` (4 of its 8 blocks
as the reference; two others use viewpoints that were never modelled).
Sub-landforms take their parent from the scene, else from the name read the
references' way ("Landform 1b" is part of Landform 1); where one is divided is
the reviewer's unless recorded. A block's own figure at a viewpoint
(`blockPercentAt`) splits the proposed part of the viewpoint's figure by the
block's share of the proposed blocks' visible apparent size in the run
(`BlockAtStation.share`, from `visibleApparentSolidAngleByStation`); 23 prints
each block's size term from it and Table 5 its own percent. The run also writes what the
references write from the facts: each viewpoint's visibility of each block
(`blockVisibilitySentences`), a page per viewpoint with its attributes and what
it sees, the purpose, the inventory unit adopted, the method's guidance and its
treatment of private land and rock, each 2001-form viewpoint's answer to the
numerical question (with a line for the reviewer's reasons when a viewpoint is
over the range), and the certification tick boxes. The comparison with the
reference PDFs (kept with the research files) moved the sentence patterns our
templates miss from 46 of 141 to 24.

**Layout.** A recipe names its paper (letter, or legal for the Appendix 1
report), a cover page and a table of contents (`ReportLayout`). Every page
carries a running header and "Page n of N" (CSS page-margin boxes). Tables and
matrices wider than seven columns print on a landscape page, and each analysis
sheet fills its own 11 × 17 landscape page with the calculation fields as one
strip under it. A report with a `calculations` part composes its figures on that
page (`tabloidFigure`): a family A style is already an 11 × 17 sheet, and any
other style's analysed figure is composed as wide as the page holds it and
centred. Before, every report figure was the block note's 612 pt analysed figure,
so 06's (`analysed-photo-private-land`, 612 pt wide whatever the view) missed
the 11 × 17 test (`isSheet`) and printed at the legal page's text width, a
two-frame panorama a thin band; a

heading moves onto the page it introduces rather than staying at the foot of the
one before. The 2001 forms list their viewpoints in columns.

**The PDF** (`viaReport/pdf.ts`, `reportPdf`, the report's default format) is
drawn from the same `AssembledReport` as the HTML, with jsPDF passed in and no
DOM, by the same page rules: the recipe's paper, the cover and a contents page
that gives each section's and picture's page (linked, and bookmarked), the
running header and "Page n of N" (no number on the cover or on a full-size map
sheet), landscape pages for tables wider than seven columns, each analysis
sheet on an 11 × 17 landscape page with its calculation strip, a map at the
sheet's shape full-size on 11 × 17, the portrait end map on 11 × 17 portrait,
figure pages on letter landscape, and the to-complete list where the HTML puts
it. Tables break between rows and repeat their header row; a block the HTML
keeps whole (fields, matrices, scales, figures) moves to the next page whole,
and a heading moves with what it introduces. Scales and matrices are vectors
drawn from the block's own data (`scaleGeometry`), never a rasterised SVG.
Every string goes through `pdfText` (superscript footnote digits fold to plain
digits); tick boxes and ticks are drawn. A picture is embedded once however
often it prints (a jsPDF alias), PNGs deflated, JPEGs as they are; one that is
not a PNG or JPEG, or does not decode, prints a box saying so. The logo is the
printed logo as a PNG or JPEG (a brand's SVG rasterised, as the analysis sheet
takes it); with no logo, or one that does not decode, its box keeps its place
and draws nothing. The printable HTML is still offered for the browser's own print
(*Print / save as PDF*, with the page sizes in its CSS) and is unchanged; the
draft is HTML only.

**The Word file** (`viaReport/word.ts`, built through the recipe engine by
`recipeRoute.ts`, below) is the same `AssembledReport` written through
document-kit (`docs/document-kit.md`), by the
PDF's page rules read from the PDF's own helpers (`bodyParts`, `completeAt`,
`pageSpec`, `runningHeader`, with `isWide`, `isSheet`, `imageLabel`,
`scaleGeometry` and `untitled`): each page kind is a Word section, so the
paper, the cover centred on its own page, the landscape pages for wide tables,
the 11 × 17 analysis sheets with their calculation strips, the full-size map
sheets, the letter-landscape figure pages, the running header and "Page n of
N" are the PDF's. The report's sections are Word headings and the contents is
Word's own, listing them and the to-complete list, with the pictures listed
under it by name; Word fills its page numbers when it updates the file's
fields. A value nobody gave prints as a rule to fill by hand, an unfilled
sentence is left out, and the to-complete list and the report's last line (when
it has one) close the text before the figure pages, as in the PDF. A reviewer's hand edit
prints in its place with the reviewer as its source, and the last line counts
it, as the PDF says it. The text is Arial; the file is dated the day it was
written, so the same report writes the same bytes that day.

What Word cannot draw takes the nearest honest form rather than being left out.
A scale is a table: its bands across their own share of the axis
(`scaleGeometry`'s positions), its ticks centred on their places, and the
reading as ▼ in a column of its own with its label beside it; on the guide a
red column through the class bars is the reading's line, and the form's
arrowhead is ►. A matrix's marked cell is shaded, ruled in red and ticked; the
alteration guide's grid keeps its class colours, letters and white rules between
classes, its row axis named in the corner (Word sets no text upright), and its X
in the cell nearest the reading, the reading's place between cells stated under
the grid. Tick boxes and the marked cell's tick are small pictures drawn by
`word.ts` (`encodePng`), because the open fonts carry no ballot box or check. A
map's legend is coloured swatches in a line with its scale and "North up"
under the picture. Block marks are named under their picture ("Blocks in this
view, left to right…") rather than ringed in it, a panorama prints its picture
whole rather than its band, and an inset label prints over its picture rather
than in its corner. A picture that is not a PNG or JPEG prints the PDF's box
saying so.

**Recipes as JSON.** Each shipped report is a recipe in document-kit's format
(`vendor/document-kit/docs/recipe.md`) under `viaReport/recipeJson/`. The base,
`via-report.json`, says what every report shares: the Word theme, each page
kind as a section (portrait, landscape, cover, 11 × 17 sheet, full-size map
sheet, portrait end map, figure page) with its running header and "Page n of
N" where it carries them, and the furniture as the app's own JSON components
(`recipeJson/components/via-*.json`): the title block or the cover's head with
the logo, the contents, and the closing to-complete box and last line (printed
only when there are hand edits to count). Each
report `extends` the base and adds its parts in order; 23 `extends` 22 and
replaces only the sign-off. A report's details (`sources`, `format`,
`figureStyle`, `obliquePitch`, `overviewSheetStyle`, its title and purpose) are
its `meta`; its paper, cover and contents, and the options its parts read, are
its `options`. A recipe is added or changed there, then
`npm run via-recipes:build` writes `recipeJson/recipes.generated.json`, which
is what the page reads as `REPORT_RECIPES` so the kit never loads with it; the
file is the kit's own compile of the JSON, and `recipeJson.test.ts` (and
`npm run via-recipes:check`) fails when the two differ. `recipeJson/index.json`
orders the list.

Every part is usable by the recipe engine, and a part is defined once, for every
format. A part that is layout and wording over the assessment's facts is a JSON
component (`recipeJson/components/`, marked `meta.reportPart`); a part that
computes (ratings, matrices, scales, tables built from the run, figure
placement, sentences with the reviewer's slots) stays code in `parts.ts` and its
neighbours, and reaches the engine as a code component made by one adapter over
the part registry (`recipeRoute.ts`, `viaCodeComponents`). Where several parts
were the same shape with different content, one family component holds the
shape and each part says only its content through `with`: `via-fields` (a ruled
field table whose blank rows are listed to complete under their labels) is the
cover and the 2001 forms' header, and `via-sign-off` (the preparer, the
certification as tick boxes or one statement, the lines signed by hand) is the
handbook sign-off and the consultant preparer's sign-off. *Limitations*,
*References* and *The three elements of the definition* are single JSON parts.
The certification statements are one file (`recipeJson/wording.json`) read by
the JSON parts and the code parts alike. A JSON part reads one facts object
(`reportFacts.ts`): the office information and the preparer, the block lines,
the general location, the date, how the pictures were drawn and whether the
inventory was read. Each value is plain; where its provenance depends on the
assessment (the general location, the designation) the fact is a pair of value
and source, and the component prints both, so a field keeps the source the code
part gave it. A value nobody gave is null: it prints blank and the part lists
it to complete in its own words, which the component declares (`pending`). The
blocks it renders are read back as the report's own (`kitBlocks.ts`), only for
block kinds where the mapping is exact (a heading, plain text, a plain list,
fields, a tick-box question, signature lines), so the PDF, HTML, Markdown, the
draft and the Word file draw the same blocks, and the reviewer's hand edits key
and land as before.

**The engine loads with Save & export, never with the page.** When the dialog
opens, `viaReportEngine.ts` imports document-kit's renderer, the reader
(`engineParts.ts`, with the facts object) and the JSON parts compiled ahead
(`recipeJson/parts.compiled.json`, written with the generated recipes by
`npm run via-recipes:build`), and hands them to `reportEngine.ts`; the page
renders a part, it never compiles one. From then on a report assembles
synchronously as before. Until the engine has loaded nothing assembles a report:
the dialog's counts say they wait for it, every build of a file awaits the load
first, and a JSON part asked for before it refuses (`ReportEngineNotLoaded`), so
a report is never printed without one of its parts. In a production build the
renderer (about 35 kB gzipped), the compiled parts (4 kB) and the reader are
chunks fetched when the dialog first opens; the visual-quality tool's offline
list takes them from the bundle like its other chunks. A full report assembles
in well under a millisecond either way. The conversion of each part is pinned:
`jsonParts.test.ts` builds every JSON part against the code it replaced
(`jsonParts.oracle.ts`, test support no page code imports) in every shipped
recipe and made-up assessment, blocks, sources and to-complete alike.

**The Word file is built through the recipe engine** (`recipeRoute.ts`, loaded
with the Word outputs only). The recipe is compiled, the report's recipe is
read back from the compiled recipe alone, and the report is assembled from it
exactly as the page assembles it (`assembleReportParts`: each part run once over
the assessment, the reviewer's hand edits applied after the part filled its
blocks, an edit whose place is not printed kept and listed, each part's
to-complete kept, and the document's own unfilled sentences listed once). The
engine then renders the recipe: the furniture from its JSON, a JSON part from
its component, and each code part handing over its blocks with what it left to
complete. `word.ts` places the result on the PDF's pages (`layoutReport`):
where a block goes depends on the blocks around it, which a component cannot
say, so placement stays here, as the kit's model expects. Own recipes go the
same way: one becomes a kit recipe that `extends` the shipped recipe it was
copied from, its parts reached by changes and its options laid over the shipped
ones (`ownRecipeJson`), made fresh from the stored own recipe each time; the
stored format is unchanged. A JSON part in the Word file is rendered from the
compiled recipe with the same facts and read back the same way. The direct route
(`reportDocument`, `reportDocx`) is kept as the test oracle: `recipeRoute.test.ts` builds every shipped recipe and
an own recipe over four made-up assessments (every part and every block kind
printed between them) both ways, and pins the documents deeply equal and the
Word files byte for byte; `npm run via-recipes:compare` writes the same
comparison, per recipe, assessment, part and piece of furniture, to
`recipeJson/comparison-result.json`. Since the two are equal for every recipe,
nothing offers a choice between them. The PDF, HTML and Markdown never touch
the engine.

**PDF from the Word layout** is that same Word file laid out to a PDF by the
kit (`docxToPdf`), so it paginates as the Word file does. The layout draws
Arial in Arimo, the kit's open stand-in, served by this build
(`viaReportWordFonts.ts`) and fetched only when this format or the Word file's
preview is asked for. The layout fills the contents' page numbers and centres
the cover on its page, as Word does; anything it could not draw is said in the
file's note. The PDF stays the
default: this format is for a report that must page as its Word file does.

**Maps, before pictures and overhead renders.** When a report is built, the page
captures what its figure parts need (`reportMaps.ts` plans them, DOM-free;
`reportMapCapture.ts` takes them): an overview map of the blocks, the
viewpoints and the established VQO polygons (hatched and labelled when the
inventory has been read; never read for the report) on imagery, with a legend,
scale bar and north arrow drawn by the block-sheet engine (01's VLI map, 22's
Appendix A1, 26's Figure 1); a location map per viewpoint with its view wedge
and a regional map (26); a before picture per viewpoint (a lined-up field photo,
else a before-harvest render of the view's own framing); and an overhead render
with obliques of the nearest blocks (01 p7). The obliques' map pitch is the
recipe's (`ReportRecipe.obliquePitch`, `DEFAULT_OBLIQUE_PITCH` 60°, looking down
on the blocks as 01's model confirmation does); 02 (`design-rationale`) takes 75°,
near eye level from the viewpoint's side as its reference obliques are. Either
goes through `horizonSafePitch` with roll 0 in `captureAtCamera`, which puts the
camera back in `finally`. The maps are taken on a hidden map of their own
(`REPORT_CAPTURE_MAP_SIZE`, 1600 × 1100 CSS pixels, mounted off screen only
while they are taken), never the reviewer's plan. It draws only the basemap a map
asks for: imagery, the vector map, or the vector map with hillshade for the
11 × 17 sheet; the figure draws the rest. The plan keeps its look and camera,
every report frames its maps at the same size whatever the pane's, and the maps
are taken at the same time as the road view's before pictures and renders
(`ensurePictures`). Every capture puts the road view and the harvest phase back in
`finally`, writes nothing to the scene, and runs only for the report file. Figure parts (`partsFigures.ts`) lay
them out: the overview map page, 26's figure page (title, project and date,
location and regional maps beside *Before project* and *After project*),
photo / simulation pairs, and overhead renders. A missing picture is always
listed to complete; only the draft (`ReportContext.draft`) keeps its place with a
box saying what goes there. In a file it prints nothing (see **Nothing stands in
for a missing picture**). The plain simulation carries where each
block lies in it (`ReportFigure.marks`, the callouts' anchors): 26's figure page
and a photo / simulation pair point an arrow and label at every block seen and
ring one that is only glimpsed or not seen, never an outline, so the figure marks
each block the memo's text counts in view. The names sit in one
row inside the shown picture (a panorama's band), in the blocks' left-to-right
order with a leader to each mark (`viaReport/blockMarks.ts`, over `rowPlacement`):
wrapped onto two lines, then shrunk, then cut, and only then does the least-seen
block's name give way. 06's viewpoint
pages and 21's comparison carry each viewpoint's location map as an inset. 26's
memo says which viewpoints were simulated (the run found a line of sight) and
which have none, and how much of the blocks' ground standing timber hides from
each viewpoint: the run records a sample hidden only by timber as code 3 in
`visibleByStation` (readers that know only 1 and 2 read it as hidden, as
before), which the callouts count as `screenedPercent`.
26's figure page (`ea-figure-pages`) takes location and regional maps of its own
(`planFigurePageMaps`, `ReportImages.figurePageMaps`), captured only when the
recipe prints that page; every other part keeps the maps above. Its location
map is imagery fitted tightly to the view's wedge and the blocks in it at the
side slot's shape (`FIGURE_PAGE_MAP_ASPECT`, 0.8), the wedge spanning the
saved view's whole horizontal field with a true arc just past the farthest
block in it (`figureWedge`), filled teal with a white edge
(`VIA_FIGURE_MAP.viewWedge`, catalogue `via-figure-view-wedge`), the blocks in
the block sheets' block-of-interest outline, the viewpoint a cyan star at the
apex and a small north arrow at the top right: no legend, scale bar, VQO
hatching or viewpoint name. Its regional map is the plan's vector map at
`FIGURE_REGIONAL_SCALE` (1:400,000 printed `FIGURE_PAGE_MAP_WIDTH_IN` wide;
farther out only when the project would not fit), with the project's ground
outlined and the viewpoint starred: with several viewpoints the one capture is
drawn again for each page starring only its own (`regionalForViewpoint`,
`figurePageMaps.regionalFor`), as 26's Figures 2 and 3 each star theirs. Positron draws roads near-white on
near-white, so while that map alone is captured the basemap takes a road-map
look (`figureRegionalLook`, colours in `VIA_FIGURE_MAP.regional`): motorway to
secondary highways orange from zoom 8, place and water names dark on a white
halo at a set size, towns and villages from zoom 7 and hamlets from 9; every
change is put back in `finally`. The frame is `FIGURE_REGIONAL_FRAME_WIDTH`
(600) CSS pixels wide, which puts 1:400,000 near zoom 10, the first whose
tiles carry village names, with the basemap's type and highway widths drawn
twice their size (`regionalTypeScale`) so they print at about 6 pt. The capture
reads the place names drawn across the whole canvas at that camera, and when
the nearest lies outside the frame it fits the frame to the project and that
place (`regionalWithPlace`, never past `FIGURE_REGIONAL_MAX_SCALE`, 1:500,000)
and takes it again. Where no named place is within reach (Marblehead's nearest
in the tiles, Kaslo, is about 38 km off), the map shows highways and water
only. Symbols on both maps are sized in points printed on the slot.
The overview is also taken as an 11 × 17 topographic sheet (`planOverviewSheet`,
`ReportImages.overviewSheet`): every block and viewpoint fitted at the largest
round scale that holds them (`FIT_SCALES`, true at the frame's centre latitude
printed 17 in wide), on the vector map with the plan's hillshade and the imagery
hidden, 3300 px wide (17:11, so the report prints it on its own sheet page),
with its scale stated over the scale bar. The 05, 22 and 23 recipes print it
(`overview-sheet`) full-size on a 17 × 11 in page with no margins, so the
stated scale is true on paper; without a sheet they print the overview map.
The sheet has a second style, chosen in Save & export's VIA report options
(*Overview sheet*, `OverviewSheetStyle`: `topo-landscape`, the default, or
`end-map-portrait`; a recipe's `overviewSheetStyle` sets its default): the
portrait "VIA Overview Map" a consultant prints as a 2001-form VIA's last page
(`planEndMap` in `reportMaps.ts`, drawn by `reportEndMap.ts`, both DOM-free). It
is 11 in wide and 17 in tall (`END_MAP_PIXELS`): a title block with the printed
logo (`printedLogoRaster`, never a company name), "VIA Overview Map", the
report's project line and the stated scale, a key map at 16 × the scale
(`KEY_MAP_SCALE_FACTOR`, held to the regional map's zooms and stating the scale
it is drawn at) with the sheet's ground outlined, and the map inside a neat line
fitted like the landscape sheet, with UTM ticks (NAD83, the zone of the frame's
centre, the first round interval at least 0.8 in apart, each tick solved on its
own edge because grid lines converge). Its base is plain: contours are traced
from the Terrarium tiles at capture (`endMapContours`, 20 m with 100 m index
lines at 1:40,000, `endMapContourInterval`; the tile zoom stepped out to at most
`END_MAP_MAX_DEM_TILES`), and water, parks, creeks, existing roads and the
highway (motorway, trunk and primary) are read from the plan's vector tiles,
in OpenMapTiles' schema or CARTO's (`endMapBasemapFromMap`), while the map
stands at the sheet's camera (`captureAtCamera`'s `onCamera`); nothing is
added to the map, so nothing needs putting back. Where
the tiles carry none of those layers the vector map's picture is the base and
the capture notes it. Inventory polygons with a VQO are magenta linework
labelled with their class, blocks black outlines, the scene's wildlife tree
patch / retention masks WTRA, existing openings Harvested, and viewpoints
numbered triangles labelled "VP n Name". The legend keys only what was drawn,
in the reference's order; it has no Proposed road or Timber reserve rows, because
the scene carries neither. Every symbol is `VIA_OVERVIEW_MAP` in the block
sheets' `styles.ts`, listed in the symbol catalogue's *VIA overview end map*
group. The report prints it full-size on an 11 × 17 portrait page with no
margins (`figure.sheet.portrait` in `viaReport/html.ts`).

**Appendix 1 on one page.** Each viewpoint's Appendix 1 is one `form` block
(`appendixForm` in `parts.ts`, drawn by `html.ts`): ruled sections under shaded
title bars, the office and field sections side by side as the handbook prints
them (3.1.1 beside 3.1.3, 3.2.1 beside 3.2.2, Tables 4 and 5, the rating beside
the sign-off), the scales and Table 3 across the page, so each form fills one
legal page. A table or scale whose title the section bar already prints is not
titled again. The note on what the forms hold runs on after the sign-off. Code
that reads a report's content rather than its layout opens forms with
`flatBlocks` (`model.ts`).

**Scales, matrices and forms.** The P-MM scale and the Appendix 1 bar draw as
the forms print them: an axis with ticks, class labels above, a red arrow at the
reading (`htmlScales.ts`), the P-MM arrow across the page's full width. 01's
current (non-inventory) EVC is, by its footnote, "determined by the site
photography and simulations", so its arrow is placed from the class pass's
existing openings short of green-up, along the class's Table 2 range, and listed
for the reviewer to confirm. The partial-cut table draws as the provincial
*Guide to Visual Quality Objectives* poster's partial-cut alteration guide (class
colours `CLASS_GUIDE_COLORS`, the class letter in each cell and no numbers, a
white rule where the class changes) on a portrait page, the prescription marked
with an X between cells where it falls (`point`), as 01 marks it; the nearest
cell's clearcut-equivalent still goes on line (a). `clearcutGuide` draws the
poster's clearcut alteration guide in the numerical data whenever a block is
clearcut. A recipe chooses how the partial-cut guide is lettered
(`options.partialCutGuide`): `table` (the default) reads every cell's number on
Table 2; `poster` prints the letters as the poster does, which differ in two
cells (20% removed at 25 and 30 m, 1.2% and 1.4%: PR on the poster, R on Table 2
and in the poster's own 10% row). 01 pastes the poster, so its recipe uses
`poster`; the class read on line (a) always comes from the number. The boxed
summary (`summary-boxed`, 05's last form page) titles itself by permit and
blocks ("VIA Summary - CP 1 blks X1, X2"), boxes each of the four questions with
its Yes/No and a bold one-line answer (the run writes the numerical one: "Less
than 7.0 percent alteration …"; the others are the reviewer's), then who
completed it and the signature with the certification statement. 05's recipe
uses it in place of the plain summary and the separate certification. A recipe
with `options.figurePanorama` (26) shows its before and after renders as a band
that many times as wide as tall round the landform's rows
(`ReportFigure.landformRows`, `panoramaBand`), moved only as far as it must to
keep every block the after picture marks whole with room for its label
(`markRows`; the before picture takes the after's band). A landform taller than
the band is cut rather than the panorama narrowed; only marks spread over more
rows than the aspect allows make it taller. It is drawn by the report itself (the
picture covers a box of the band's shape), so the view's framing, the pictures
and every figure stay unchanged; a field photograph keeps its own framing. The 2001 forms (`partsDistrict.ts`) carry their own header, block areas
(gross, leave, net), the criteria rating per viewpoint, the five-question
summary, certification, notes 1-4 and the design techniques sentence; the
Kamloops Region summary table (02) prints its twelve numbered rows, notes and
footer. The consultant reports (`partsConsultant.ts`) carry numbered Tables 1-5
with their footnotes, the assessment method and a peer-review sign-off.

What the 2001 forms fill since the reference comparison of November 2026:

- **Inventory.** The units the report read (`ReportContext.inventoryUnits`) print one row each, as 01's polygon
  table, 03's label rows and 02's row 1 do. 05 (`inventoryByBlock`) also splits each block across its units by
  area. The date is the reviewer's office field, else the record's last update, which is said as such.
- **The header.** The operation type is *Harvesting* when the scene has proposed blocks. The scene records no
  proposed road, so road building is listed for the reviewer.
- **01's current EVC.** Its Yes/No answer is read from the class the arrow marks, for the reviewer to confirm, and
  its two footnotes print as form wording.
- **01's viewing angle.** Each viewpoint is rated focal, oblique or peripheral from the seen block nearest the
  view's centre line (`BlockAtStation.offAxisDeg`, `VIEWING_ANGLE_SCREEN`). That rating is a stated screen, not a
  guidebook threshold.
- **01's design factors.** They are rated per viewpoint: tree retention comes from the seen blocks' records on
  Table 5's bands, and the rest from step 4 at the assessment station. The objective met on design is left
  unmarked for the reviewer.
- **The summary forms' worksheet (03, 05).** Each viewpoint's class is printed with the class all the figures
  meet, ticked from the run.
- **03's summary.** It asks the long-form questions.
- **The design notes.** When the arithmetic nets private land or rock out, they say so.
- **02's rows 9 and 12.** They refer to the attached design rationale.
- **The contents.** They list the figure pages under *Images*, without page numbers: Chrome's print engine has no
  `target-counter`.

What the consultant reports (22, 23) fill since the same comparison:

- **Summary and landscape.** They place the blocks from the basemap's named places (`collectPlacesFromMap`,
  nearest of each kind within `PLACE_REACH_KM`), say which way the blocks' ground faces and how steep it is (the
  run's samples, `groundAspect`), and which stands the run's inventory read records over the landforms
  (`standCharacter`), all through `ReportContext.setting` (`viaReport/setting.ts`). The terrain's character in words
  stays the reviewer's and is listed; a missing source is listed, never guessed.
- **The method.** It says where the viewpoints are, counting those at one place ("at three locations on a lake"),
  and cites each key viewpoint's sheet. The landform count names the sub-landforms and the viewpoints that divide
  them.
- **The discussion.** A block on a sub-landform is "in {parent} within {sub-landform}" (step 1's record, else the
  name), and a group's viewing distance is the range of the blocks' own distances when the run gives each.
- **The appendix.** The viewpoint map is A1; each viewpoint then has its lined-up field photograph when there is one,
  a *Perspective Viewpoint* page (the plain simulation, `ReportImages.after`) and its *Perspective Viewpoint
  Analysis* sheet, numbered in Table 3's order (`appendixEntries`, `appendix-sheets`, listed by `appendix-list`).
  The text cites those numbers. The photograph and plain pages print on 11 × 17 pages like the sheets, each with its
  heading on the page, as 22 prints them; 23 prints the analysis sheets alone (`plainViewSheets: false`).
- **Sign-off.** Both reports print the certification statements the 2001 forms carry, naming no association.

**The logo.** Printed sheets and reports carry the user's own PNG or JPEG,
kept in the browser's branding store (`pgmaps-branding` IndexedDB,
`saveUploadedLogo`, `LogoChooser`) for every sheet and report and never in a
scene or project file; without one, the brand selected in Branding supplies its
logo (`printedLogo`, `printedLogoRaster`). The analysis sheet's title block, the
report's title block and the road designer's block sheets all read it, and a
report is written through `brandedHtml` so a selected brand's colours and fonts
apply. With no logo the slot keeps its place and draws nothing: no file (Preview,
Download, Save as or Copy image, in any format) draws a stand-in for something
the person did not give. Only the report's *Draft*, an editing surface, marks the
empty slot as theirs.

**Nothing on the face says what made the file.** The analysis sheet, the VIA
report, the VIA document, the block note and the field brief print no credit or
disclaimer line (the style a figure was drawn in, the day it was made, "not a
field-verified simulation"). Where the file has properties they hold it: the
analysis sheet's PDF has the style and date as its subject (`figureSubject`),
the VIA report's PDF and Word file and its printable HTML (a `description` meta)
have what it is and the day it was made (`AssembledReport.about`), and the block
note's and field brief's PDFs have their generated date. The Markdown files have
no such place, so the line is gone from them. The figures the assessment needs
stay printed: the pixel figure beside the sightline figure, the renderer named
beside a pixel figure, the camera block, the to-complete list and each
simulation page's accuracy note. The report's last line now prints only when the
reviewer changed values by hand, and counts them.

**Nothing stands in for a missing picture.** A file (Preview, Download, Save as
or Copy image; PDF, Word, PDF from the Word layout, printable HTML or Markdown)
draws no box and no wording where a picture is not there: no "the simulation;
save the viewpoint in the road view", no "Figure to come", no "Key map not
captured". The report names each missing picture only in its to-complete list.
The figure parts decide this (`showsMissing`, `printedSlots` in `parts.ts`), so
every format follows, the Word file's recipe route included. A missing picture
and its own caption close up: a figure page keeps only the pictures it has and
is left out when it has neither the picture before nor the simulation; a
photograph and simulation pair keeps the one it has, its numbered caption then
naming that one ("View from VP1 before harvest."); the overview map, an overhead
render, the obliques and a simulation page are left out whole; a consultant
report's Perspective Viewpoint page is left out, and its analysis page keeps its
heading and calculation without the sheet. Figure and appendix numbers count
only what the file prints (`figurePageViewpoints`, `appendixEntries`), so the
next picture takes the number, and the text cites only those numbers ("The
simulations are Figures 2 and 3", "shown on the viewpoint map (Appendix A1)").
The end map's key map, when it could not be captured, keeps its room and draws
nothing, as the logo slot does, and its overview sheet lists it to complete
(`MapFurniture.missing`). Blanks that are there on purpose stay: a form field or
a signature line nobody has filled prints as a line to fill by hand. A picture
that is there but cannot be embedded still prints a box saying so, since it is a
fault in the picture and not something left to do. The draft keeps every
stand-in it has (below), on both its layouts.

### The report's draft, its parts and your own recipes

**Draft.** The VIA report's entry has a third view beside *What goes in* and
*Preview*: **Draft** (`ReportDraftView.tsx`, built by `useVisualsExport`'s
`buildDraft`). It lays the report out at once, from the same `composeReport`
the file is written from, and captures nothing. A picture not drawn yet is a
**stand-in** (`viaReport/draftPictures.ts`): an SVG at the picture's own size,
so the draft breaks pages where the file will, saying what goes there and how
it is drawn. Each stand-in carries its picture group in `data-draw`: `maps`
(the plan map's overview, 11 × 17 sheet, regional and location maps),
`before:<saved view id>` (one view's before picture), `renders` (overhead and
oblique renders) or `engine` (another engine's figures, simulations and before
pictures). Clicking a stand-in in the page, or **Draw** in the draft's
*Pictures* list, draws that group alone. The page's maps move for a few
seconds and are put back, as when a file is written. `engine` only queues the
background renders. Beside the page, *Made of* lists the recipe's makeup
(`viaReport/recipeMakeup.ts`): its document format with that format's
arithmetic, scales and wording, plus its figure style, paper, options, oblique
pitch and overview sheet. *Parts* lists every part in order with the references
it comes from, the number of items it leaves to complete, and whether it
printed anything; clicking one scrolls the page to its mark. The draft tints
each value by where it came from (the run, the review, the scene, a public
table) and shows blanks in yellow. The downloaded file has neither: both are
`reportHtml`'s `draft` argument only, and `userRecipes.test.ts` pins that the
file's HTML is unchanged.

**Pages or Edit.** The draft has two layouts (`ReportDraftView`'s *Layout*).
*Pages*, the one it opens on while the format is PDF, is the file's own writer
run on the draft: `reportPdf` on the draft's report, each stand-in drawn to a
PNG first (`reportDraftPages.ts`, since the PDF writer embeds no SVG), shown in
the browser's PDF viewer. Its page breaks, landscape pages and 11 × 17 sheets
are therefore the file's, which the flowing HTML never showed: the HTML's
`@page` rules apply only when a browser prints it. Clicking a part jumps to the
page it starts on (`reportPdf`'s `anchors`). *Edit* is the flowing page, with
the tints, the stand-ins to click and the values to change.

**Changing a value by hand** (`viaReport/edits.ts`, DOM-free). In *Edit*, a
click on a printed value (a field, a sentence or paragraph, a table cell, a list
item, a boxed question's answer) types over it, Enter or leaving it keeps it and
Esc leaves it; a click on a tick box ticks it, or clears it when it was ticked.
The edit is the reviewer's record, held in `viaReview.reportEdits` by the
value's key: its part's id, the heading it sits under and its label, never the
recipe, so two recipes that share a part share its edits and nothing moves when
another part is added. `assembleReportParts` applies the edits after each part
has filled its blocks (`editPartBlocks`), so the draft, the PDF, the HTML and
the Markdown all print them, as the reviewer's (`source: 'reviewer'`), and a
blank field filled by hand leaves the part's to-complete list. The report's
last line counts the values changed by hand. *Your edits* lists each with what
the report gave and *Put back*; an edit whose place the report no longer prints
(a view removed, a part taken out of the recipe) is listed as not printed now,
kept and never applied elsewhere. A tick is only ever one of the question's own
options. Scales, matrices, figures and signature lines are not edited here:
their readings come from step 4, and a signature is signed by hand. Like the
rest of `viaReview`, edits stay out of `sceneFingerprint` and never stale the
run. A part with no edit returns the very block objects it built
(`edits.test.ts`), so an unedited report is byte for byte what it was.

**Pictures are kept by group.** The report's captures are cached per group
(`pictureCache`, keyed as the old single capture was: the scene, the views and
their saves, the inventory read, the overview sheet's style, the recipe's
oblique pitch and figure-page maps). The draft, Preview and Download share the
cache, so a file captures only the groups still missing
(`captureReportImages`'s `only`). The order is unchanged: maps, then before
pictures, then renders. A group that fails no longer fails the report: it is
written without that group, which is named with its reason on the to-complete
list (`withPicturesNotDrawn`, the Word route's `notDrawn` too), and nothing is
kept for it, so the next file draws it again. Nor does a package whose views
have no analysis sheet stop the report: it is laid out and written with the
figures it has, each view it lacks named on the to-complete list
(`withViewsLeftOut`), as long as the package holds any view, even when no view
has a class pass and the report prints no figure at all.

**Why a report is quick to write again** (from a 75 s trace of one VIA report
preview, 15 November 2026: under 2 s of it was the report's own work). Every
picture is captured once, kept by group, and reused by the draft, Preview and
Download. The dialog restarts a preview only for its own output's content
(`useVisualsExport`'s `contentOf`). The block note's viewpoint lookup, the
land checks, the road view reloading, and a wait's clock or queue no longer
restart a VIA report. Before, a preview written while one of them landed was
thrown away and written again, which doubled that trace. A preview that is
outdated anyway (the content did change) stays on screen, marked, while it is
written again. The page keeps the visual inventory read for each area
(`SCENE_INVENTORY_AREAS_KEPT`), so a capture standing at a view of interest and
stepping back reads nothing again. After a capture, the file waits for the run
made where the reviewer stood, whatever output it is. The road view's frame
loops sleep when nothing moves: the camera loop (`DriveCamera.tsx`,
`DRIVE_AWAKE_MS`) wakes on a look, a prop, a key, a resize or map data, and the
stand's loop (`ForestOverlay.tsx`) looks at the eye five times a second once it
is whole. Before, a still road view asked for about 120 frames a second while an
export waited. Every slow step records a `pgmaps-export:` timing
(`exportTiming.ts`; views captured, the run, each picture group, each harvest
phase shown), which DevTools' *Timings* track shows beside a recorded trace.
What the road view still waits for before a view can be saved is one value,
`saveBlocker`: the road view opening, the forest records, a forest update
waiting, the camera, or the drawn timber's patches. Each change is a mark of
its own, and a capture that times out says which one it was. Those marks found
the stand's bug: `ForestOverlay` grew nothing when its effect ran before the
road view's eye was placed, and never ran again. A capture standing at a new
place therefore always waited out its two minutes for timber. The effect now
depends on there being an eye (`hasEye`).

**The report's contents** (`viaReport/recipeContents.ts`, DOM-free; controls in
`viaReportContentsControls.ts`). *What goes in* opens on the report's parts, in
print order, each named by its title (`partLabel`) and switched on or off. A
row says what is known of its part once the report has been assembled (how many
items it leaves to complete, that it prints nothing for this assessment) and
the page it starts on once the draft's *Pages* have been written, and nothing
before. The cover stays pinned first while the recipe's layout has a cover
page, since the PDF's cover takes every block before the first heading. No
other part needs a fixed place: the to-complete list and the report's last line
follow the parts by themselves. The last part still printing cannot be switched
off. Rows are keyed by the part's id and which time the list holds it
(`entryKeys`), since a recipe may hold a part twice.

**The presets are the recipes.** The list's preset row offers the shipped
recipes and your own, and its value is the package's one recipe choice, the
same state as *Package recipe*. The first change to a shipped recipe (a part
switched off, moved, added or removed) makes your own copy (`ownCopy`, named
"… (your copy)", numbered when that name is taken) and chooses it, in that one
step, with nothing asked (`editRecipeContents`). Later changes edit that copy.
The row then reads as modified from the recipe it was copied from
(`recipeModified`), and **Reset** goes back to that shipped recipe; the copy
stays among the presets. **Save as preset…** is a copy under the typed name,
and **Delete** removes your own recipe from this browser, asked once.

**Off keeps its place.** A part switched off stays in the list, dimmed, where it
was, and comes back there when switched on. An own recipe stores it in
`leftOut`, each part with its place in the whole list (`recipeEntries` merges
them back in by place). `parts` alone is what prints, so the report, the Word
route (`ownRecipeJson` extends the recipe it was copied from by its `parts`)
and every reader before this one are unchanged; an older PGMaps reads such a
recipe and simply loses the switched-off rows. `readOwnRecipe` checks
`leftOut` on every read like the rest: known parts, whole places inside the
list, no two at one place, and no more than `MAX_RECIPE_PARTS` counting them.
A part the recipe it was copied from holds is switched off, never removed; one
you added is removed from its row's menu. *Add a part…* offers the shared
catalogue, grouped by the reference documents each part comes from.

**The draft beside the list.** Choosing a row shows the draft at that part
(`part-<place>`, the marks the *Draft* view uses), and a click on a part's mark
in it brings its row into view. The draft is laid out from the same
`composeReport` as the *Draft* view and captures and runs nothing, so opening
*What goes in* never starts a capture or a run. With no draft yet, one line says
why (no view in the package with a class pass, the report's parts still
loading). *Draft* and *Preview* stay full width as before. The *Draft* keeps its
own *Parts* list, as its navigation between a part and its place on the page and
in the PDF, not as a second place to change the recipe.

**Your own recipes** (`viaReport/userRecipes.ts`, kept by
`userRecipeStore.ts`). The package's *Make a copy* copies the recipe in use as
yours. *Edit* changes its name, report title, document format, figure style,
paper, cover, contents, options, oblique pitch and overview sheet; its parts
and their order are the same shared contents list as *What goes in*, with the
same controls, each part added from the shared catalogue (`REPORT_PARTS`). An own
recipe is data only: it names parts by id and never copies one, so every report
keeps one version of each section. It lives in this browser's `localStorage`
for every assessment, like the printed logo, and never in a scene or a project
file. *Share as a file* writes a `pgmaps-via-recipe` JSON file, and *Import…*
reads one under a fresh id, never over an existing recipe. Every read, from the
browser or a file, is checked by `readOwnRecipe`. A part, format, figure style
or option this PGMaps lacks is refused with each problem named, never repaired.
A stored recipe that no longer reads is listed with why and a *Delete*. Its
sources follow its parts (`partSources`), and its report's properties (the PDF
and Word subject, the HTML description) say it was built from your own recipe
rather than "in the structure of" a reference.

## Figures drawn by another engine, in the background

The analysis sheet, the VIA document and the VIA report take the package's
_Figures drawn by_ (Save & export → *Package*, chosen once for all three):
**PGMaps** (each saved view's figure as it was saved, ready at once) or
**threejs-worldgen** / **Nanite Forest** at final quality. An engine's figures
are rendered in the background (`BackgroundRenders.tsx`): the export queues one
render per view in the package and waits for them, and the page stays usable
meanwhile. A tray at the bottom right shows
the engine's live picture, the view being drawn, its phase, a progress bar and
the time left for the whole queue, with *Cancel the rest*. The renders go on if
the dialog closes; finished figures are kept for the session under the view,
the engine and the scene's fingerprint, so a second export, or another output
drawn from the same views, waits for nothing. A view is drawn again from where it
was saved (`figureAt`: station, eye, the drive's pose, the lens), through the
same `captureViewFigure` as *Save viewpoint*, so its framing, class pass,
callouts and pixel figures are made exactly as an engine-drawn save makes them.
`figureAt` also keeps the scene's fixed figure frame and the landform the view
was saved with, so a view saved before the viewpoint changed is framed, split
and cropped as it was saved, in its before render as in its engine render,
never on the open scene's frame. The engine draws from the road view's terrain,
so the road view must be open with its terrain loaded; the dialog says so
otherwise.

**A before/after pair is drawn by one renderer.** When an engine draws the VIA
report's figures, each view's before picture is that engine's render too: a
second background job per view (`RenderJob.phase: 'before'`) draws the same
saved view, framed as its figure, with the scene package and the frame's stand
built before harvest (`forestFor`, which builds either phase without moving the
road view; the engines draw what the package holds and need no change). Only
the report waits for these (`rendererMissing`); the sheet and the document
print no before picture. `reportPairs.ts` chooses the pair: the engine's before
beside the engine's after; a lined-up field photograph beside either; and when
the engine has no before picture (its render failed, or the view has no pose),
PGMaps' before beside PGMaps' own after, with a note under the simulation saying
why. A report never pairs PGMaps' before with an engine's after. Each view's
engine render, the figure as the before, is drawn in the harvest phase the view
was saved in, not the road view's current one.

**The engine page** runs in that small frame rather than hidden, because a
browser stops drawing a frame it cannot see, and on a site of its own
(`separateSiteUrl`), because a same-site frame shares the page's main thread. In
development both are served on the loopback address, which the browser treats
as one site whatever the port: an engine building its stand then froze PGMaps
for 51-53 s at a time (107 s of a 114 s render, measured with a long-task
observer). Served under the other loopback name (`localhost` for `127.0.0.1`),
the engine runs in its own process and the page was blocked 6-10 s in all,
never more than 0.8 s at once, through a whole render. An engine deployed on
the same site as PGMaps would share its thread again; the function reports that
case. Once the queue is empty the engine page is unloaded, which frees its GPU
memory. Both engines now run in the tray as workers instead (**Choosing the
renderer**): their own thread, so the site question does not arise, the canvas
in the same visible box, and the worker ended when the queue empties; the
frame and its site matter only when a `VITE_FORESTRY_*_URL` names a page.

**A job never waits on a bridge nobody listens to.** The engine page's message
bridge is an effect; when it re-subscribes (a hot reload in development re-runs
it, as does the engine's address changing) a capture in flight is rejected with
`BRIDGE_RESET` and the job goes back in the queue (at most twice), instead of
sitting at *building the scene* until the 15 min capture timeout: the engine's
*ready* reached the new bridge, which had nothing waiting. That is what kept a
render queued on a page that had already built a VIA report at "0 of 1 done":
the long-open page in the shared checkout saw a reload mid-capture. A job also
waits (up to 90 s) for the road view's terrain, which reloads whenever the
scene's polygons change, rather than drawing the unframed road view, and the
export waits through that reload (`renderer.settling`) instead of failing with
*let its terrain load*; a view still missing with nothing queued is queued
again. In development `window.__visualsSavedViews` lists the saved and shelved
views (name, station, pose, harvest phase, frame, landform, whether the figure
is ready) for the reference-library harness.

**The time left** (`renderEstimate.ts`) is estimated per phase: the engine
starting (the first render of a session), the scene (PGMaps building the
package and the frame's real-density stand, the engine building it), the render
(each frame's warm-up renders, then its samples; scaled by frames, pixels and
samples) and composing the figure. Before any render here, the rates are the
profiled runs' of 15 November 2026 (one 2400 × 2769 frame, 24 samples, a
1.46 M-stem stand, Apple GPU: about 25 s a viewpoint for either engine), and the
tray says *first estimate*.
Each finished render is timed by phase and kept in this browser
(`localStorage`, the newest 12 per engine), and later estimates come from those,
weighted to the newest (*from your renders*). While an engine renders it sends
`pgmaps-capture-progress` (render steps done of the request's total, at most
four times a second; `engineCapture.ts`), and the render phase's estimate moves
toward the pace of those steps (timed from the first one, after at least two
and 5% of the total) as they go by. The engines prepare the frame's stand before
their first sample: worldgen spent about 52 s of a 55 s render phase before its
first step, then ran all 84 in 3 s, so for most of a render the estimate is the
measured model, and the steps refine its last seconds. Measured on Captain
Island (one view, three 800 px frames, 24 samples): worldgen 115 s with _about
2 min_ shown before it started; Nanite Forest 50 s with *about 1 min*. An engine that sends no
progress is timed from the model alone, and the estimate never reads less than
the time already spent in a phase says.

**Where a render's time goes** (profiled 15 November 2026, the same request):
the engines are not the slow part. Of about 25 s a viewpoint, PGMaps spends
3-7 s before it sends the scene (the capture's VRI and skyline reads, the
package); the engine builds the scene in 4-8 s; the capture then takes 10-12 s,
of which the 24 samples are about 2 s (worldgen 65 ms a sample, Nanite Forest
41 ms) and the rest is each engine's own stand: worldgen placing 1.4 M cards
(2.2 s), Nanite Forest rebuilding its stand and impostor atlas (6.8 s) and
rasterising the class layers (1.6 s). Samples past 8-16 change the picture less
than its JPEG encoding does, so fewer samples save under a second. What PGMaps
does about it: the frame's stand grows while the engine builds the scene (the
scene is sent first; the request waits for the stand, `EngineCaptureHandle`
takes a promise), the engine page stays for `ENGINE_IDLE_MS` after its last job
while the tray is shown, and in development every queue event is kept on
`window.__visualsRenderLog` (asked, start, scene, ready, request, done, reset,
error), which is how a view drawn twice is told from one drawn slowly. The
basemap's water is read until the plan's tiles have loaded even when the road
view opens first (`BasemapContextProbe`): opened straight after an import, the
road view and every package sent to an engine kept an empty water list.

**After the engines' own speed-ups** (the same day, the same request, in the
engines' PGMaps examples only): a package that arrives again keeps the scene
already built (worldgen ready in 0.3 s for 2.2 s; Nanite Forest 1.1-1.7 s for
5.5-6.6 s, most of the rest the browser unpacking the 28 MB package) and, with
the same stand, its placed final stand. worldgen adds its samples up on the GPU
and reads back once (19 ms a sample for 65-80 ms), and its first capture takes
2.5-2.7 s for 3.9-4.0 s. Nanite Forest's first capture takes 5.6-6.2 s for
8.7-10.2 s: class rasters 0.3 s for 1.7 s (1-2 ms when the layers repeat), an
impostor bake that makes its mipmaps once, a worker pool and a browser cache of
grown trees (`&treecache=0` turns it off), a cheaper shore texture and snags.
The class, zone and depth rasters were byte-identical before and after;
Nanite Forest's screened pass already moved by 9-39 of 6.6 M pixels between two
runs of the same request, before any change. Through PGMaps on a busy machine
one view then read 15-18 s for worldgen and 16-24 s for Nanite Forest (it was
27-28 s), which is what `PRIOR_RATES` now holds.

**How a package crosses to the engine** (`scenePosting.ts`): posted as it is, a
capture's package cost about a second of copying, number by number, on this
page's main thread and again in the engine's. An engine now lists what it
takes in its hello (`accepts`). To one that lists `packed-arrays`, `packScene`
sends each long numeric array as a `Float64Array` (the same doubles, NaN for
null) and hands its buffer over; the engine turns them back into the arrays it
reads, so it builds the scene the plain package builds (class, zone, screened
and depth rasters byte-identical on worldgen and on a fresh Nanite Forest
page). Packing takes 50-70 ms; scene to ready fell from 5.8 s to 4.9 s on
Nanite Forest and from 6.2 s to 5.4 s on worldgen. The same pass gives the
package a content key (everything but `createdAt`). To an engine that lists
`scene-keys`, a page that still holds that package is sent the key alone and
is ready in about 0.1 s; one that does not hold it answers
`pgmaps-engine-scene-needed` and gets the package whole. An engine that lists
neither gets the plain package, as before. With both, one view through PGMaps
read 12-17 s for worldgen and 13-15 s for Nanite Forest. Nanite Forest's
browser cache of grown trees is now off unless its URL carries `&treecache=1`
(it held about 120 MB a scene in every browser profile for about a second of
a cold page), and a page opened without it deletes what was stored. View
options → *Nanite trees* is that switch for a person: *Kept in this browser*
puts `treecache=1` on the engine's address for the road view and for
background renders (`roadRendererUrl`'s third argument), and the choice lives
in the browser's storage (`engineBrowserOptions.ts`), never in a scene: it is
about this computer's disk, not the assessment.

## Evidence for the defaults (November 2026 accuracy study)

A variant study ran the page's perspective figure against printed VIA figures:
seven cases, 87 viewpoint × landform pairs, one input changed at a time, scored by
the change in |PGMaps − printed| (case-balanced, percentage points, negative is
closer). The baseline was above the printed figure in 76 of 87 pairs, mostly
because of the landform (previous section), so a change that lowers the figure
scores as closer whether or not a VIA works that way; each change below was
adopted only where it is also how a VIA is done, or fixes a defect.

| Change | Evidence (VSU / terrain landform) | On this page |
| --- | --- | --- |
| Block footprint net of RESULTS group reserves | −1.50 / −0.67 pp, −31% at one case; reproduced that VIA's printed net block areas to 0.1 ha (13.1 / 26.9 / 17.1 / 31.2 against 13.1 / 26.9 / 17.1 / 31.3) | Step 3 *Net block footprints*: FTEN gross, FTEN planned net and net of reserves side by side; reserves added as `retained` masks by the reviewer (`resultsReserves.ts`). Dispersed retention stays in. |
| Perspective denominator net of non-vegetated ground, not non-treed | −1.97 / −1.02 pp; a 2009–2010 burn is non-treed in VRI and lifted one viewpoint from 22% to 37% under the treed rule | Default `perspectiveDenominator: 'non-vegetated-out'`; planimetric keeps the treed rule. |
| Private land out of the denominator | VIAs print (LF − PL), PL up to 35% of the landform; scored +1.13 / +1.01 pp only because the baseline is high | Option `privateLandOutOfDenominator`, off by default; ParcelMap parcels stay reviewer-added. |
| Existing openings judged greened up by eye | VIAs printed 0 existing non-VEG in four of six cases; counting none moved −1.39 / −1.64 pp | One-click *Judged visually greened up from the viewpoint photo* per opening (dated, observer required). The 20-year age rule stays the default: the handbook counts every alteration not visually greened up. |
| Screening with a clearing round the eye, withheld on collapse | Off: 20 views had no landform with VRI stands over the eye; 50 m cleared most, some needed 150 m; one view's ratio went 10.6% → 56.6% | Screening stays off by default; when on, `screeningEyeClearingMeters` (50) and the 25% withhold rule. |
| 0% clearcut openings counted | Retention-system harvests are 0 in RESULTS; one case's existing share dropped by a third | `alterationWeight` counts 0% as a whole opening. |

**Not adopted:** a z14 DEM (no effect, 0.15 pp), the printed viewpoint elevation
as ground (template lake levels bury the eye), automatic shore-to-water snapping
(no consistent direction), a shorter green-up age (closer to VIA outcomes but not
a VIA rule), and green-up by height (the procedure's own test, but stricter than
the VIAs were; worth showing beside the age rule later). **Deferred:** replacing
the diagnostics' ±0.5 m eye check with a ±100 m position check that flags
position-sensitive viewpoints (the study found 100 m moves close, enclosed views
by more than the gap studied).

## The Hwy 16 · Purden Lake sample

*Start from → Hwy 16 · Purden Lake* (`purdenLakeScenario.ts`) is the worked
case for the planner's workflow, on real records with one invented block:

- **Road:** 9.5 km of Hwy 16 along Purden Lake, about 60 km east of Prince
  George, from the Digital Road Atlas.
- **Landform:** the lake's north face, VLI polygons 337 (Retention, VAC low) and
  350 (Partial Retention) joined, 729 ha.
- **Block PL-1** (hypothetical, 59 ha): laid along the contour 2.2 km across
  the water from the highway, 68% over polygon 337's Retention and 32% over the
  PR band. It is not a recorded or proposed harvest.

What it shows, after *Load around the block*, *Check which of them see the
block* and *Run visibility* (checked 10 November 2026): seven VLI viewpoints
within 5 km, four with arrows aimed at the block; highway viewpoint 148 sees
92% of it. The run sees 96% of the block from the road at 18.6% perspective
alteration against Retention's 0–1.5%, so step 5's draft reads "block overlaps
EVQO Retention 'R' and Partial Retention 'PR' polygons … may be visible from
Hwy 16 … may not meet the requirements for EVQO R; redesign before layout",
with the WTRA and post-layout VIA sentences. From there: stand at viewpoint
148, take screenshots in the note look, try a design alternative in step 3, and
export the block note.

The Tabor Mountain sample stays the short introduction (no EVQO under its
blocks), and *Roadside demo drive* the road-view demo.

## The plan map's legend and hovers

The plan map's legend is the shared `MapLegendPanel` (`PlanMapLegend.tsx`),
collapsed on phones, with a row for each layer on the map now: blocks,
landform, existing openings and masks; the road and, after a run, the ground
classes, the assessment viewpoint and the exposure ramp; terrain candidates,
other ridge layers and landform clues; sensitivity units, VLI viewpoints,
viewing directions, rec sites and screenings; tree-free areas and, while the
Layers button has them on, the established VQO classes. **Every row is a
button** that hides what it lists (struck through while hidden): rows sharing
one layer filter its features through `withoutHiddenFeatures` (`planLayers.ts`),
which returns the same collection while nothing is hidden, so a layer only
re-uploads when a row changes. A new plan layer needs a `PlanLegendKey` and a
row, or it cannot be hidden. The basemap and reference overlays (Satellite,
Hillshade, established VQO) are not legend rows: they are chosen from the map's
Layers button (`MapLayersControl`). Layers and rows read one set of
colours, `planMapStyle.ts`; sensitivity units are drawn in their objective's
colour, the colour their sidebar rows show. Map hovers are `mapTooltipHtml`
cards. The road view keeps its own status panel and has no legend; the plan
map beside it keeps its legend.

The plan map also offers the shared table view (`useVisualQualityTable.ts`):
the scene's polygons, the viewpoints and rec sites loaded around the block
(with the checked share in view), and the run's viewing stations (with the
alteration in view from each). It is withdrawn in the road view and while
drawing, when its corner belongs to the drawing controls.

## Standing at viewpoints, block colours and EVQO polygons

What a planner does in Google Earth: load the terrain, colour the block, drape
the VQO polygons, and stand at the viewpoints.

- **Stand here** on a row of *Viewpoints and rec sites* (or a click on its dot)
  opens the road view standing there, facing the block. The road view is built
  along a road — its ground mosaic, timber and road surface — so the viewpoint
  becomes a 30 m pullout through the point, square to the line of sight
  (`pulloutThrough`, `PULLOUT_METERS`). That is a real run from there, not the
  highway's run seen from elsewhere: the share in view, red ground, timber,
  imagery and screenshot look all follow. The bar drops Play, the scrubber and
  speed at a spot; looking around and walking stay. The road it replaced is
  kept: *Back to Hwy 97* returns to it at the point nearest where you stood.
  Each place's saved views are shelved while you are elsewhere and come back
  with it, and step 5 lists the captions from every place ("View of CHU_26_1
  from Davie Lake South Rec Site."). Saved views are kept for the session;
  *Save & export* → **Saved views** keeps the current place's.
- **Block colours**: in step 2 while the road view is open, one swatch per block opens a colour picker with screenshot
  presets (white, yellow, orange, magenta, cyan, purple, black); the (×)
  resets it. It lives there, and only there, because the colour is chosen while
  composing a screenshot: in step 1 it was a tab hop away from the view it
  changes. Step 1's row keeps a marker that shows the chosen colour. The colour
  is used on the map, in the road view and in the block note's plan map, over
  the cleared ground or the screenshot look's white; each saved screenshot keeps
  the colour it was taken with. It is display only and kept out of the run's
  fingerprint.
- **EVQO polygons** in the road view's *Show* row drape the established
  objectives from the visual inventory (live WFS) over the ground at 30%,
  retention blue and partial retention brown as in the planner's layer,
  modification teal so it never reads as a yellow block (`EVQO_COLORS`).

## BC inventory lookup

Every part of the page that reads the **Visual Landscape Inventory** — *Look up
this view*, *Find a landform*, the Visuals paragraph's EVQO overlap and the road
view's EVQO drape — reads it live from DataBC's WFS
(`WHSE_FOREST_VEGETATION.REC_VISUAL_LANDSCAPE_INVENTORY`, `queryVisualInventory`
in `visualInventoryQuery.ts`), for the area asked about, at the recorded
coordinates. The box goes in `CQL_FILTER`, longitude first, and at most 3,000
polygons come back at once (reported as truncated past that). There is no stored
copy and no fallback: when DataBC cannot be reached, each place says the
inventory is unavailable and offers a retry. The one exception is the reviewer's
own choice, **Keep inventory copies**, below.

Why there is no stored copy (checked 10–11 November 2026):

- The ArcGIS layer (`MapServer/6`) stops at **10,000 of the 60,499** polygons
  (its count reports exactly 10,000; Purden Lake on Hwy 16 returns none). The
  bcdatamapper snapshot built from it missed most of BC, so falling back to it
  read a block under Retention and Partial Retention as overlapping no EVQO.
- A complete copy from the WFS at full resolution is 200–270 MB gzipped
  (about 31 million vertices, 520 per polygon; rounding to 6 decimals, about
  0.1 m, saves only 20%). bcdatamapper's Pages site has about 380 MB free.
- Simplifying does not rescue it: at 1 m the largest change in a polygon's area
  was 13%, at 2 m 21%, at 5 m 44%, on small slivers whose edges decide an EVQO
  overlap (sampled from 3,000 polygons across the layer).

Existing harvest, RESULTS forest cover and VRI are live queries too.

### Keep inventory copies

*Offline and storage → Inventory copies* (off by default) lets the page work
where DataBC cannot be reached, without bringing a snapshot back. With it on,
every read the page makes of a BC inventory goes through `inventoryFetch`
(`src/lib/offline/inventoryCopies.ts`; the rule is `keptReads.ts`, DOM-free):

- a successful read is kept in this browser with the time it was read;
- a read DataBC cannot answer (no connection, or a 5xx) is answered from the
  copy of that **same request**, the same layer and the same box (or, for the
  land checks' form POSTs by the shapes' own parts, the same shapes: the copy
  is kept under the URL the form would make as a GET). Another area has no
  copy and fails as before; a 4xx is DataBC refusing the question and is
  never papered over; a cancelled read is never answered from a copy;
- a result from a copy carries the copy's own time as its `retrievedAt`, never
  the time it was used. The run's vegetation evidence and the scene's harvest
  record also name their source "… · kept copy";
- the page says so at once (`InventoryCopyNotice`, in the shell): how many reads
  came from copies and the day the oldest was read.

What this is not: it is not the bcdatamapper snapshot or any copy PGMaps ships.
A kept copy is DataBC's own complete answer to the page's own request, from the
WFS, at full resolution, so none of the three objections above applies to it.
What it cannot be is current: an inventory changed since the copy was read is
not seen, which is why its date goes wherever the read is reported.

Off, nothing is kept and turning it off deletes every copy. The newest 400 reads
are kept (`MAX_INVENTORY_COPIES`). Copies are this browser's: never in the scene,
the project file or an export. A new reader of a BC inventory on this page takes
`inventoryFetch` in place of `fetch`, or is handed it where it takes its fetch as
an argument, and stamps its result with `readAtOf(response)`.

The road view's *Existing forest and regrowth* records (harvest, planting and
forest cover, `bcForestHistory.ts`) are read per fixed grid cell (0.1° × 0.06°,
`forestHistoryAreas` in `regrowth.ts`) within 3 km of the road or a target, never
one box around them all, at most 48 cells and four requests at a time. The
queries are unsorted: with `orderByFields`, DataBC ranked every match before
returning the first 1,000, which took 20–41 s for forest cover over a 1.5° box
(25,166 polygons) and kept records by ID rather than by nearness. A request has
20 s and is tried once more after a timeout, never after a refusal; DataBC was
seen to stall 17–20 s on a 0.1° box that otherwise answers in 0.2 s.

`Find a landform` automatically ranks up to five candidate units within 25 km of the entire road polyline, including unrated units. A selector switches to the proposed block centre when desired. Proximity does not establish visibility. `Show boundary` previews a candidate; `Use candidate` adopts it explicitly. A VSU is not automatically the viewpoint-specific assessment landform. If no candidate is appropriate, draw or import the visible hillside. A nearby polygon does not establish coverage of the proposed block.

`Look up this view` also loads existing harvest and forest-cover context and draws the units intersecting the map extent. *Find a landform* offers the units it searched as a GeoJSON download, stamped with the WFS layer and the time it was read. See the integrity contract's **Appendix 5 landform review and downloaded visual inventory** section for methods, limits and tests.

### What the inventory actually contains

Province-wide, about 5,000 sensitivity units carry an established objective and
about 6,400 a VAC rating. Locally it is thinner: of 36 units returned around
Prince George, 22 had an established objective and **none** had a VAC rating.
Unrated units remain selectable and are explicitly labelled. Missing VAC uses the planning assumption described in the integrity contract; it is not a verified site rating.

Codes map as `P`/`R`/`PR`/`M`/`MM` for the objective and `L`/`M`/`H` for VAC —
note that `M` means modification in one field and medium in the other, which is
why they are never read through the same table.

The **VLI Viewing Points** layer in this service is empty (0 features
province-wide), so official viewpoints have to be placed by hand.

## Scenes

The scene — viewpoint, polygons, settings, thresholds, and the reviewer's VIA record — is saved to
IndexedDB and exports as JSON. `localStorage` under `pgmaps.forestry-visual-quality.v1`
remains a migration and fallback copy for scenes that fit its quota.
The page opens on a worked example east of Prince George: a valley road looking
across at Tabor Mountain, with one block on the face the road sees and one just
over the height of land that it never does.

Imported shapefiles are reprojected through their `.prj` by shpjs. BC planning
data usually arrives in BC Albers; without the projection file its coordinates
land in the ocean off Africa, and the import reports the features as skipped.

## Assessment workspace tools

The existing five steps now contain a bounded, device-local assessment workspace.
The additions use the [2022 BC Visual Impact Assessment Handbook](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/visual-resource-mgmt/visual_impact_assessment_handbook.pdf)
as the workflow reference. They assist scenario comparison and evidence collection;
none establishes a completed field visit or verified VQO achievement.

- **Step 2 — field records:** record a sampled station or the current road/spot as a
  significant viewpoint and document its significance. Import a reference photo,
  simulation, topographic map or design image. JPEG EXIF supplies suggestions for
  location, date, focal length and true heading; missing values remain unknown.
  Verify the camera, link the attachment to its viewpoint, annotate the image and
  record alignment review. Proposal ground points projected over the photo are
  alignment aids, including hidden samples, not photographic alteration measurement.
  Camera elevation must use the analysis terrain's vertical reference. Crops,
  panoramas, magnetic headings and uncertain altitude need manual calibration.
  Stored images are resized to at most 1600 pixels on the longer side; keep originals.
- **Step 3 — wildlife tree patches:** *Draw a wildlife tree patch* (under
  **Simulation**) traces a polygon on the plan map and adds it as a `retained`
  mask, named "Wildlife tree patch n", through `withDrawnMask` — the same
  `parseMasks` check, and 100-mask limit, a saved scene goes through. The road
  view stays open while drawing, as for a tree-free area. Run again to test the
  crew's placement from the viewpoint. The kind is labelled *Wildlife tree patch
  / retention* everywhere it is shown; the stored value stays `retained`, so
  saved scenes load unchanged.
- **Step 3 — masks and sources:** import classified polygons, or copy an outline
  drawn with the existing map controls. Natural non-green areas leave numerator
  and denominator; private land and permanent non-forestry disturbance remain in
  the assessable land base but contribute no forestry alteration, unless
  *Private land out of the landform* is on (`privateLandOutOfDenominator`), which
  takes private land out of both denominators as a VIA's (LF − PL) does while its
  timber still screens. Retained patches
  remain green, are excluded from cleared canopy and alteration, and suppress a
  second Table 5 retention credit. Clearings, thinning and cut-surface fill in the
  drive also exclude retained/private/permanent polygons; natural non-green masks
  remove illustrative trees in both phases. Road clearance remains explicit.
  Natural exclusion takes precedence on overlap. A partial cut entirely covered by
  retained or excluded ground contributes no Table 6 equivalent.
  These classifications require reviewer evidence, not an automatic ownership
  inference. A mask intersecting the active landform but represented by fewer than
  eight shared-grid cells makes the result provisional.
- **Step 3 — alternatives:** save named designs, update or apply them, and compare
  them at the current sampled station (the assessment station outside a drive).
  An alternative supplies its proposed blocks and retained patches; the current
  scene supplies the common landform, existing openings, other masks, sources and
  settings. Applying a different design invalidates the current numerical run.
- **Step 3 — since the previous run:** after a rerun, the top of **Results**
  sets the previous run's landform figures beside this run's, per scale —
  "Modification 14.2% → Partial retention 6.1% · now within partial retention
  (≤ 7%)" — and lists what changed between the two runs' inputs (proposed
  blocks, existing openings, masks, viewpoint, settings, assessment year) and,
  when the blocks match a saved alternative, its name. The page keeps only the
  previous run's headline (`runRevision.ts`: each scale's cumulative percent,
  the class it read as, and the objective's range), never the result, so it
  needs no extra run. Every figure is one a run reported, read against its own
  scale's range the way the Results tiles read it; a provisional run's figures
  are withheld and not compared. A run on another landform, objective, VAC or
  range starts the comparison over; a rerun of the same inputs keeps it.
- **Step 3 — matrix:** select recorded viewpoints and reviewed landforms. Each
  viewpoint/landform pair is a separate job with its own denominator, worst station
  and pending reviewer judgments. Results are never pooled across landforms.
- **Step 3 — diagnostics:** sensitivity jobs compare baseline, finer sampling,
  closer stations, eye height plus/minus 0.5 m and screening on/off. An imported
  terrain source adds an AWS-terrain comparison. These are assumption comparisons,
  not confidence intervals. Click a map sample or select a target/sample/station
  to trace the same terrain/canopy test, curvature and clearance used by analysis.
  Unknown raster cells appear as profile gaps. Trace reruns the saved scene with
  currently available inventory; an inventory change can change the answer.
- **Step 3 — recovery:** enter planned harvest dates and assessment years. Future
  blocks are omitted; in their harvest year they are proposals; afterward they
  become existing openings. An optional sourced, non-decreasing height–age curve
  determines green-up against each block's area-weighted slope threshold. It is
  interpolated within its recorded ages, never extrapolated. Outside the curve,
  the explicitly stated green-up-age assumption applies. Screening retains current
  canopy assumptions: this is alteration accounting, not a future stand simulator.
  **Load Castor yield curves** reads a Castor `yields.csv` (`curveId` or castordb
  `yieldid`, `age`, `height`) or a session or project saved from
  `/dev/forestry/castor` (`castorCurves.ts`, DOM-free; Castor's readers load only
  when a file is chosen). Each curve keeps its heights as given; one whose height
  falls with age is left out and named. Each block can then grow on its own curve;
  a block without one grows on the supplied curve. The library and the
  assignments are stored in the workspace (`curveLibrary`, `blockCurves`), never
  in the scene, so they do not stale a run.
  A partial cut harvested in an earlier year stays a partial cut: its Table 6
  figure (volume removed against residual height, as recorded) keeps counting
  until the same green-up test says the regeneration in its gaps has reached
  green-up height, then it counts nothing. Its residual trees are never grown,
  because Table 6 rises with residual height: growing them would read an older
  partial cut as a larger alteration. The results table (`RecoveryTable`, rows
  from `recoverySummary.ts`) sets each year's perspective and planimetric figure
  against the objective, as each run's summary recorded it (`RunSummary.scales`,
  from `runHeadline`), adds a *Partial cuts* column for the Table 6 figure step 4
  adds to X while one is in view, and says from which year each scale is within.
- **Step 3 — green-up age sensitivity:** runs the scene at the green-up age and
  5 and 10 years either side (`greenUpJobs`), changing only
  `settings.greenUpAgeYears`; the scene's own age is untouched. It first names the
  openings, grouped by harvest year, that count at some of those ages and not
  others (`greenUpSensitiveOpenings`: read by age alone, not field-checked and
  without a supplied estimate). The age also decides which openings are cleared
  ground, so the figure need not move one way: at Tabor Mountain one 2010 opening,
  greened up at 10 and 15 years, kept its inventory canopy and screened part of
  the landform, reading 4.9% against 4.2% at 20 years; with that opening removed
  the three ages agreed at 4.7%. The table says so when it happens
  (`greenUpNotMonotonic`). These are assumption comparisons, not confidence
  intervals, and never change the 20-year default (see *Evidence for the
  defaults*).
- **Step 3 — drought risk to the standing timber:** reads the active landform's
  BEC units from DataBC's BEC map and the treed species mix under it from VRI
  rank 1, then BC's published forDRAT table (`droughtRisk.ts`, DOM-free with
  `fetch` passed in; `DroughtRiskPanel.tsx`; the table through
  `publishedLoader.ts`, checksum-checked, shared with `/dev/forestry/drought-risk`).
  forDRAT rates drought-related mortality in mature stands, so this is context
  for the green landform and the timber that screens the view: never a run input,
  a mask or a change to green-up. The soil moisture regime is a site assessment
  and always the reviewer's choice; nothing reads it from the BEC unit. forDRAT's
  units are BEC v11 and the map is DataBC's current BEC, so a matching label does
  not prove matching boundaries, and a unit absent from the table has no rating.
  Only unambiguous inventory codes are rated (`FORDRAT_SPECIES_FOR_VRI`: coastal
  Douglas-fir, black spruce, amabilis fir and balsam poplar are other species and
  stay unrated). The read is keyed to the landform's shape, and the BEC query puts
  its box in `CQL_FILTER`, longitude first. *Open … in Drought risk* links the
  same unit, regime and period.
- **Step 5 — review and export:** open a saved run, complete its judgments in step 4,
  then record/update the reviewed assessment in step 5. Opening reruns the snapshot
  and leaves the stored result intact until the reviewer records an update. Record
  newly changed numerical inputs separately. Export a native VIA evidence PDF or
  printable HTML, plus workspace JSON containing the current draft, saved designs,
  independent results, source rasters/hashes, reviewer entries and resized images.
  The checklist flags missing maps, reference/simulation pairs, design evidence,
  camera review, completed assessments and rationale. It checks presence, not
  adequacy. The historical FS1252 effectiveness-evaluation export remains separate.

Batches run sequentially in one cancellable worker, at most 12 independent jobs,
with the existing sightline limit applied to each job. A completed batch replaces
its prior result set; export important records first. Editing numerical scene
inputs or starting the ordinary analysis cancels a tool batch. The workspace holds
at most 12 design alternatives, 12 viewpoints, 12 results and 24 images (50
annotations each). Browser IndexedDB stores the workspace and large current scenes;
backup exports remain necessary before clearing site data. Field records work
without a Mapillary token; loading inventory and AWS terrain still needs a connection.

Local sources are cropped, single-band, unrotated GeoTIFFs: at most 64 MB and
1,048,576 native cells per raster, one bare-earth DEM and one canopy-height model.
Supported coordinates are EPSG:4326, 3857, 3005, NAD83 UTM 7–11 and WGS84 UTM 7–11.
Provide metre-valued heights and record the vertical reference and acquisition
information. Original pixel centres, no-data and native resolution are preserved;
no automatic resampling or vertical-datum conversion is applied. Interpolation
requires four valid neighboring cells; outside coverage remains unknown, without
fallback to another elevation source. Raster cells, metadata and original-file
SHA-256 travel in scene/workspace exports. Workspace JSON deduplicates shared
rasters into a validated `localRasterPool`; scene `localRasterRefs` are resolved
on import. Standalone scene exports keep their inline rasters. Workspaces are
limited to 100 MB on the wire. They change numerical analysis only;
MapLibre ground and illustrative trees still use the existing preview sources.
The canopy-height surface is an opaque screen, not foliage-transmission modelling.

The pure modules `assessmentMasks.ts`, `localRaster.ts`, `assessmentTools.ts`,
`sightlineProfile.ts` and `assessmentMaskGeometry.ts` contain no DOM or network access. Browser file adapters live
in `toolImports.ts`; workspace persistence in `toolsStorage.ts` and
`usePersistentScene.ts`; jobs in `useToolRunner.ts`; presentation in the tool panels
and `useAssessmentTools.tsx`; evidence exporters in `toolEvidence.ts`. All panels
stay within the sidebar's mounted step slots and its shared scroll container.

## Preliminary route viewshed

Step 2, **Visit**, includes **Preliminary terrain preview**. After drawing,
importing, or snapping the road in Step 1, enable **Road viewshed**. Scrub the
road sample to see a red terrain footprint from that location, or choose
**Open route overview** to use a raised 3D overview with the existing road camera, Play,
speed, pause, and position controls. No cutblock, VRI query, or full visibility
assessment is needed. Return to the map to add cutblocks and use **Look from
the road** / **Run visibility** for the assessment workflow.

The preview uses AWS overview terrain at 1× elevation. It excludes forest,
buildings and target-height assumptions, and does not generate or update VQO
ratings, alteration percentages, formal visited-view evidence, or saved assessed
views. Imported survey DEMs remain part of the full assessment; this preview
and the rendered road camera use the overview. Red means visible ground;
purple means incomplete terrain. The displayed percentages count sampled
terrain within the selected radius, not a cutblock or screen share.

Visibility follows the actual drawn/snapped centreline at the configured driver
eye height. The overview camera is raised 150 m and tilted downward to show the
footprint; that display height never enters the sightline calculation. The full
road-level drive keeps its existing eye-height camera. Neither calculation
uses the centre of a pitched map. During playback, 64×64 footprints update at nearby 25 m road
positions. Pausing computes 128×128 detail at the actual stopped position.
Solar skyline work is disabled here. The fixed camera mosaic covers the road
before playback and uses `renderedGroundSource`; sightlines keep the analysis
grid's pixel-centre sampling. Missing ground holds the camera and playback.

The shared feature is documented in
[`src/features/terrain-viewshed/README.md`](../src/features/terrain-viewshed/README.md).
Recent complete viewpoints and decoded terrain are bounded caches; validated
PNG tiles also persist locally for seven days. Failed/incomplete terrain is
not cached as a successful view. **Retry road terrain** bypasses these caches.

Choose **Whole stretch** to merge visibility from the selected start/end
distances, highlighted by a blue centreline. Red means ground seen from at
least one sampled viewpoint; a known visible ray wins over missing rays from
other viewpoints. If no viewpoint establishes visibility and a relevant ray
is missing, the ground remains purple. Hidden holes are preserved.

**As you move** accumulates these views as the road sample or drive reaches
each station. Moving backwards retains the union through the furthest reached
station; **Reset accumulated views** starts again at the selected start.
Road, stretch, radius and eye-height changes start a new accumulation. Both
stretch endpoints are included, with at most 32 observers and the actual
sampling interval displayed (normally up to 100 m). Views between sampled
stations are not guaranteed. The merged 128×128 grid stays fixed across the
selected footprint, avoiding flicker or loss from changing grids; complete
prefixes are reused and only newly reached stations are calculated. Large
stretches produce coarser cells/DEM zoom within the same 64-tile loading limit.

## Route card

Step 1's *Route card* reads the chosen block's Route Card Tool Assessment live from public BC layers. The reviewer enters, or measures from their own file, the rows no public layer holds. The section drafts the Other Considerations paragraphs, the Visuals paragraph among them (step 5's own), and Save & export writes the planners' workbook or a Word document. It is a screen and a record of review, never a run input. The rows, rules, sources and wording are in `docs/forestry-route-card.md`.
