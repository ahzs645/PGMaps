# Builder tables and review charts

The tables and charts a builder, an approver and a reviewer read off a design, beyond the profile,
section and plan. They follow the BC Engineering Manual (25 May 2026) §3.5.3, which lists what a
geometric road design should provide, and §5.6.5 / Table 5-10 for staking, and the EGBC/FPBC
_Professional Services in the Forest Sector: Forest Roads_ guideline (v2.0, 10 October 2024),
§3.5.1–3.5.2 and §5.2.4. Every figure is the analysis's own; nothing here feeds a calculation.

Code: `stationExtras.ts` (per-station figures), `builderSchedules.ts` (stake book and clearing
schedule), `quantitySchedule.ts` (schedule of quantities and assumed equipment), `curveElements.ts`
(curve table), `reviewCharts.ts` (chart data). All are free of DOM and network access; their tests
are `builderTables.test.ts`.

## Station table columns (Stations → Samples)

Beside the volume columns, **Choose columns** offers the builder's columns, read from the
calculated sections (`sectionCodePoints`), the same points the stakeout CSV writes:

| Column             | What it is                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| CL C/F             | Ground minus formation at the centreline: + cut, − fill                                                            |
| Grd last, next     | Design grade from the previous calculated station and to the next one (RoadEng's Grd.Lst / Grd.Nxt)                |
| CL E, CL N         | Centreline in the project's grid (the terrain's EPSG, else local UTM)                                              |
| Stake L, R         | Slope stake (catch point) distance from the centreline                                                             |
| Stake C/F L, R     | Catch ground minus the hinge: the ditch bottom in cut where there is one, else the formation edge                  |
| Ditch D, Ditch grd | Formation edge minus ditch bottom, and the ditch-bottom grade from the previous station                            |
| Clear L, R, W      | Clearing limit each side and the width between them                                                                |
| X-fall L, R        | Running-surface crossfall, superelevation included                                                                 |
| _Material_ V       | Bank cut of each ground material since the previous row (RoadEng's layer volumes); the materials add up to Cut vol |

The material volumes are `EngineeringStation.materialCutVolumesM3`, kept on the same terms as each
material's `bankCutM3` (preparation included, the interval's curvature scale applied), so the
columns total to the Materials tab. Column choices are kept in this browser
(`pgmaps-road-station-columns-v2`); the first version's hidden list is read once.

There is no "backwater" quantity: RoadEng's `BKW Vol` column is its borrow/waste volume, which the
Borrow and Waste columns give once haul allocation is on.

## Slope-stake book (Stations → Stakes)

One row per station to stake: the calculated station nearest every 20 m (10, 25 or 50 m to
choose), both ends, every BC/EC (TS/ST) and BVC/EVC, every culvert, and every station whose
centreline or catch is cut or filled more than 3 m (`STAKE_DEEP_M`) — Table 5-10's control points.
A stake reads as on the lath: `C 1.2 / 4.5` is 1.2 m of cut from the catch down to the hinge,
4.5 m out from the centreline. The hinge column shows its offset, `D` where it is the ditch bottom.
The CSV adds hinge and catch elevations and grid coordinates. It is a guide only, as the manual
says: stake from the field survey.

## Clearing schedule (Stations → Clearing)

Station by station, as §3.5.3 asks ("generally tabular"): sidehill and its uphill side, subgrade
width, catch and clearing distance each side, clearing width, and the area since the previous row.
The areas add up to the analysis's clearing area at any interval (average end widths over complete
intervals, as `engine.ts` measures it). A width over the job's clearing limit
(`DesignStandards.maxClearingWidthM`) is red. The manual's Tables 5-1 to 5-9 (clearing width by
subgrade width and side slope) are not encoded; this schedule is the design's own widths.

## Mass haul under the profile, balance points and sites

The profile pane's picker has **Profile + mass haul**: the diagram under the profile on the same
zoom and stationing. Under the diagram, **Balance points** lists the loops on the zero balance line
(`balanceWhatIf` at 0, read only like the what-if line): from, to, direction, volume, mean haul and
overhaul past the free-haul distance, and whether a loop is open at a road end. With haul allocated
it also lists the sites used: kind, station, access distance, volume used and capacity.

## Schedule of quantities and equipment (Quantities → Schedule)

Clearing (ha), grubbing (ha), stripping, rock and other excavation, embankment, surfacing gravel,
free haul, overhaul, end haul, borrow, waste, culverts and the cut-to-fill factor, each with what it
is measured on. Grubbing is **assumed** to be the footprint between the catch points; a
specification may grub a margin beyond it, or nothing under deep fill.

**Equipment assumed for moving material** is the designer's entry, never inferred: a task
(`EQUIPMENT_TASKS`), the machine, notes, and the quantity that task works on. It is stored in the
project as `standards.equipment` (`parseAssumedEquipment`, at most `MAX_ASSUMED_EQUIPMENT` rows);
older files without it read as before.

