# Culverts: cost, appraisal treatment and design checks

**Engineering → Drainage** lists each culvert of the road. Under its inputs every culvert now
shows three things, kept on separate lines because they answer different questions:

| Line                    | Question it answers                                                    | Where it comes from                                                                 |
| ----------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Construction cost**   | What does the estimate say it costs to build?                          | Installed cost per metre × barrel length × barrels, plus the fixed cost             |
| **Appraisal treatment** | How does the appraisal manual cost it for stumpage?                    | The manual for the project's cost location (`culverts/culvertAppraisal.ts`)         |
| **Class** and **Design checks** | Is it a major culvert, and does it meet the Engineering Manual's rules? | `culverts/culvertClass.ts`, `culverts/culvertChecks.ts`                             |

The same rows are the **Culvert schedule** in the report, the **Culvert schedule** CSV in
Save & export, and the **Culverts meet the manual's rules** row in Review
(`culverts/culvertSchedule.ts`), so a figure cannot differ between them.

These are planning screens. They are not a hydrotechnical design, a fish-passage design or an
appraisal submission.

## Before you rely on it

- **The appraisal treatment never changes the estimate.** A pipe "in the subgrade allowance" still
  costs money to build, and its installed cost stays in the structures total. The appraisal figure
  is the manual's, on a 2024 cost base, and feeds the stumpage appraisal.
- **Set the cost location first.** The manual follows the project's BC cost region
  (cost dialog → Cost location). With none set, the Interior manual is shown and the line says it
  is a default. A region marked as spanning both manuals shows the Interior manual and says to
  confirm. A cost location outside BC shows no appraisal treatment.
- **A check that could not be made is "not assessed", never "met".** Cover and gradient need both
  inverts. Capacity and headwater need a current drainage check.
- **An unset purpose is read as a cross-drain**, as the editor shows it.

## Appraisal treatment

Read from the manuals effective 2026 on 16 November 2026 (`culverts/appraisalPacks.ts`).

### Interior (Interior Appraisal Manual, effective 1 July 2026)

| Culvert                                                              | Treatment                                             | Where                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Round pipe under 0.95 m, up to 20 m long                             | In the tabular subgrade allowance; no separate figure | IAM 4.3.2.1(1)(i), 4.3.3(1)                       |
| Round pipe 0.95 m to 1.8 m, up to 20 m long                          | Table 4-3, Part A: one installed total by length and diameter | IAM 4.3.3.1, Table 4-3, pp. 4-17 to 4-18  |
| Over 1.8 m in diameter, or over 20 m long at any diameter            | Engineered cost estimate                              | IAM 4.3.3.1(4), 4.3.6(8)(m); ECE Procedures Item M |
| More than one barrel, a box or arch, or an embedded culvert, any size | Engineered cost estimate (special structure)          | IAM 4.3.6(8)(p); ECE Procedures Item P            |

Exactly 1.8 m and exactly 20 m stay in the table. The manual attaches no length limit to the
subgrade inclusion itself; a small pipe over 20 m long is an engineered estimate because of the
length rule.

**Between table entries.** Table 4-3 lists 14 diameters and lengths of 9 m to 20 m in whole
metres. The manual permits no interpolation and states no rounding rule for culverts. For a
diameter or length that is not an entry (a 12.04 m inclined barrel, a 1.1 m pipe, a 7 m pipe) the
line gives the neighbouring entries as a range and no single figure, and the CSV fills
`appraisal_low_cad` and `appraisal_high_cad` instead of `appraisal_allowance_cad`. The length used
is the inclined barrel once both inverts are entered, so a pipe on a grade is usually a little
over a whole metre.

**The engineered estimate's contents** are listed with the treatment: site plan, components and
freight, mobilization of specialized equipment, site preparation and temporary diversion,
foundation and fill envelope, riprap, and approach fills to 15 m from each end where the design
requires them, which are then deducted from the road's subgrade cost (Interior ECE Procedures,
Item M, pp. 45-46). The workspace does not make that deduction: it only states the rule.

### Coast (Coast Appraisal Manual, effective 1 January 2026)

Every round pipe from 0.3 m to 1.8 m is costed per lineal metre from Table 5-4, Column A (CAM
5.3.3.2.3, p. 5-21); the Coast road allowance holds no pipes. There is no length rule. A pipe over
1.8 m is an engineered estimate (CAM 5.3.3.2.2(4)(d)). The manual rounds inputs to fit its tables
and permits no interpolation (CAM 5.3.3.2(3)); between two diameters the line gives both rates.
The Coast manual's treatment of boxes, arches, multiple barrels and embedded culverts was not
read, so those show **Not determined**, never a table figure.

