# Streams, constraints and terrain profiles

**Terrain** keeps these three jobs apart. **Streams** holds each reach and its evidence, **Constraints**
holds areas the road keeps out of or pays to cross, and **Terrain profiles** holds saved ground profiles
and samples any mapped line. Opening a stream shows its assessment; **View terrain profile** is an action
inside that view.

## Importing streams and areas

**Streams → Import** reads GeoJSON, a zipped shapefile, KML or KMZ. It imports lines as streams
without asking only when the file reads as stream data: Freshwater Atlas attributes, or a file or
features called stream, creek or river. Otherwise it asks what the lines, polygons and points are
before anything is added, because a stream draws a riparian screen and prices a crossing, and an
avoidance area blocks route search. A cutblock, a road line or a property boundary given to this
picker is offered as what it is. A polygon becomes an **Excluded** constraint only when **Avoidance
area** is chosen. Feature names come from the file. See
[Bringing spatial files in](exports-and-project-files.md#bringing-spatial-files-in).

## B.C. riparian class

`streamClass.ts` suggests a class from the Forest Planning and Practices Regulation, section 47, read
from the consolidation current to 3 November 2026. A suggestion is a planning aid and never a
determination. The rules are pure, so a change to them is checked by `streamClass.test.ts` alone.

| Class | Applies when                                                       | Reserve | Management | Total |
| ----- | ------------------------------------------------------------------ | ------- | ---------- | ----- |
| S1-A  | Fish or community watershed; 1 km average width 100 m or more      | 0       | 100        | 100   |
| S1-B  | Fish or community watershed; width over 20 m, not S1-A             | 50      | 20         | 70    |
| S2    | Fish or community watershed; 5 m to 20 m                           | 30      | 20         | 50    |
| S3    | Fish or community watershed; 1.5 m to under 5 m                    | 20      | 20         | 40    |
| S4    | Fish or community watershed; under 1.5 m                           | 0       | 30         | 30    |
| S5    | Not a fish stream and outside any community watershed; over 3 m    | 0       | 30         | 30    |
| S6    | Not a fish stream and outside any community watershed; 3 m or less | 0       | 20         | 20    |

Widths are minimums on each side, in **slope distance** from the stream channel bank, with the
management zone beyond any reserve. Where an active flood plain is wider than the management zone, the
zone extends to its outer edge. The regulation's minister-specified reserve on S1-A, and other planning
provisions, are not modelled.

- **Missing evidence stays missing.** S5 and S6 need fish absence supported and a location confirmed
  outside community watersheds, so an unresolved stream has no class. With only a width known, the panel
  shows both outcomes.
- **Fish status is not derived.** The regulation's fish-stream definition includes a gradient under 20%
  with exceptions, so slope alone does not settle it, and no record of fish is not evidence of absence.
- **Three classes are kept apart:** the one a source file supplied (`importedClass`), the one the rules
  give, and the one a person recorded (`reviewedClass`). A source class is read only from an explicit
  `riparianClass` property: a column called `class` could mean anything, so it is ignored.
- **A review records what it rested on.** Changing the width, fish or watershed status, the 1 km average,
  reach geometry or rules version reads as **Needs review**. Restoring the same inputs and rules clears it.
- **Older projects** open with their streams unassessed.

## Channel read from the terrain

Opening a stream that a road crosses shows **Channel read from the terrain** under its widths
(`NaturalChannelPanel.tsx`, `culverts/naturalChannel.ts`). For each crossing (the first three) it
cuts a straight section of the existing ground square to the stream, 20 m upstream of the crossing
along the stream line so road fill is not read as channel, 20 m either side of the line, at the
terrain's own cell or point spacing (`terrainResolution`), never finer. Upstream is the line's
higher end on the terrain; where the terrain cannot tell, the line's own order is used and the
reading says so. A gap in the terrain stays unknown.

From the section it reads a **candidate bankfull** width, mean and maximum depth, area and
width-to-depth ratio:

- **Thalweg.** The lowest ground within ±8 m of the stream line. Samples within 3 cm of it are
  tied; the run of tied samples nearest the line is taken, never simply the first lowest sample,
  so a side pocket as deep as the channel is not chosen. Ground still falling at ±8 m means the
  mapped line is off the channel, and nothing is read.
- **Bankfull** is the first bench: the lowest stage, at least 0.15 m above the thalweg, where the
  waterline's top width grows at least 20 m per metre of rise (ground flatter than 1 in 10 each
  side) and at least three times the median rate below it: the first peak of the bench index
  (Riley, S.J. 1972, J. Hydrology 17: 23-31). The water spreads only through ground connected to
  the thalweg. The width-to-depth minimum (Wolman, M.G. 1955, USGS Prof. Paper 271) is reported
  beside it; where the two disagree by more than 0.1 m of stage the reading says so.
- **Not read** when the water would reach a gap or the section's end before a bench, or no bench
  is found within 4 m. Every figure is then blank, never zero.

Flags:

| Flag                 | When                                                                  | Effect                                                    |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| Too coarse           | Cells wider than a quarter of the width found; or, unread, over 2 m   | **Use** is off; the 3 × area check is not assessed        |
| Level bed            | The bed is level within 1 cm for 2 m and 3 samples or more            | Depth and area are lower bounds ("at least")              |
| Gap                  | Samples with no ground                                                | Stated; a reading the water reaches it through is not read |
| Indicators disagree  | Width-to-depth minimum more than 0.1 m of stage from the bench        | Stated; read the section sketch before using the width   |