## Curve table (Stations → Curves)

PI station, tangent length T, total length L, long chord C, external E and middle ordinate M beside
the radius and BC/EC. Without spirals these are the simple curve formulas. With spirals, T and E use
the spiral shift p = Ls²/24R and offset k = Ls/2 − Ls³/240R² (unequal spirals give unequal back and
forward tangents, shown on hover), and C and M are the circular arc's. The PI station is the curve
start plus the back tangent. The curve CSV appends these columns after its existing ones.

## Section readout

The section's status block adds **Grd Lst/Nxt** and **CL E/N** (in the project's grid).

## Profile additions

- **Ground layers**: each entered horizon is drawn under the profile's ground line at the
  centreline, a band where it has a bottom and a dashed line at its top. Display only.
- **Super e** (value bands): both edges of the running surface about the centreline from their
  crossfall, tinted where a curve is superelevated.

## Review charts (Quantities → Charts)

Not deliverables any source requires; each helps review.

- **Grade distribution**: share of the designed length in 2% grade classes, split climbing and
  descending up-station; classes past the grade limit are red.
- **Cumulative cost along the road**: the estimate spread by the cost dialog's own attribution
  (`costAttribution.ts`), with what has no place on the road stated.
- **Earthwork by station**: cut above and fill below the line per round stretch, unknown stretches
  hatched.

## Clearing lines on the plan

With **Earthwork** shown, the plan draws each side's clearing limit as a green dashed line through
the complete stations (`clearingLineFeatures`, `preparationFootprint.ts`), broken where a section is
incomplete, at the distance the clearing schedule prints. They share the `road-corridor` source; its
fill layer is filtered to polygons so a line is never closed into an area. The legend lists them
as _Clearing limit_.

## Printing

The report (HTML and PDF) has six sections for these (`builderReportHtml.ts`), each one a checkbox
in Save & export → Report → Contents and a part of the report package:

| Section                                | Package default |
| -------------------------------------- | --------------- |
| Schedule of quantities (and equipment) | In package      |
| Balance points                         | In package      |
| End haul summary                       | In package      |
| Record of changes                      | In package      |
| Clearing schedule                      | Appendix        |
| Slope-stake book                       | Appendix        |

The plot book has two chapter kinds, **Slope-stake book** and **Clearing schedule**, tabulated at
the chapter's report station interval over its range.

## End haul (Quantities → Schedule)

End haul is cut the haul plan trucks off the road to a waste site (never side-cast) or moves in the
end-haul class (`endHaul.ts`). Sources within `END_HAUL_JOIN_M` are one section; each section gives
its stations, length, bank volume (no swell), mean haul distance with site access, destinations and
steepest sidehill. A section shorter than 20 m (the 2002 Coast minimum) or a move trucked under
10 m is marked.

The rules come from the Coast Engineering Cost Estimate (ECE) Procedures, effective 1 January 2025,
Type 6 (pp. 24–26): end haul is material trucked at least 10 m because it cannot be side-cast, for
downslope over 55% below the road prism or soil unsuitable as fill, a sensitive site, or unstable
terrain identified by a terrain stability assessment. The Interior ECE Procedures (July 2024, item
E, pp. 18–19) use 60% or a sensitive site. The 2002 _Detailed Engineering Estimates_ End Haul Form is
superseded (it became the ECAS39 screen), so no form is reproduced. The qualifying reason is the
designer's to state; the report lists the evidence the procedures ask for (plan, profile,
cross-sections, mass haul, cut and fill volumes, volumes by material, and a terrain stability
assessment or a professional's rationale, which is supplied separately).

**Equipment hours sheet** writes the ECE Project Equipment Hours Summary (January 2025) layout as
CSV: its header fields (the road name, start and end station and length filled, the licence, cutting
permit, ECAS Id and the rest left blank), six machine columns named from the assumed equipment with
make and model left blank, and dated rows of operating and standby hours to fill from time cards.
Hours are never estimated here.

## Record of changes (record drawings)

For record drawings (Engineering Manual §5.2.4; EGBC/FPBC §3.9.2), keep the design as issued as a
copy of the road (**Duplicate road**), edit the road to the field record, and choose the copy under
Save & export → Report → Contents → _Issued design for the record of changes_
(`reportSettings.recordBaselineId`). The report then compares the two (`recordChanges.ts`): length,
point counts, cut, fill, clearing and steepest grade side by side; stretches where the centreline
moved more than `RECORD_PLAN_TOLERANCE_M` (0.5 m) or the formation by more than
`RECORD_LEVEL_TOLERANCE_M` (0.1 m), sampled every `RECORD_SAMPLE_M` (10 m); and culverts added,
removed, moved or resized. It lists differences only; conformance is the professional's to judge,
and neither the Engineering Manual nor the guideline lists what a record drawing must contain.

## Not done yet

- The issue stamp has no "record drawing" status of its own; say so in the revision or issue note.