### Adding a manual edition or another jurisdiction

One entry in `culverts/appraisalPacks.ts` (thresholds, table, section references) and one branch
in `appraisalPackForPlace` for where it applies. `culvertAppraisalTreatment` applies any pack
unchanged. `culvertAppraisal.test.ts` holds each transcribed table to the rows read into
`appraisalScope.ts` and to an even step down every column, which a misread digit breaks.

## Major culvert

A separate question from the appraisal's 1.8 m line. Any one of these makes a culvert major
(Engineering Manual glossary, p. xxv; Bridge Standards Manual):

- a round pipe of 2,000 mm or more
- a pipe arch or open-bottom arch with a span over 2,130 mm
- an opening area over 3 m²
- a design discharge of 6 m³/s or more

A major culvert needs a professional engineer's design, record drawings and inspections at most
three years apart. The line turns amber and Review's row needs attention.

- The discharge is the peak a **current** drainage check modelled. Without one, a culvert that is
  not major by size reads "not a major culvert by size; the design discharge is not known".
- Table 3-10 of the manual prints the arch span as "≥ 2,130 mm"; the glossary and the Bridge
  Standards Manual print "over", which is used.
- Each barrel is judged on its own opening. The manual does not say how barrels side by side are
  counted.

## Design checks

| Check                    | Rule                                                                                                   | Source                                  | State when it cannot be made            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------- |
| Barrel length            | Horizontal span at least the centred daylight span at this station and skew                            | Road section                            | Not assessed: daylight unresolved       |
| Cover                    | Stream culvert: the greater of 600 mm and half the diameter. Cross-drain: the greater of 300 mm and half | EM 3.5.5.2 p. 171; EM 5.8.6 p. 244      | Not assessed: an invert missing         |
| Gradient                 | Stream culvert at most 10 %. Cross-drain at least 1 %. Over 3 %: "consider outlet protection" is added | EM 3.5.5.2 p. 171; EM 5.8.6 p. 244      | Not assessed: an invert missing         |
| Skew (cross-drains)      | 3° for each 1 % of road grade over 3 %, to 45°. A note: the suggestion beside the entered skew         | EM 3.5.5.6 p. 181                       | Not assessed: road grade unknown        |
| Run to the next culvert  | A note: the longer run beside the culvert, against the spacing table for all three soil classes        | EM 3.5.5.6, Table 3-14, p. 180          | Not assessed: road grade unknown        |
| Stock size               | A note when a round diameter is not in Table 3-13 (400 to 1800 mm)                                     | EM Table 3-13 p. 166                    | —                                       |
| Capacity                 | Barrel-full Manning capacity of every barrel together at least the modelled peak                       | Drainage check                          | Not assessed: no current check; embedded |
| Inlet headwater          | Headwater depth over diameter at most 1.0 at the modelled peak                                         | EM 3.5.5.1.3 pp. 167-169                | Not assessed: no current check; not a round pipe; embedded |
| Embedment (when entered) | Round pipe: the greater of 40 % of the diameter and 0.6 m. Box or pipe arch: 20 % of the rise          | Fish-stream Crossing Guidebook 4.2.1.3  | Not assessed: no depth entered          |
| Design flood             | A note: Q100 for a permanent culvert, Q10 for one on site three years or less                          | FPPR s. 74; EM 3.5.4.3.2                | —                                       |

Review's **Culverts meet the manual's rules** row judges cover, gradient, embedment and inlet
headwater, and names major culverts. Capacity stays with Review's crossing rows; the drainage
rows (**Cross-drain candidates relieved**, **Modelled streams cross the road in a culvert**) print
the modelled capacity as evidence only.

- **Cover is the manual's rule, not the entered minimum.** The engine's own warning still uses the
  culvert's _required cover_ field; a 1.8 m stream pipe with 0.75 m of cover clears an entered
  0.6 m and fails the manual's 0.9 m. Cover is measured from the top of the pipe to the subgrade.
- **Spacing is a note** on each culvert, against all three soil classes at the steepest design grade
  in the run. The road's own reading by soil class, band by band, is the
  [cross-drain spacing guide](#cross-drain-spacing-guide). A grade on a class boundary (3, 6, 9,
  12 %) takes the shorter spacing of the two rows; the manual does not say which. Review's
  **Cross-drain spacing within the limit** row still judges the single limit in the road
  standards.
- **The design flood is a note** because the drainage check uses one storm intensity for every
  culvert. Nothing checks that it is the Q100 or Q10 storm.

