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
| Run to the next culvert  | A note: the longer run beside the culvert, against the spacing table for all three soil classes        | EM 3.5.5.6 p. 180                       | Not assessed: road grade unknown        |
| Stock size               | A note when a round diameter is not in Table 3-13 (400 to 1800 mm)                                     | EM Table 3-13 p. 166                    | —                                       |
| Capacity                 | Barrel-full Manning capacity of every barrel together at least the modelled peak                       | Drainage check                          | Not assessed: no current check; embedded |
| Inlet headwater          | Headwater depth over diameter at most 1.0 at the modelled peak                                         | EM 3.5.5.1.3 pp. 167-169                | Not assessed: no current check; not a round pipe; embedded |
| Embedment (when entered) | Round pipe: the greater of 40 % of the diameter and 0.6 m. Box or pipe arch: 20 % of the rise          | Fish-stream Crossing Guidebook 4.2.1.3  | Not assessed: no depth entered          |
| Design flood             | A note: Q100 for a permanent culvert, Q10 for one on site three years or less                          | FPPR s. 74; EM 3.5.4.3.2                | —                                       |

Review's **Culverts meet the manual's rules** row judges cover, gradient, embedment and inlet
headwater, and names major culverts. Capacity stays with Review's crossing and drainage rows.

- **Cover is the manual's rule, not the entered minimum.** The engine's own warning still uses the
  culvert's _required cover_ field; a 1.8 m stream pipe with 0.75 m of cover clears an entered
  0.6 m and fails the manual's 0.9 m. Cover is measured from the top of the pipe to the subgrade.
- **Spacing is a note** because the manual's maximum depends on the ditch soil's erosion hazard,
  which the project does not hold. The road grade used is the steepest design grade in the run. A
  grade on a class boundary (3, 6, 9, 12 %) takes the steeper class, the shorter spacing; the
  manual does not say which. Review's **Cross-drain spacing** row still judges the single limit in
  the road standards.
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
- **Outlet control is not checked.** Neither is tailwater, debris or an embedded culvert's bed.
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
  (`CulvertCard.tsx`).
- **3D.** The barrel as a shaded tube from inlet invert to outlet invert, with the opening that faces
  the camera drawn dark (`culvertBarrel.ts`). A box is square-cornered; the other shapes are an
  ellipse of span and rise. The opening keeps its true shape under the view's height exaggeration,
  and the axis its true elevation. It is drawn over the road and fill, as RoadEng's see-through fill
  shows it. Under `BARREL_MIN_OPENING_PX` across it is drawn as a line along its axis, and with
  either invert unknown it is not drawn. One barrel is drawn however many the culvert has.

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

These bounds keep inputs sane and state the manuals' thresholds; they are not design tolerances.

## How problems show up

- **"Table 4-3, Part A: between entries, $6,728 to $7,248".** The diameter or length is not a table
  entry. Usually the inclined barrel is a few centimetres over a whole metre. The appraisal's
  entry is the reader's to confirm.
- **"Not determined".** A Coast project with a box, an arch, more than one barrel or an embedded
  culvert. The Coast manual's rule for it was not read.
- **"No cost location is set: the Interior manual is shown by default."** Set the cost location in
  the cost dialog.
- **Capacity and headwater "not assessed" on every culvert.** No drainage check, or the check is
  out of date since the road, a culvert or the terrain changed. Run it again.
- **Cover fails here but the engine shows no cover warning.** The entered _required cover_ is
  lower than the manual's rule for this size and purpose.
- **A culvert reads "Not calculated".** It lies beyond the road's end and is left out of the
  calculation; the engineering warnings name it, and Review's row does not count it.

## What it does not do

- Size a culvert, choose a structure or decide fish passage. It never changes a diameter.
- Check outlet control, tailwater, overtopping, scour, riprap size, debris or ice.
- Apply the 3 × bankfull sizing method, compute a time of concentration or pick a storm.
- Deduct approach fills from the subgrade, or build an engineered cost estimate.
- Read the Interior manual's road group 1 hybrid rules, baffled or headwalled culverts, or "dry"
  installations: tell these apart by hand.
- Draw a box or an arch to shape on the plan, profile or section (the 3D view draws a box square and
  an arch as an ellipse), draw more than one barrel, or carve it wider than one cell in the drainage
  check.
