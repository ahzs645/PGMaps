> **Implementation update:** See [the integrity, road-camera and PDF export contract](forestry-visual-quality-integrity.md). It supersedes the older descriptions below of pooled landforms, maximum-ground-area viewpoint selection, missing terrain being clear, VAC defaults and the original drive controller.

> **Planner review:** [November 2026](forestry-visual-quality-planner-review-2026-11-10.md) — what a BCTS planner asked for in a recorded walkthrough, what is built, how the view compares with human sight, and what is left.

> **Tools trial:** [12 November 2026](forestry-visual-tools-trial-2026-11-12.md) — EZ-Tree, maplibre-landmarks, maplibre-gl-three, Giro3D, OpenForest4D and FORA run against Prince George LiDAR and this page's tree renderer.

> **Work log:** [September 2026 round](forestry-visual-quality-worklog.md) — the handbook steps as tabs, map scale, field photos, retention and partial cuts, inventory-calibrated forest density, terrain landforms, and what each turned up.

> **Report survey:** [November 2026](forestry-visual-quality-report-survey-2026-11-11.md) — what 26 real visual-quality assessments ask of the page.

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

## The sidebar follows the VIA handbook's five steps

The sidebar is laid out as the procedure in the *Visual Impact Assessment
Handbook* (BC Ministry of Forests, 2022, Figure 2): one **tab** per step,
pinned under the answer, and one step on screen at a time. Stacked as folding
sections the sidebar ran to about eleven screens with every step open; as tabs
the longest step is under three. Every step stays mounted while hidden, so what
is typed survives switching.

| Step | Handbook | In the sidebar |
| --- | --- | --- |
| 1 · Identify the VQO and viewpoints | 3.1 | **Start from** (Tabor sample, Purden Lake, roadside demo, new site); **Road or viewpoint** (spot or length of road, draw, import, snap); folded *Which roads see the block* and *Viewpoints and rec sites*; **Cutblocks** with their objective and harvest system; **Landform and objective**; folded *Existing openings*, *Find a landform from the terrain*, *Find a landform in the BC inventory* and *Look up this map view* |
| 2 · Visit the viewpoints | 3.2 | *Look from the road*, and while in the road view the stand (folded *Block colours*, **Drawn timber**, **Existing forest and regrowth**; how the view looks is the road view bar's *View options*); **Saved views**; folded *Route preview*, *Field records* and *Field photo*; **Viewpoint type** (3.2.1); folded *Field brief and crew checklist* |
| 3 · Design and simulate | 3.3 | **Run assumptions** (active landform, year, green area, existing disturbance), **Simulation** (the run), **Wildlife tree patches** (draw one on the plan), **Results**, then folded *Simulation settings*, *Planning thresholds*, *Masks and local surfaces* and *Design comparisons* |
| 4 · Assess against the VQO | 3.4 | **Ocular assessment** (3.4.1), **Percent alteration** (3.4.2), **Design adjustments** (3.4.3) |
| 5 · Final rating and package | 3.5, 4.0 | **Final rating** (Table 7) and the rationale, **Planning note · Visuals**, then **Package**: buttons that open *Save & export* on the block note, the FS1252 form, the analysis sheet or the scene; folded *VIA evidence package* (recording a run and the evidence checklist) |

Under every step, after step 5, a folded **Resources** section holds reading
rather than controls: links to the VIA Handbook and FPPR, the five FPPR s. 1.1
visually altered landscape categories (the `VISUAL_QUALITY_CLASSES`
descriptions), and *Landform design review* (Appendix 5).

The sidebar is laid out like the road designer's: the step tabs at the top of
the scroll, then flat `ToolSection`s (`src/components/ui/tool-section.tsx`)
separated by full-width rules. A section's explanation and handbook reference
sit behind the (i) in its heading, not printed under it; secondary sections fold
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

### Save & export

The workspace's toolbar has a **Save & export** button, laid out like the road
designer's dialog (`VisualsExportDialog.tsx`, state and builders in
`useVisualsExport.tsx`, the catalogue in `visualsExports.ts`, DOM-free). The
sidebar keeps the work — the paragraph, the crew checklist, the step 4 record —
and its buttons only open the dialog on an output (*Export the block note…*,
*Download the field brief…*, *Save views…*, *Export the package…*, step 5's
*Package*).