### Inlet-control headwater

The Engineering Manual asks for inlet and outlet control to be checked, with headwater at most
the diameter under inlet control, and names nomographs for it. The check uses the equations
behind those nomographs, FHWA HDS-5's inlet-control design equations
(`INLET_CONTROL` in `culverts/engineeringManual.ts`):

- **Round pipes only**, for a projecting, mitered or headwall inlet. Steel and plastic pipes read
  the corrugated-metal coefficients; concrete reads its own, and a mitered concrete inlet has none
  and is not assessed.
- Tailwater, debris and an embedded culvert's bed are not checked.
- **The slope term is held at the nomographs' 2 %**, so the figure is the one a designer reads
  from the nomograph. By the equation a steeper pipe's headwater is slightly lower.
- **Where the coefficients came from.** HDS-5's own file (49 MB) could not be read on
  16 November 2026. The unit constant is from FHWA-HRT-06-138; the coefficients are from a
  secondary listing of HDS-5 Table A.1, and only the rows that listing and this workspace's own
  reading agree on are held. They reproduce the Engineering Manual's round-culvert training
  example: 4.04 m³/s through an 1800 mm projecting corrugated pipe reads HW/D 0.85 on the
  nomograph and 0.87 here, and the 1200 mm trial fails, as it does there
  (`culvertModules.test.ts`). **Confirm the coefficients against HDS-5 before relying on a
  headwater figure for anything but a screen.**

### Outlet control, governing control, overtopping and a suggested size

Three checks and a note follow the inlet-control check. The inlet-control check keeps its own
figure, so a culvert reads exactly as it did before. The figures come from
`culverts/culvertHeadwater.ts`, and the data with its sources is `OUTLET_CONTROL`,
`ROADWAY_OVERTOPPING` and `GOVERNING_CONTROL_LOCATOR` in `culverts/engineeringManual.ts`.
The sources were read from FHWA HDS-5, third edition (FHWA-HIF-12-026, 2012), on 17 November 2026.

| Check | Rule | Source | State when it cannot be made |
| --- | --- | --- | --- |
| Governing headwater | The higher of the inlet- and outlet-control headwater, over the diameter, at most 1.0 at the modelled peak | EM 3.5.5.1.3; HDS-5 3.1.4, DG 1.2 Step 5 | Not assessed: no current check; inverts missing; no Manning n; not a round pipe; embedded; no inlet coefficients; outlet control under 0.75D and its backwater profile could not be worked out |
| Headwater stays below the road | The inlet invert plus the governing headwater is below the lowest road surface over the barrel. The freeboard is stated, and no minimum is set | HDS-5 3.1.5 p. 3.15 | Not assessed: the governing headwater is not known; no point of the barrel lies under the road formation |
| Smallest stock size by headwater | A note: the smallest EM Table 3-13 size whose governing HW/D is at most 1.0 at the same peak, inverts, material, inlet and barrels | EM Table 3-13 p. 166 | Not assessed when the governing headwater cannot be worked out |

- **Outlet control** uses HDS-5's full-flow energy method (Eq. 3.5 and 3.6b, pp. 3.10-3.12),
  in SI units throughout: H = (1 + ke + 19.63·n²·L/R^1.33)·V²/2g with g = 9.81 m/s²,
  and HWo = ho + H − L·So. L is the inclined barrel and L·So the inlet invert less the outlet
  invert. The approach and outlet velocities are neglected, as in HDS-5's hand method.
- **The tailwater is not known.** No channel rating is held, so ho is (dc + D)/2, with dc never
  more than D. `fullFlowOutletControl` accepts a known tailwater (`tailwaterM`), which sets ho
  where it is higher. No project field stores one yet.
- **ke comes from Table C.2 (p. C.6).** A corrugated pipe takes 0.9 projecting, 0.5 with a
  headwall and 0.7 mitered. A smooth-wall plastic pipe and a pipe with no material set take the
  corrugated values, because the table has no plastic row. Concrete takes 0.2 projecting
  (groove end, the inlet its inlet-control coefficients describe), 0.5 with a square-edged
  headwall and 0.7 mitered.
