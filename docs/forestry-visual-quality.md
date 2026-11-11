> **Implementation update:** See [the integrity, road-camera and PDF export contract](forestry-visual-quality-integrity.md). It supersedes the older descriptions below of pooled landforms, maximum-ground-area viewpoint selection, missing terrain being clear, VAC defaults and the original drive controller.

> **Planner review:** [November 2026](forestry-visual-quality-planner-review-2026-11-10.md) — what a BCTS planner asked for in a recorded walkthrough, what is built, how the view compares with human sight, and what is left.

> **Work log:** [September 2026 round](forestry-visual-quality-worklog.md) — the handbook steps as tabs, map scale, field photos, retention and partial cuts, inventory-calibrated forest density, terrain landforms, and what each turned up.

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
| 2 · Visit the viewpoints | 3.2 | *Look from the road*, and while in the road view its settings (**Road view**, folded *Block colours*, **Drawn timber**, **Existing forest and regrowth**); **Saved views**; folded *Route preview*, *Field records* and *Field photo*; **Viewpoint type** (3.2.1) |
| 3 · Design and simulate | 3.3 | **Run assumptions** (active landform, year, green area, existing disturbance), **Simulation** (the run), **Results**, then folded *Simulation settings*, *Planning thresholds*, *Masks and local surfaces*, *Landform design review* (Appendix 5) and *Design comparisons* |
| 4 · Assess against the VQO | 3.4 | **Ocular assessment** (3.4.1), **Percent alteration** (3.4.2), **Design adjustments** (3.4.3) |
| 5 · Final rating and package | 3.5, 4.0 | **Final rating** (Table 7) and the rationale, **Planning note · Visuals**, then **FS1252 package**: whether its numbers are usable, the viewpoints it carries, **one** *Export filled FS1252 PDF*, and folded beneath it the viewpoint picker, run diagnostics and office fields; folded *VIA evidence package*; the worksheet and scene file under *Also download* |

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
*New site* and *Export the scene* are in steps 1 and 5.

### Map layers, landform readings and viewpoint arrows

- **Show, on both maps.** The road view's *Show* tiles (step 2) and the plan
  map's legend (*Show* section, `PlanMapLegend` `show`) switch the same kinds
  of layer: analysis points, satellite imagery, EVQO polygons, landform. Each
  view keeps its own set — the plan map's in `planShow`, the road view's on
  `DriveState` — because their defaults differ (the plan shows analysis points
  from the start; the road view does not). Note screenshot look and distance
  haze are road-view only.
- **Both terrain readings at once.** *Find a landform from the terrain* reads
  the ridge layer seen and the face turned to the view in one terrain load,
  draws both (green and orange, `LANDFORM_METHOD_COLORS`), and compares them
  in a table. The one in front is filled and the one *Use* adopts. **Read from**
  takes the road (the ridge layer joins every station), an inventory viewpoint
  or rec site, or a point picked on the map; from a point both readings use
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
carries the one "scene changed — rerun" notice.

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
  that was 40% clearcut counts 40%.
- **No double counting.** A proposed block laid over an opening that still
  counts is not charged for that ground again; ground under a *recovered*
  opening is free for the proposal to claim.

## The green area, and where it comes from

The 1998 document is explicit: visual landscape management "applies a percent
denudation figure to the **total green (forested) portion** of the visual
landscape, whether the area is available for harvest or not." So the planimetric
denominator is the landform's treed area, not all of it.

That comes from **VRI rank-1** (`WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY`),
queried live from DataBC's WFS. `BCLCS_LEVEL_2` is exactly the distinction the
procedure turns on: `T` for treed ground, anything else for water, rock, or
clearing. It is not in the ArcGIS map service the rest of this page uses — that
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

"Look from the road" puts the camera at eye height on the corridor and turns on
3D terrain. Play drives it along at a chosen speed; the profile chart doubles as
the scrubber. Facing a block pitches the camera at it, and the sample points
narrow to what *that* point on the road can see — red ground appears and
disappears as ridges pass in front of it.

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
street-level photo from Mapillary.

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