| Group | Output | Formats | Options in the dialog |
| --- | --- | --- | --- |
| Assessment documents | Block note | Excel, PDF | Each view as its analysis-sheet figure |
| | FS1252 form | PDF | Stations, each one's reviewer inputs, run diagnostics, office fields |
| | Analysis sheet | PDF, PNG | Saved view, figure style, label style, camera block |
| | Field brief | PDF | Block, when there are several (shared with step 2's checklist) |
| | Worksheet | Markdown | — |
| | VIA evidence package | PDF, printable HTML | — |
| Save and reopen | Scene, Saved views, Assessment workspace, 3D scene | JSON | — |

Each output's pane has two views. **What goes in** lists, from the same state the
file is written from, the parts it carries: the landform (name, objective, VAC,
area, source), the viewpoint, every saved view with the settings it was saved
with (position, facing, eye height, lens, timber, harvest phase, design), the
blocks and masks, the run's status and figures, the run settings and the
review — each with *Change in step N*, which closes the dialog on that step.
**Preview** builds the file itself and shows it (a PDF in the browser's viewer,
an image, HTML in a sandboxed frame, text); *Download* saves that same file. An
output that cannot be written yet says why in the list (no block, no run, a
stale run, no saved view, the road view closed).

Rules: the dialog never writes to the scene except the FS1252 office fields
(`reportMetadata`, as before) and the field brief's block; its other choices
(stations, figure style) last while the page is open and reset with the run as
the sidebar's did. Closed, `useVisualsExport` returns before building anything:
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
- **Ground in the road view.** Mapped water is drawn as water whenever the road
  view is open, timber or not; the drawn forest floor and soil stand aside when
  satellite imagery is on, so the imagery is the ground.
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
record.

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

Table 6 is read from its nearest cell rather than interpolated, as a reviewer
with the paper form does. `PERCENT_CLEARCUT` on an *existing* opening is not
volume removed, so existing openings keep their own scaling (below) and are
never converted through Table 6.

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
  each checked opening's field and modelled shares) and the Markdown worksheet.
  Those labels are read from the run's own input snapshot (`runGreenUpBasis`),
  so they always describe the figure beside them; openings that reach no
  landform sample are left out of the count.
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

**Steering from the plan.** While the road view is open the plan's viewer is
two handles (`PlanViewerHandles`): drag the dot along the road to move the road
view there (snapped by `distanceAlongRoad`, seeking at most every 120 ms), and
drag the tip of the view cone to turn it, which sets `drive.lookBearing` exactly
as facing an inventory arrow does (*Where to look* then reads "Turned on the
map"). A plain click anywhere on the plan moves the road view to the nearest
point on the road (`PlanClickToMove`), so you can look at one area, click the
next and look again. A click on an inventory viewpoint or rec site still stands
you there, and while the road view is open sample points and sensitivity units
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

- **A photo of your own.** *Line up a photo of my own* (under the Mapillary
  part, and available without a Mapillary token) opens a JPEG, PNG or WebP
  in the browser as an object URL — nothing is uploaded or stored — or
  **Open** takes a *Field records* photograph (kind `photo`) from its stored
  copy. It lives in the Field photo panel rather than in Field records because
  the overlay, the nudge controls and the road view's line-up are all here.
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
  - `DateTimeOriginal` shown as the camera clock, and GPS altitude shown for
    reference only. The eye is placed at the ground under the spot plus the
    eye height, never at GPS altitude.
  Pitch and roll start level (EXIF records neither); eye height starts at the
  settings' observer height. Every value is editable — latitude and longitude
  typed or **Pick on the plan**, heading, pitch, roll, field of view and eye
  height — and each says where it came from. The overlay adds narrower/wider
  field-of-view buttons beside the turn and tilt arrows; with an own photo the
  arrows and *Auto-align* change the pose itself, and Reset returns heading and
  pitch to where they started. **Save this pose to the field record** writes
  the camera back to the record it came from (altitude as road-view ground
  plus eye height) and leaves its "I checked…" box unticked for the reviewer.
- **Standing off the road.** An own photo's eye stands on its recorded spot,
  not the road line: the road view seeks to the nearest road point and
  `DriveCamera`'s `standAt` holds the walker's offset on the photo's position
  (the same walk as W A S D, which it overrides while compared). It refuses a
  spot more than 2 km (`MAX_WALK_METERS`) from the road line or outside the
  road view's loaded terrain. Red ground is still the nearest road station's
  view. The Mapillary path is unchanged and still stands on the road line.

Limits: a Mapillary photo's eye stands on the road centreline, not the photo's recorded spot (the panel says how far apart they are, and refuses
beyond 60 m); an own photo's lens is assumed distortion-free and uncropped; photo dates are the camera's clock and can be wrong (that image
says January 2016 on a 2020 camera, in summer). Photos are CC BY-SA 4.0 and
every view credits the photographer. The client token lives in `.env.local` as
`VITE_MAPILLARY_TOKEN` — a client token is built for browsers. No client
secret is used or needed.

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

Two ways, and the panel switches between them so they can be compared at the
same camera and the same stem count.

**Billboards** (the default) put the tree in a texture and stand each stem up as
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
six BC interior species (lodgepole pine's long clean bole and short crown,
interior spruce's spire, subalpine fir narrower still, interior Douglas-fir's
broad, open, level-limbed crown, trembling aspen's rounded crown over a pale
stem, paper birch's over a white one), four drawn variants each, into one
24-cell atlas. Nothing to license, nothing to download, and the stand can be
redrawn for a different species mix without an art pipeline.

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

Two settings beside *Display quality*, both display only:

- **Tree shading.** *Lit* (the default) shades each card as the crown it
  pictures: a normal bent outward from the card's centre line so the sunny side
  of the crown is lit and the far side is not, the lower crown in its own
  shade, light through the needles when the eye looks toward the sun, and a
  little brightness and saturation variety per tree. Solid stems get wrapped
  light and crown-depth shading. *Flat* is the drawing's own colours, as
  before. Lighting never changes which pixels a tree covers.
- **Detail when stopped.** While the view moves every stem is a card, which
  keeps driving smooth. Once the camera has held still for half a second
  (`DETAIL_SETTLE_MS`, read off the frame's own matrix, so turning the head
  counts as moving), the stems within 80, 150 (default) or 250 m are drawn
  again as detailed meshes (`detailedTreeMesh`: branches in whorls with uneven
  extension and gaps, lower limbs drooping more than upper ones, foliage
  sprays from a third of the way out, normals bent outward so a crown shades as
  a volume). The same stems at the same positions, heights and crown widths;
  the cards step back from that ring for the frame. *Faster* turns it off.

These follow techniques surveyed in `forestry-visual-tools-trial-2026-11-12.md`
§10 (Sylva's canopy cards, VistaWASM's wrap and back-light, OpenWorldGen-SDK's
crown occlusion, BakedVoxelLighting's whorls), re-implemented here; no code or
asset from those projects is copied.

**Screening is pinned.** The trial measured that a tree's drawn shape alone
moves the share of a view a stand hides by 10–12 points at the same density and
closure. `screenCoverage.test.ts` rasterises every species' far card and its
detailed mesh side-on and pins both areas to within half a percent, and holds
the detailed mesh within 15% of its card, so stopping cannot change the
screening a viewer sees. Change a silhouette or the mesh and that test fails:
update its figures only on purpose. The first draft of the detailed fir covered
0.79 of its card and the Douglas-fir 1.20; both were tuned against the test.

**Distant crowns keep their coverage.** The atlas's mipmaps are built on the
CPU (`atlasMips.ts`) with each cell's alpha rescaled so the share of texels
past the cut-out threshold matches the full-size cell's. A GPU box filter
thins a ragged crown with distance, and a thinner far canopy would screen less
of a block than the stand it stands for.

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

Two details the billboard path turns on:

- **Cut out, do not blend.** Blended foliage needs back-to-front sorting and a
  stand has no back to front. A hard alpha edge costs some aliasing and keeps
  the depth buffer honest, so trees behind a ridge stay behind it.
- **The view direction comes out of the matrix.** MapLibre publishes no camera
  position, and the one place it keeps internally is the value that misleads
  deck.gl. The row of the projection matrix that produces clip `w` measures
  distance from the camera along the view axis, so its gradient
  `(m[3], m[7], m[11])` is the view direction — enough to turn a cylindrical
  billboard, and it cannot disagree with the matrix that drew the ground.

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

The models are `detailedTreeMesh`, which stands exactly one unit tall, so a
stem's recorded height is the height it is drawn at.

Other engines read the package through adapters kept outside the app
(`docs/forestry-visual-tools-trial/engines/`). Nothing in `src/` depends on
them. The VistaWASM bench (AGPL-3.0) is installed only in its own folder and is
never shipped.

## Files

| Path | Role |
| --- | --- |
| `src/pages/dev-forestry/scenePackage.ts` | The road view's scene as a renderer-neutral file, for the other-renderer trial |
| `src/pages/DevForestryVisuals.tsx` | Page: scene state, the tiled workspace and its two maps, drawing, import/export |
| `src/pages/dev-forestry/VisualQualityLayers.tsx` | The scene's map layers, drawn in the plan map (`mode="plan"`) and the road view (`mode="eye"`) |
| `src/pages/dev-forestry/visualsWorkspace.ts` | The workspace's panes, presets and which panes show before the road view opens |
| `src/pages/dev-forestry/viewpointSummaryRows.ts` | The viewpoint summary's rows, read from the run |
| `src/pages/dev-forestry/ViewpointSummary.tsx` | The summary pane and its settings dialog, on the shared `MetricSummary` |
| `src/pages/dev-forestry/terrain.ts` | DEM tile maths and the elevation mosaic |
| `src/pages/dev-forestry/visibility.ts` | Sightlines, sampling, areas, perspective weighting |
| `src/pages/dev-forestry/analysis.ts` | The run itself — stations, grids, reduction |
| `src/pages/dev-forestry/analysis.worker.ts` | Off-thread wrapper: fetch terrain, then trace |
| `src/pages/dev-forestry/demLoader.ts` | Tile fetching and decoding, with an injectable decoder |
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
| `src/pages/dev-forestry/ForestOverlay.tsx` | Which ground to grow, and when to regrow it |
| `src/pages/dev-forestry/visualsNarrative.ts`, `VisualsParagraphPanel.tsx` | Step 5's planning-note summary and the drafted Visuals paragraph |
| `src/pages/dev-forestry/fieldChecklist.ts`, `fieldBrief.ts`, `FieldBriefPanel.tsx` | The VIA stage, the crew checklist, and step 2's one-page field brief |
| `src/pages/dev-forestry/visualMeasures.ts` | The drafted visual measures for the Site Plan and Logging Plan (pure) |
| `src/pages/dev-forestry/WildlifeTreePatchPanel.tsx` | Step 3's *Draw a wildlife tree patch* and the patches in the scene |
| `src/pages/dev-forestry/viewpointInventory.ts`, `ViewpointFinderPanel.tsx` | VLI viewpoints and arrows, rec sites, screenings and tenure road names around a block |
| `src/pages/dev-forestry/ridgeLayers.ts` | A candidate landform as the ridge layer seen from the road |
| `src/components/ui/map-satellite-imagery.tsx` | Satellite imagery under the page's layers (shared with the road-design plan) |
| `src/components/ui/map-sketch.tsx`, `map-measure.tsx`, `src/lib/geo/mapSketch.ts` | The plan's Measure tool and the drawing of roads and areas (shared with `/dev/interact` and the road-design plan) |

`terrain.ts`, `visibility.ts`, `vqo.ts`, `via.ts`, `photoPose.ts`, `skylineFit.ts`, `landformFromTerrain.ts`, `ridgeLayers.ts`, `visualsNarrative.ts`, `fieldChecklist.ts`, `fieldBrief.ts`, `basemapContext.ts`, `shapeImport.ts`, `reverseViewshed.ts`,
`roadSnap.ts`, and `forest.ts` are pure and carry unit tests; `analysis.ts` takes an `ElevationSource`, so a run can be driven
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

Step 5's **Planning note · Visuals** heads the block the way a BCTS block
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

Step 1's **Viewpoints and rec sites** reads five DataBC WFS layers within 12 km
of the block (`viewpointInventory.ts`): VLI viewing points
(`REC_VIEWPOINT_POINT_SVW`), their landscape arrows
(`REC_VIEWING_DIRECTION_LIN`), inventory screenings (`REC_SCREENINGS_POLY`),
recreation sites (`FTEN_REC_SITE_POINTS_SVW`) and tenure road sections
(`FTEN_ROAD_SECTION_LINES_SVW`). Three facts about the data shape the code:

- The ArcGIS view of the viewpoints (MapServer layer 5) advertises queries but
  answers with no rows; the WFS has all 12,396. Every one carries an expiry
  date in the past, so expiry is shown, not filtered on. Rows typed `ERROR` are
  the inventory flagging its own mistakes and are dropped.
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
check. **Assess from here** makes one the spot viewpoint.

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
describes stays in the sidebar.

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
  landform, or none. Each layer is read live from DataBC's WFS for the box
  around the blocks and landform (the blocks alone when that box is wider than
  0.4°), 800 ms after the shapes last change, with the box in `CQL_FILTER`,
  longitude first, and the geometry field named in `propertyName`. Overlaps
  under 0.05 ha are boundary slivers and are not counted. A check is a screen,
  not a legal determination: it never writes a mask or changes a figure (add
  private land as a mask in step 3 for that), and a layer that fails says *Not
  read* rather than *None*. On the Tabor sample in November 2026 it found the
  blocks inside ungulate winter range u‑7‑022 (conditional harvest zone) and
  the Tabor Mountain recreation area, and 797 ha of private parcels in the
  landform.

## The road view's layout

The bar over the map plays: play and pause, the route position with 10 m
steps, speed, the harvest phase, **Save**, **Image** and **View options**, reset
look, the keys behind an (i), and the way back to the map. *View options*
(`RoadViewOptions.tsx`, the shared `ToolbarPopover`) holds how the view looks,
in four groups: **Look** (where to look, a jump to a view of the block),
**Show** (analysis points, the note screenshot look, EVQO polygons, the landform,
distance haze), **Figure** (figure and label style) and **Drawing** (display
quality, tree shading, detail when stopped). Its badge counts what is drawn over
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
are display only. See the
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
kept once written and never overwritten from the draft; *Use the draft
measures* copies it in, and the draft stays beside it. Typed bullets and
numbers are taken off (`measureItems`) because the files number the list.
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
  road's assessment station (or the road's start before a run), each saved
  view on this road at its position along it, and views saved while standing
  elsewhere (no position on this road), each with latitude/longitude, the
  bearing to face and *Reachable / Not reachable* tick boxes; up to three of
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
  `station:<viewpoint id>`, `view:<saved view id>`) and per opening (target
  id) a yes/no and a note; one boundary note. Each answer is stamped with the
  panel's *Checked by* and the local date (`updateFieldCheck`), and an entry
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
the text step 5's *Planning note · Visuals* holds. Both carry the header (block, licence, permit, opening,
area, EVQO classes under the block), the viewpoint, the landform with its percent
alteration in perspective view against its Table 2 range, the Visuals paragraph
— the reviewer's, or the draft flagged "not yet reviewed" — every saved view's
screenshot with its caption, in the order saved and from every place stood at,
and a plan map framed on the block and viewpoint.

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

**The catalogue.** `src/lib/forestry/viaFigure/presets.ts` holds twelve presets
(analysis sheets with a magenta, orange or purple landform; existing / proposed /
analysed panels; a board triptych; a district greyscale analysis with lines of
force; a referral montage; calculation-on-photo; forest-plan time-step ramps;
small extras). Each drawn thing is a `SheetSymbol` with a `spec` string citing
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
(block over opening over private land over rock over landform). The pass is read
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
rock, as the preset words it — and beside it PGMaps' sightline figure for the
station, which stays the assessment's number. They measure different things:
the pixel figure is what this one picture shows at this lens; the sightline
figure is the run's terrain sightlines in perspective. Neither replaces the
other, and the panel says so.

**Framing.** The figure is not the reviewer's road-view screenshot (that stays the
block note's). At *Save viewpoint* the page reads, from the drive's exact pose
over the DEM, the bearings and elevation angles of the landform ground the eye
sees (`landformAngularExtent`, `figureFraming.ts`), and plans the capture as the
reference sheets crop it (`planFraming`, ported from the prototype's
`framing.ts`): the landform mid-frame, about a fifth of the height sky above the
skyline, at most about 12% ground below its base, small side margins, never
stretched. The lens is a 50 mm full-frame equivalent (39.6° across), or a field
photo's own lens when the view is lined up on one; a landform wider than one
frame takes up to four frames of the lens side by side across its bearings (the
consultants' renders are 60–141° panoramas), and a long, low landform makes a
strip up to 4:1. `captureFramed` (`mapCapture.ts`) stands the eye map at the pose
on each frame (`calculateCameraOptionsFromTo` to a target 40 m ahead, pitch
through `horizonSafePitch`, roll 0), sets the frame's vertical field, reads the
display and the class pass from the frame's window of the canvas, joins the
frames, and puts the camera and field back. Callouts and lines are placed by a
pinhole from the same eye (`projectToFrames`), which needs no map once the camera
is restored. The sheet prints the lens, field and bearings. A very large landform seen
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
calculation, legend); the others print the analysed figure on a page of its own
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
a narrow `propertyName`, like the vegetation read. Parcels are candidates: each
one the reviewer adds becomes a `private` assessment mask, which the run already
keeps out of the alteration, so adding one stales the run. A failed lookup is an
error with a retry, never "no private land".

**Rock** is VRI non-vegetated land (rock, rubble, exposed soil, not water). It
is display and figure only: no number in the run reads it, and the pixel
calculation's net-of-rock figure is labelled as the preset's own.

**Candidates, never figures.** Sub-landform dividers and lines of force are
designer aids. They are drawn when a style defines them, cut in exports to where
the class pass shows the landform (a nearer part of the same landform can still
hide them unseen), and never adopted into the scene or fed into a number.
Per-sub-landform figures, FWA creek barriers and the far-ridge rule
(`depthLayers`) are not ported: they need the prototype's own renderer
(per-pixel ground position and distance), which MapLibre does not give. Callouts
are drawn on the exported sheet only, not live on the road view. Lines of force are drawn without their arrowheads, live
and in exports: a draped arrow needs an arrowhead icon in `icons.ts` and an
end-only `LineMarker`.

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
inventory is unavailable and offers a retry.

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
  Prior-year partial cuts are rejected until a supported recovery model exists.
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