- **Manning n** is the material's (EM 3.5.5.7). With no material it is the drainage check's own n.
- **The method's range.** HDS-5 says to use the approximation with caution below 1.2D and not at
  all below 0.75D, where it asks for a backwater calculation (3.1.4 p. 3.12; 3.3.3 p. 3.24).
  Below 0.75D outlet control is read from a **backwater profile** instead
  (`backwaterOutletControl`, `culvertHydraulics.ts`): a gradually varied flow profile carried up
  the part-full round barrel from the outlet by the standard step method (Chow, _Open-Channel
  Hydraulics_, 1959, ch. 10), `BACKWATER_STEPS` steps with Manning friction averaged over each.
  It starts at the tailwater or critical depth, whichever is higher (a free outfall passes
  critical depth; with no tailwater known it is critical depth). The headwater is the inlet's
  specific energy plus ke·V²/2g, approach velocity neglected as in HDS-5's hand method. Where
  the profile reaches the crown, the rest of the barrel is carried at full-flow friction. Where
  Manning normal depth is under critical depth the barrel is **steep**: the outlet does not
  control and inlet control governs. The check, the editor's Hydraulics line and the CSV's
  `outlet_control_method` (`full flow`, `backwater`, `steep barrel`) say which was read.
  Checked against closed forms (`culvertHeadwater.test.ts`): on a level barrel of no length the
  headwater is critical depth's specific energy plus the entrance loss, and up a long mild
  barrel the depth reaches Manning normal depth within 1 %.
- **The road over the barrel** is the lowest subgrade the engine's culvert profile has under the
  formation, raised by the surfacing of the thinner side (its course stack, else its surface
  depth). That gives a **road surface** freeboard, and a second freeboard to the **subgrade
  shoulder**, which is where HDS-5's worked examples measure it. Only the road along the barrel
  is read. HDS-5 notes that overtopping usually begins at the road's sag low point, which may
  lie away from the culvert.
- **The suggested size never changes a diameter.** It keeps the culvert's barrels, material,
  inlet and inverts, and reads outlet control the same way, by backwater below 0.75D.
- **Checked against HDS-5 Design Guideline 1.3, Example Problem No. 1** (Culvert Design Form,
  p. DG1.4). The example is worked in US customary units, converted here to SI: 200 ft³/s,
  tailwater 3.5 ft, a 200 ft barrel on 1 %, ke 0.2. The 60 in and 54 in concrete trials reproduce
  the form's outlet-control elevations of 105.5 ft and 107.0 ft to within 0.02 m. The 72 in
  corrugated trial reads 105.4 ft against 105.5 ft. The 60 in corrugated trial reads 108.5 ft
  against 108.9 ft, the gap between the equation and a reading of the nomograph; both are over
  the allowable 108 ft (`culvertHeadwater.test.ts`).
- **Review's culvert row** judges the governing headwater and the road over it as well as cover,
  gradient, embedment and inlet headwater (`readiness.ts`).

**Schedule columns.** The culvert schedule CSV adds these columns after `evidence`, so no earlier
column moves:

- `fall_one_in`: horizontal span over the drop
- `inlet_depth_to_invert_m` and `outlet_depth_to_invert_m`: ground less the invert
- `road_surface_over_invert_m`: the road surface at the centreline less the invert there
- `inlet_control_hw_m`, `outlet_control_hw_m`
- `governing_control` (`inlet`, `outlet` or `not determined`)
- `governing_hw_m`, `governing_hw_over_d`
- `headwater_elevation_m`
- `road_surface_low_m`, `freeboard_m`
- `suggested_diameter_m`

The editor and the report print the same figures on one **Hydraulics** line
(`culvertHydraulicsText`).

### Natural-channel screens