Limits: the eye stands on the road centreline, not the photo's recorded spot (the panel says how far apart they are, and refuses
beyond 60 m); photo dates are the camera's clock and can be wrong (that image
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
five BC interior species (lodgepole pine's long clean bole and short crown,
interior spruce's spire, subalpine fir narrower still, trembling aspen's rounded
crown over a pale stem, paper birch's over a white one), four drawn variants
each, into one 20-cell atlas. Nothing to license, nothing to download, and the
stand can be redrawn for a different species mix without an art pipeline.

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

## Files

| Path | Role |
| --- | --- |
| `src/pages/DevForestryVisuals.tsx` | Page: scene state, map layers, drawing, import/export |
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
| `src/pages/dev-forestry/viewpointInventory.ts`, `ViewpointFinderPanel.tsx` | VLI viewpoints and arrows, rec sites, screenings and tenure road names around a block |
| `src/pages/dev-forestry/ridgeLayers.ts` | A candidate landform as the ridge layer seen from the road |
| `src/pages/dev-forestry/SatelliteImagery.tsx` | Satellite imagery under the page's layers |

`terrain.ts`, `visibility.ts`, `vqo.ts`, `via.ts`, `photoPose.ts`, `skylineFit.ts`, `landformFromTerrain.ts`, `ridgeLayers.ts`, `visualsNarrative.ts`, `basemapContext.ts`, `shapeImport.ts`, `reverseViewshed.ts`,
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

## The road view's layout

The bar over the map plays: play and pause, the route position with 10 m
steps, speed, the harvest phase, **Save** and **Image**, reset look, the keys
behind an (i), and the way back to the map. Everything about how the view looks
— where to look, a jump to a view of the block, analysis points, satellite
imagery, the note screenshot look, block colours, EVQO polygons, the landform, distance haze,
the drawn timber, existing forest and regrowth, display quality — is step 2's
**Road view** section, which comes first
in that step while the road view is open. One status line over the map reads the
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
still shows what the nearest road station sees, and the panel says so; Play, a
seek, or facing another block puts the walker back on the road.

**Satellite imagery** drapes Esri World Imagery under every layer the page
draws, below the basemap's first label layer (`SatelliteImagery.tsx`), never as
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

## The block note: Excel or PDF

Step 5's *Planning note · Visuals* ends with **Download Excel** and **Download
PDF** (`blockNote.ts`). Both carry the header (block, licence, permit, opening,
area, EVQO classes under the block), the viewpoint, the landform with its percent
alteration in perspective view against its Table 2 range, the Visuals paragraph
— the reviewer's, or the draft flagged "not yet reviewed" — every saved view's
screenshot with its caption, in the order saved and from every place stood at,
and a plan map framed on the block and viewpoint.

- **Excel** follows the planner's own `*_Report.xlsx`: an *Other
  Considerations* sheet with "Visuals" in B2 and the paragraph in C2, the
  screenshots and captions below, so the row pastes into their workbook; a
  *Block* sheet with the header and figures; a *Basis* sheet with the
  measurement behind each drafted sentence.
- **PDF** (letter, landscape) puts the first view large with the header and
  paragraph beside it, in the style of the report a GIS analyst produced at
  Canfor, then the other views and the plan map two to a page.

The draft's closing "See screenshots below." is reworded for where the file
puts them (`paragraphForLayout`): kept in Excel, where they are below; "See the
view at left and the others on the next page" in the PDF, where the first sits
beside the paragraph; dropped when the note has no screenshot. Only that
sentence changes; the rest of the reviewer's text is theirs.

Screenshots are taken when *Save viewpoint* is pressed (`captureMapImage`,
JPEG, 1600 px on the long side), because the frame being saved is the one the
reviewer chose; they are kept for the session, and a view saved without one is
listed by caption instead. The plan map is captured at export from the plan
view (`capturePlanMap`) and left out, with a note saying so, if the export runs
while the road view is open. exceljs and jsPDF load on demand and are passed in,
so `blockNote.test.ts` writes and reads back real files.

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
viewing directions, rec sites and screenings. Layers and rows read one set of
colours, `planMapStyle.ts`; sensitivity units are drawn in their objective's
colour, the colour their sidebar rows show. Map hovers are `mapTooltipHtml`
cards. The road view keeps its own status panel and has no legend.

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
  *Download preview* keeps the current place's.
- **Block colours**: in step 2's *Road view* section, beside the note
  screenshot look, one swatch per block opens a colour picker with screenshot
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
- **Step 3 — masks and sources:** import classified polygons, or copy an outline
  drawn with the existing map controls. Natural non-green areas leave numerator
  and denominator; private land and permanent non-forestry disturbance remain in
  the assessable land base but contribute no forestry alteration. Retained patches
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