**Use** writes the width, rounded to 0.1 m, to the stream's **Channel width** with **Measured
from: Estimate** and today's date, on the reviewer's click only. Nothing else changes, and no
class is set: the width then goes through the class rules like any entered width, and a reviewed
class reads **Needs review**, as for any width change.

Under each reading, the stream culverts placed at that crossing get the two screens of
[Culverts](culverts.md#natural-channel-screens), 3 × the high-water area and the stream width ratio,
with this reading's area and width.

**How far to trust it.** On 1 m LiDAR each bank is placed to within about a cell (a 4.85 m
synthetic channel reads 5.95 m on 1 m cells and 5.0 m on 0.25 m cells), so a channel narrower than
about 4 m (four cells) is flagged and not offered. That covers most S4 and S6 streams and the 1.5 m
S3/S4 break: those widths need a field measurement. LiDAR rarely returns the bed under water, and
a hydro-flattened DEM is level there, so depth and area are usually lower bounds. Overhanging
canopy, undercut banks and logs in the channel are not seen. Bankfull is a geomorphic stage, not
the channel width averaged over a reach that FPPR s. 47 and the Riparian Management Area
Guidebook mean, and not the high-water width a crew reads from vegetation and sediment (EM 3.6.7).

## Cost groups

The Design tab's **Crossing prices** used to call its price label a class. It is a **cost group**: a name
for a price you choose. It has no link to the riparian class, and saved groups keep their meaning.

## Riparian areas on the map and in search

`riparian.ts` draws the class's reserve and management widths as **preliminary horizontal screening
buffers**. The outer search envelope is channel half-width + reserve + management. The reserve band
includes the channel half-width; the outer management envelope includes the inner band. Colours and
legend entries distinguish reserve, management and unresolved extent. Hiding streams hides these map
bands but never disables their route constraints.

The plan and the block sheets draw the screen **dissolved by band** (`mergeRiparianZones`,
`riparianDisplay.ts`): reserve first, then management outside the reserve, then the unresolved
screen outside both, so overlapping reach buffers show one outline and one hatch. Only the drawing
is merged. The riparian register, route screening, Review's riparian row and exports keep each
reach with its own class, width and source, and clicks on the plan never read the drawn zones.
Round caps use a conservative polygon approximation (less than 0.5% outward allowance), so chords
between cap vertices cannot open small gaps inside the nominal horizontal screen.

These polygons are not surveyed banks, slope-distance boundaries or a complete legal riparian area.
They cannot establish active floodplain boundaries or a minister-specified S1-A reserve. Missing channel
width remains missing. An unresolved/stale class receives a clearly labelled **100 m horizontal screening
allowance** beyond the estimated bank, or beyond the mapped centreline if width is unknown. This is an
application screening assumption, not a statutory width or a guarantee that all affected land is inside it.
A stale reviewed class is not reused to narrow the screen. The 1 km stream/active-floodplain average input
is available even for a narrow channel.

Every stream defaults to **conditional, pending review** for its riparian area. A class review and a
conditional-use review are separate decisions. Reviewing a class does not permit a route through its
area. A recorded conditional-use review can enable a preliminary crossing, while unresolved evidence
remains visible. Global "forbid stream crossings" still blocks the stream even after such a review.

## Explicit constraints

| Treatment             | Search behavior                                                            | Meaning                                                                       |
| --------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Excluded              | Blocks the polygon interior and boundary                                   | Keep the route outside the area.                                              |
| Conditional           | Blocks until a complete current condition review exists                    | Condition, reviewer, date and evidence are recorded for the current feature.  |
| Avoid where practical | Adds the entered positive CAD-equivalent penalty per metre inside the area | Steers the search toward detours; the penalty is not a construction estimate. |
| Additional cost       | Adds the entered CAD allowance per metre inside the area                   | A planning cost assumption; it does not grant permission.                     |

Conditional reviews bind to geometry, stream evidence, current rules and treatment/condition inputs.
Changing any of these makes the review stale and blocks search again. The record is a planning decision,
not an authorization, permit or proof that every measure has been implemented. It can be cleared explicitly.

`ContextFeature.constraint` stores area treatment and `riparianPolicy` stores stream-area treatment.
Absent area policy retains the legacy convention: no `routeCostPerM` is excluded and an explicit number
is additional cost. An explicit policy takes precedence. Both policies and review evidence survive project
JSON and context GeoJSON. `crossingGroup` remains unrelated to class or treatment.

Both terrain-cost and corridor search use the same expanded polygons. Corridor penalties convert CAD/m
to equivalent route metres using `constraintCostBasePerM` (default 100 CAD/m). Polygon holes are retained.
Final fitted-centreline checks use geometry intersection, including crossings between sampled vertices,
so a later fitted route cannot silently re-enter an excluded or pending area. Search allowances, crossing
structure estimates and conditional review evidence remain distinct.

Terrain-route candidates report `cost` (the search model's CAD allowances), `avoidancePenalty`
(nonfinancial CAD-equivalent penalty) and `searchScore` (their sum) separately. Routes and FSR target
comparisons rank by `searchScore`; the displayed model cost excludes avoidance penalties. Corridor
optimization's existing `cost` remains an equivalent-route-metre score, not a monetary estimate.