Stream culverts only, and only where a channel is known: the culvert schedule, report, CSV and Review read the stream width ratio from the crossing stream's recorded **Channel width**; the 3 × area screen needs a section read from the terrain, so it prints under that reading in the stream's panel ([Streams and constraints](streams-and-constraints.md#channel-read-from-the-terrain)) and not in the schedule (`culvertChannels.ts`).


| Check                          | Rule                                                                                                            | Source                                                   | State when it cannot be made |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| 3 × bankfull area (stream)     | Opening (every barrel) at least 3 × the candidate bankfull area. A note on a major culvert                       | Engineering Manual (rev. 2018) s. 3.6.7, p. 79, Fig. 3-4  | Not assessed: no usable channel reading; embedded |
| Stream width ratio (stream)    | Channel width ÷ culvert width (barrels add): under 1.0 low (0 points), 1.0-1.3 moderate (3), over 1.3 high (6)   | BC MoE (2011) closed-bottom fish passage field assessment | Not assessed: no width; a note on an open-bottom arch |

- **The area check is the manual's high-water estimation method,** which takes the high-water
  (mean annual flood, Q2) cross-section as A = (W1 + W2)/2 × D and the Q100 opening as 3 × A, for
  non-major stream culverts only, and not as the sole method for a professional design. Here A is
  the area of the candidate bankfull section read from the terrain, not a crew's high-water
  section. Where the bed may be a water surface the area is a lower bound: an opening short of
  3 × that bound is not met, and one clearing it is not assessed, never met.
- **The width ratio is a screen, not a fish-passage status.** The protocol scores five measures
  (embeddedness, outlet drop, stream width ratio, slope, length) in the field; this reads one of
  them. It uses the stream's recorded channel width when there is one, else a usable terrain
  candidate, and says which. The protocol measures the channel downstream; the candidate is read
  upstream. Barrels side by side add their widths, as the protocol adds pipes at one outlet level.
- **Where the bands came from.** The ratio's definition (channel width ÷ culvert width) and the
  example "1.2 scores 3" are from the Ministry of Environment's own paper on the method (Thompson,
  "Assessing Fish Passage at Culverts"); the band edges 1.0 and 1.3 are from a secondary listing of
  the 2011 protocol's table. Confirm them against the protocol before relying on a score.
- **The Engineering Manual edition.** The section numbers are from the 1 August 2018 revision
  (s. 3.6.7). The checks above cite a later revision's numbering (s. 3.5.5); find the method's
  section in that edition before printing both together.

## Cross-drain spacing guide

**Review → Cross-drain spacing guide** reads the Engineering Manual's cross-drain spacing table
along the active road (`culverts/crossDrainSpacing.ts`, data in `CROSS_DRAIN_SPACING` and
`CROSS_DRAIN_PLACEMENT`, `culverts/engineeringManual.ts`). It is BC guidance beside the design: it
places no culvert and never changes the road standards' own spacing limit.

- **The ditch soil's erosion hazard is your entry**, by the soil type making up more than half of
  the ditch (slight: hardpan, rock, coarse gravels; moderate: fine gravels; high: sands, silts,
  clays). It is never read from the terrain, and is saved as `standards.ditchErosionHazard`. A
  project without it, every project saved before it existed included, calculates as before, and
  Review's **Cross-drain spacing within the manual's table** row reads not assessed.
- **Each run between culverts, and from each road end, is held to the shortest limit of any grade
  band it passes through.** The manual reads the grade at the cross-drain, and a run can hold a
  cross-drain anywhere along it. Reading the steepest grade alone picks the wrong limit where the
  table rises with grade: on high-hazard soil 9–12 % allows 75 m and over 12 % 100 m with a
  rock-lined ditch, so a run of 10 % then 14 % is held to 75 m. The guide names the band that
  governs and, where it differs, what the steepest grade alone would read.
- **Grades are the design grades at the calculated stations.** Each interval is split at its middle,
  each half taking its own station's grade, so no grade is invented between two that were
  calculated. A run with part of its length ungraded is *not determined* unless the graded part
  already puts it over.
- **Placed by site.** Sag low points in the profile (`curvePoints`) and switchbacks (a curve turning
  `SWITCHBACK_TURN_DEG` or more, the route search's own hairpin angle) are listed in their run: the
  manual puts a cross-drain at a low point whatever the spacing, and asks for spacing by site at a
  switchback. Neither decides the row. Junctions, steep uphill slopes, seepage, ditchline bedrock,
  cut slope instability and through cuts are listed for the designer to check on the ground.
- **Cross-drains are not stream crossings.** A defined watercourse is designed as a crossing
  (EM 3.5.5.2 to 3.5.5.5); Review judges modelled streams in their own row.
- **For the batch preview**, `crossDrainStretchGuidance` reads any one stretch (start, end, stations,
  hazard) the same way.

| Rule                                   | What is held                                                                                       | Source                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| Maximum spacing between watercourses   | 0–3, 3–6, 6–9, 9–12 and 12+ % by slight, moderate and high hazard; over 12 % on high: rock-line the ditch | EM 3.5.5.6, Table 3-14, p. 180 |
| Spacing reduced below the table        | Junctions, steep uphill side slopes, seepage or piping in cuts, switchbacks (by site)              | EM 3.5.5.6, p. 180            |
| Cross-drain whatever the spacing       | Top of steep sections, seepage zones, low points, ditchline bedrock, before cut instability, before large through cuts | EM 3.5.5.6, pp. 180-181 |
| Cross-drain or stream crossing         | A defined channel is a stream crossing, not a cross-drain                                          | EM 3.5.5.6, pp. 179-180       |

Provenance: read on 17 November 2026 from the Engineering Manual, 25 May 2026 edition. The table is
printed as Table 3-14; the text around it calls it Table 3-15. The table prints its rows with shared
boundaries (3, 6, 9, 12 %) and does not say which row a boundary takes.

## Shape, barrels, material and the other optional fields

Each is optional. A culvert with none of them is one round pipe and calculates exactly as before
they existed; a field put back to its first choice is removed from the project file.

| Field        | Choices                                           | What it changes                                                                                         |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Shape        | Round pipe, box, pipe arch, open-bottom arch      | End area, capacity, class, appraisal treatment. The **diameter** field is then the opening's rise       |
| Span         | Width of a box or arch, m                         | End area and class. Blank: equal to the rise                                                            |
| End area     | An arch's end area as its supplier states it, m²  | Blank: an ellipse of span and rise, which every line that uses it calls approximate                     |
| Barrels      | 1 to 6                                            | Capacity and installed cost (per-metre cost × barrels); the peak is shared for headwater                |
| Material     | Corrugated steel 0.024, smooth-wall plastic 0.010, concrete 0.012 (EM 3.5.5.7 p. 183) | Its Manning n replaces the drainage check's for this culvert. Not set: the check's |
| Inlet        | Projecting, mitered, headwall                     | The headwater check only                                                                                |
| Embedment    | Depth of streambed inside a closed-bottom culvert | Adds the embedment check; capacity and headwater become not assessed; an engineered estimate (Interior) |
| Time on site | Permanent, or temporary (three years or less)     | The design-flood note only                                                                              |

- **Capacity of a box** uses its own wetted perimeter. **An arch** is read as the round pipe of the
  same end area, and says so.
- **An embedded culvert's streambed is not deducted** from the opening, so its capacity and
  headwater are not assessed rather than overstated. The Guidebook requires the design flood to
  pass after embedment.
- **The drainage check's channel is unchanged**: one cell wide along the barrel whatever the shape.
- **RoadEng files carry none of these.** A RoadEng design or traverse export writes the diameter
  (the rise of another shape) as before; shape, span, barrels, material, embedment and inlet stay
  in the PGMaps project file only.
- A culvert read from a RoadEng traverse with a box width keeps that width in its RoadEng record;
  it is not turned into a box here.

## Inlet side

A culvert's inlet is its left end looking up-station unless **Inlet side** says right
(`inletSide`, `culverts/culvertInlet.ts`). It is optional like the fields above: absent is left,
left is never stored, and a culvert without it calculates exactly as before
(`engineering.test.ts`, `designSurface.test.ts`). The barrel's line is the same either way; the
side sets which end the inlet invert, the profile's first sample, the cover and grade, the ditch
dip (the inlet side's ditch), the drainage check's channel, the schedule's inlet and outlet
coordinates and the plan's flow arrow belong to. The invert fields are named for the side
(`left inlet invert` or `right inlet invert`). A RoadEng traverse culvert that flows to the road's
left reads with its inlet on the right. Batch placement proposes a side and asks the designer to
confirm it ([Drainage](drainage.md#placing-cross-drains-in-a-batch)).

## Culvert schedule export

Save & export → GIS data → **Culvert schedule** (`.csv`), one row per culvert of the active road,
under the road's own station names (`station`) and chainage (`station_m`). It is refused while an
input is invalid, like the station CSV.

The `appraisal_*` columns are the manual's figures and are not part of the estimate.
`construction_cost_cad` is blank for a culvert whose installed cost a current crossing record
replaces; `construction_cost_basis` says so. `checks_not_met` and `checks_not_assessed` list the
checks in words. Columns are fixed in `CULVERT_SCHEDULE_COLUMNS`.

The printed report carries the same rows under **Culvert schedule**, in the _Costs, materials,
culverts and haul_ section.

## How a culvert is drawn

- **Plan.** Two thin lines across the road, the barrel's walls, at the barrel's own length and
  skew, as RoadEng draws one. Blue, red when the culvert has a warning, heavier when selected; never
  amber, the road's colour. There is no label on the plan: a click opens the culvert's card (station,
  opening, span or barrel length, cover, grade, skew, warnings), and the card lists every other
  culvert within `CULVERTS_TOGETHER_M`, whose lines would sit on top of one another
  (`CulvertCard.tsx`). An arrow leaves the outlet along the barrel (`culvertFlowArrow.ts`): the
  inlet-to-outlet direction as entered, not a computed flow, so an adverse barrel still points to its
  outlet and its warning says why.
- **3D.** The barrel as a shaded tube from inlet invert to outlet invert, with the opening that faces
  the camera drawn dark (`culvertBarrel.ts`). A box is square-cornered; the other shapes are an
  ellipse of span and rise. The opening keeps its true shape under the view's height exaggeration,
  and the axis its true elevation. It is drawn over the road and fill, as RoadEng's see-through fill
  shows it. Under `BARREL_MIN_OPENING_PX` across it is drawn as a line along its axis, and with
  either invert unknown it is not drawn. One barrel is drawn however many the culvert has.
- **Profile.** The opening at its station, drawn to the profile's own scales: its rise upward from
  the invert where the barrel crosses the centreline (the engine's sample at the barrel's middle),
  and its width along the road the span ÷ cos(skew), the width the barrel cuts the profile's plane.
  A round pipe or an arch is an ellipse in the profile's vertical exaggeration, a box a rectangle.
  A line from the crown up to the design grade is the cover there, and the tag gives the figure
  ("600 mm · cover 1.42 m"). That is the cover at the centreline; the tooltip also gives the
  engine's least cover, the figure every check and the schedule use. Smaller than
  `CULVERT_PROFILE_MIN_PX` (6 px) either way, the opening is drawn at that size with a dashed
  outline, its invert line still at its true level, and the tooltip says it is not to scale: at a
  whole road on screen a pipe is under a pixel across, so this is the usual case until you zoom to
  a few hundred metres. With either invert missing nothing is drawn below grade: the tag stays and
  reads "inverts not entered". Culverts at one station keep stacked markers, each with its own button
  (`Inspect structure <name> at <station>`). The tags go through the profile's one label pass
  (`placeLabels`) after every other label, keep clear of the vertical-curve labels, and try each
  side of their marker and three tiers out before giving way to the tooltip. Geometry: `culvertProfileMark`, `culvertLongSection.ts`.
- **Long section.** Engineering → Structures draws the selected culvert along its barrel, left inlet
  to right outlet: the ground (a gap where terrain is missing, never bridged or drawn at zero), the
  road's design surface read across the barrel from the analysed sections either side of its station
  (negative offsets left, so the inlet end is the left side of the road), the fill over the barrel
  shaded, the formation the cover is measured to, the barrel as a band from invert to crown, and a
  dashed line at crown plus the manual's cover (`requiredCoverM`) over the formation, where the
  engine measures cover. The heading gives the fall from the engine's grade, as a percent and as
  "1 in X"; each end its invert, or "not entered"; the least-cover point is marked at the engine's
  own sample with the engine's figure beside the manual's. The vertical exaggeration is printed. The
  design surface ignores the small change of road grade along a skewed barrel; the formation and
  every figure are the engine's. Display only: nothing drawn here reaches a figure, the schedule or
  an export.

## Limits and budgets

| Limit                                 | Value                               | Enforcement                                          |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Barrels per culvert                   | 1 to 6, whole                       | `MAX_CULVERT_BARRELS`, `CULVERT_OPTION_LIMITS`       |
| Span                                  | 0.1 to 20 m                         | `CULVERT_OPTION_LIMITS.spanM`                        |
| End area                              | 0.01 to 400 m²                      | `CULVERT_OPTION_LIMITS.openingAreaM2`                |
| Embedment                             | Up to 5 m, and less than the rise   | `CULVERT_OPTION_LIMITS.embedmentM`, `culvertOptionProblems` |
| A size or length "is" a table entry   | Within 0.5 mm                       | `ENTRY_TOLERANCE_M`                                  |
| Interior subgrade line                | Under 0.95 m                        | `BC_INTERIOR_2026.inSubgradeBelowDiameterM`          |
| Engineered estimate, diameter         | Over 1.8 m (both manuals)           | `engineeredAboveDiameterM`                           |
| Engineered estimate, length           | Over 20 m (Interior only)           | `engineeredAboveLengthM`                             |
| Major culvert                         | 2.0 m; span 2.13 m; 3 m²; 6 m³/s    | `MAJOR_CULVERT`                                      |
| Cover floors                          | 0.6 m stream, 0.3 m cross-drain     | `COVER_RULES`                                        |
| Headwater limit                       | HW/D 1.0                            | `HEADWATER_LIMIT`                                    |
| Inlet-control equation ranges         | Unsubmerged to 3.5, submerged from 4.0, a straight line between | `INLET_CONTROL`          |
| Same-station culverts in the plan card | Within 2 m along the road          | `CULVERTS_TOGETHER_M`                                |
| 3D barrel drawn as a line             | Opening under 5 px across           | `BARREL_MIN_OPENING_PX`                              |
| Profile opening drawn at least        | 6 px either way, dashed when not to scale | `CULVERT_PROFILE_MIN_PX`                       |
| Plan flow arrow shaft                 | 0.2 × span, 1.5 to 4 m              | `FLOW_ARROW_SHARE`, `FLOW_ARROW_MIN_M`, `FLOW_ARROW_MAX_M` |
| Outlet-control friction constant | Ku 19.63 (SI) | `OUTLET_CONTROL.kuSI` |
| Entrance loss ke | 0.2 to 0.9 by material and inlet (Table C.2) | `OUTLET_CONTROL.entranceLoss` |
| Outlet approximation not read | Below HW/D 0.75: a backwater profile is read instead | `OUTLET_CONTROL.approximateFloorHwOverD` |
| Backwater profile steps | 60 along the barrel | `BACKWATER_STEPS` |
| Outlet approximation, caution | Below HW/D 1.2 | `OUTLET_CONTROL.cautionBelowHwOverD` |
| Suggested sizes | EM Table 3-13, 400 to 1800 mm | `STOCK_DIAMETERS_M`, `HEADWATER_LIMIT` |
| Section upstream of the crossing    | 20 m along the stream line     | `NATURAL_CHANNEL.upstreamM`                  |
| Section half-width                  | 20 m                           | `NATURAL_CHANNEL.halfWidthM`                 |
| Sample spacing                      | The terrain's cell, never finer; at most 401 samples | `sampleChannelSection`, `maxSamples` |
| Thalweg window and tie              | ±8 m; 3 cm                     | `thalwegSearchM`, `thalwegTieM`              |
| Stage step and ceiling              | 0.05 m to 4 m                  | `stageStepM`, `maxDepthM`                    |
| Least bankfull depth                | 0.15 m                         | `minBankfullDepthM`                          |
| Bench                               | 20 m/m and 3 × the median below | `benchIndexMin`, `benchIndexFactor`         |
| Level bed                           | 1 cm over 2 m and 3 samples    | `levelToleranceM`, `levelRunMinM`, `levelRunMinSamples` |
| Too coarse                          | Under 4 cells across; unread over 2 m cells | `coarseCellsAcross`, `coarseCellM` |
| Area factor                         | 3                              | `HIGH_WATER_AREA_RULE`                       |
| Stream width ratio bands            | 1.0, 1.3                       | `STREAM_WIDTH_RATIO`                         |
| Switchback in the spacing guide       | A curve turning 110° or more        | `SWITCHBACK_TURN_DEG`, `crossDrainSpacing.ts`        |
| Curves read as one turn               | Tangent between them under 20 m     | `SWITCHBACK_JOIN_M`, `crossDrainSpacing.ts`          |

These bounds keep inputs sane and state the manuals' thresholds; they are not design tolerances.

## How problems show up

- **"Table 4-3, Part A: between entries, $6,728 to $7,248".** The diameter or length is not a table
  entry. Usually the inclined barrel is a few centimetres over a whole metre. The appraisal's
  entry is the reader's to confirm.
- **"Not determined".** A Coast project with a box, an arch, more than one barrel or an embedded
  culvert. The Coast manual's rule for it was not read.
- **"No cost location is set: the Interior manual is shown by default."** Set the cost location in
  the cost dialog.
- **Review's spacing-guide row is "not assessed".** Enter the ditch soil's erosion hazard in
  Review → Cross-drain spacing guide.
- **Capacity and headwater "not assessed" on every culvert.** No drainage check, or the check is
  out of date since the road, a culvert or the terrain changed. Run it again.
- **Cover fails here but the engine shows no cover warning.** The entered _required cover_ is
  lower than the manual's rule for this size and purpose.
- **A culvert reads "Not calculated".** It lies beyond the road's end and is left out of the
  calculation; the engineering warnings name it, and Review's row does not count it.

## What it does not do

- Size a culvert, choose a structure or decide fish passage. It never changes a diameter.
- Model a tailwater from the channel, run a backwater profile beyond the barrel, or read overtopping at the road's low
  point away from the barrel; check scour, riprap size, debris or ice.
- Size by the 3 × bankfull method (the screen only judges an opening against a terrain candidate),
  or pick a storm. Time of concentration is the drainage check's per-culvert option
  ([Drainage](drainage.md)).
- Deduct approach fills from the subgrade, or build an engineered cost estimate.
- Read the Interior manual's road group 1 hybrid rules, baffled or headwalled culverts, or "dry"
  installations: tell these apart by hand.
- Draw a box or an arch to shape on the plan or section (the profile and the 3D view draw a box
  square and an arch as an ellipse), draw more than one barrel, or carve it wider than one cell in the
  drainage check.
