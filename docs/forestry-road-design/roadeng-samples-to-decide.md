# RoadEng files that would settle what is still inferred

PGMaps reads, calculates and writes back RoadEng projects from Softree's public samples, tutorials
and knowledge-base examples. A few RoadEng settings never change in any of those files, so how
RoadEng stores them is still unknown or only inferred. Each section below names the small RoadEng
file that would settle one of them. Every file starts from a public design and changes one setting,
so a single file answers a single question. Softree's free trial of RoadEng is enough to make them.

Until a file comes back, PGMaps keeps what it cannot read as read, never writes a guessed bit, and
says so in the import or export notice. The [RoadEng sections of Exports and project
files](exports-and-project-files.md#importing-a-roadeng-design) describe what is read today.

## Making and returning the files

- Start from the design named in each section, with its terrain beside it, and change only what the
  steps say. Any other change in the same file makes its bytes ambiguous.
- Keep the design's units: LongRoad, Location 18 and Hart Rd are in metres; Road6 is in feet.
- Use **Apply** in the dialog, recalculate, **Re-Cost** where a section asks for costs, then **Save
  As** under the name given. Keep the original beside it so the two can be compared byte for byte.
- Put the files in a folder outside this repository, like Softree's other samples (never commit
  them), and point a test at it the way `ROADENG_HUNT` points at the downloaded tutorials. The
  section's last line names the code to change once its question is answered.

Where the starting designs come from:

| Design                            | Source                                                             | Read by tests through                 |
| --------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `LongRoad 1.dsnx`                 | Softree's LongRoad sample                                          | `ROADENG_SAMPLES`                     |
| `Location 18_1.dsnx`              | V11 tutorials, RoadEng Resource, `Location` folder                 | `ROADENG_SAMPLE_PACK`, `ROADENG_HUNT` |
| `Location 13_3.dsnx`, `25_4.dsnx` | V11 tutorials, RoadEng Resource, `Location` folder                 | `ROADENG_HUNT`                        |
| `Road6 - 16.dsnx` and its terrain | V10 tutorials, RoadEng Resource (the LiDAR chapter's Road6 series) | `ROADENG_HUNT`                        |
| `Hart Rd optimal haul.dsnx`       | V10 tutorials, Softree Optimal                                     | `ROADENG_SAMPLE_PACK`                 |

## 1. Outside widening Auto

**Question.** Which bit of a curve record's flag word (`108` field 9) is the outside **Widening
Auto** box: bit 12 (4096), or bit 5 (32) cleared? In every public design the two change together.

**Make.**

1. `LongRoad 1.dsnx`, Horizontal Curves panel, PI 45 (flag word 5590): untick only the outside
   Widening Auto box, **Apply**, save as `outside-auto-off.dsnx`.
2. `Location 18_1.dsnx`, PI 1 (flag word 1521): tick only the outside Widening Auto box, **Apply**,
   save as `outside-auto-on.dsnx`.

**Read.** Compare that curve's field 9 with the original: the bit that moves alone is the box.

**Then.** Today `roadEngAutoWideningOutside` reads outside Auto only where the two candidates
agree, and the writer never touches either (`roadEngOutsideAutoNote` names the curve instead).
Once known, read and write the one bit.

## 2. Superelevation Auto and how RoadEng picks f max

**Question.** Three settings in field 9 are still unknown:

- the bit of the **superelevation Auto** box itself. Bit 1 is **Use Minimum Radius**
  (`ROADENG_MINIMUM_RADIUS_BIT`) and bit 8 is "by table" rather than "by side friction factor";
- bits 0 and 2, which look like the Radius and Design Speed Auto boxes;
- where RoadEng's automatic maximum side friction comes from.

**Make.** In `Location 18_1.dsnx`, change four curves and save once as `superelevation-bits.dsnx`:

1. Auto on, **Use table**, Max Side Friction typed.
2. Auto on, **Use side friction factor**, Auto Max Side Friction set to **Use pre-defined values
   (AASHTO 2001)**.
3. As 2, with Auto Max Side Friction set to **Use table**.
4. Superelevation Auto unticked, superelevation typed as 3 %.

Untick the Radius Auto box on curve 1 and the Design Speed Auto box on curve 2.

**Read.** Each curve's field 9 and field 11 (f max) against the original.

**Then.** Curve 4 gives the bit that lets PGMaps write a typed superelevation that RoadEng keeps.
Today such a value is written and the export notice says RoadEng recalculates it unless the box is
unticked.

## 3. Culvert vertical position and shape

**Question.** A placed culvert's record (`LocationN.ds1`, `roadEngPlacedCulverts.ts`) keeps its
vertical-position option among field 9's bits 3, 4, 5, 6 and 8, and its shape in fields 10–12.
Every public culvert is a round pipe, and only one vertical-position option appears.

**Make.** In `Location 18_1.dsnx`, culvert at 573.2 m:

1. Set **Vertical Position** to each option in turn, **Apply**, and save after each as
   `vp-cut.dsnx`, `vp-fill.dsnx`, `vp-minfill.dsnx` and `vp-attach.dsnx`.
2. Back on the original, set Culvert Properties to:
   - a rectangular box 1.2 × 0.9 m, saved as `shape-box.dsnx`;
   - a pipe arch, rise 1.0 m and span 1.5 m, saved as `shape-arch.dsnx`;
   - an open-bottom arch, saved as `shape-oba.dsnx`.
3. Back on the original, untick Gradient **Auto** and **SemiAuto**, saved as `grad-manual.dsnx`.

**Read.** The culvert's record in `Location1.ds1`, field 9 and fields 8 and 10–12 against the
original.

**Then.** Today the depth (field 8) is shown and never applied, and shapes other than a round pipe
are not read. Once known, `readPlacedCulvert` applies the vertical position and reads the shape.

## 4. Exact fill and template layer materials

**Question.** A plain fill row in `[LocationParms]` is RoadEng's **Replaceable** fill (that
material or any of the same or higher quality), and PGMaps reads it that way. Where RoadEng marks
a fill type with Replaceable **unticked** is unknown. The same applies to a template layer's
material (`[TemplatesSct] RoadSurfaceCodes-<n>`, read as `templateLayerMaterials` and not yet
applied).

**Make.**

1. `Location 13_3.dsnx`: **Assign by Range → Fill Types**, select the CO range, untick
   **Replaceable**, **Add/Edit**, **OK**. Save as `fill-exact.dsnx`.
2. `Location 25_4.dsnx`: **Template Materials**, set Srf4 to FR with Replaceable ticked. Save as
   `layer-replaceable.dsnx`.
3. On the original `Location 25_4.dsnx`, assign the same through **Fill Types → Other Materials**.
   Save as `other-materials.dsnx`.

**Read.** The changed `[LocationParms]` row and `RoadSurfaceCodes-<n>` key against the original.

**Then.** `roadEngFillWriteBack` can write an exact requirement, which today it names as not
written. Template layer materials can become fill requirements on their layers.

## 5. Whether RoadEng's cut cost includes stripping

**Question.** RoadEng's **Site Prep** (`[LocationParms]` fields 2–10, `roadEngSitePreparation`)
strips the top ground layer. The samples disagree on whether the stripped volume is inside the
**cut** figure of RoadEng's stored costing:

- on Hart Rd, PGMaps' cut alone matches;
- on Road6 - 16, only cut plus stripping matches.

**Make.** `Road6 - 16.dsnx` with its terrain: set the Site Prep depth to 0 on every range,
recalculate, **Re-Cost**, and save as `Road6-16 no strip.dsnx`.

**Read.** `OptParms_CostSolution_v3` (`readRoadEngStoredResults`) against the original's: if the
cut falls by about the stripped volume's cost, cut includes stripping.

**Then.** `compareRoadEngDesignResults` sets the road's stripping cost on the matching side of the
comparison.

## 6. Walls and SubCut I

**Question.** Walls I–IV are mapped only from Softree's component library, because no public
design assigns one. SubCut I's depth is described as "measured from the attachment point", but
PGMaps measures it from the lower of the subgrade and the ground. The two disagree in fill.

**Make.** `Road6 - 16.dsnx` with its terrain (in feet). For each row below:

1. In the Template Editor, copy the LOWV template.
2. Add the component from the e-Library folder with the values given.
3. Assign the copy over 0+500 to 0+800 (**Assign by Range**).
4. Recalculate, **Re-Cost**, and export the **Areas** report.
5. Save the design. Return it with its Areas file.

| Question                 | Component and values                                                                                 | Save as                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| Wall I geometry, cover   | Wall I, left: WallOffsetX 12, WallTopWidth 3, bWallIncludeSG 1, WallCoverHt 2                        | `Road6-16 wall I.dsnx` + Areas   |
| Wall III gabion steps    | Wall III, right: WallSetback 3, BlockHeight 3, BlockWidth 3, WallSlope 5                             | `Road6-16 wall III.dsnx` + Areas |
| Wall IV backfill         | Wall IV, right: WallHeight 6, WallThick 1, WallFactor 1.5, bBackFillToTopo 0, WallBackfillSlope −0.3 | `Road6-16 wall IV.dsnx` + Areas  |
| SubCut I depth reference | SubCut I, last in the template, over a fill stretch: SubCutDepth 1, widths 10                        | `Road6-16 subcut I.dsnx` + Areas |

**Read.** Open each design with its terrain, then open the Areas file in **Compare with RoadEng…**,
which compares it station by station. The SubCut I file is the most useful of the four.

**Then.** Correct the mapping in `roadEngConstruction.ts` / `sectionStructures.ts` where the
areas disagree, and add the walls' cover width, toe backfill and layers, which are listed under
"Not carried over" today.

## 7. Pit opening and attributes costs

**Question.** In the stored cost solution (`OptParms_CostSolution_v3`), fields 5–7 are haul, cut
and fill. Fields 8 and 9 are inferred as pit opening and attributes, because every public costing
holds 0 or no value there.

**Make.** `Hart Rd optimal haul.dsnx`: **Vertical Options → Pits**, set a site preparation cost of
$10,000 on Pits 1, 4 and 5 (as the Softree Optimal tutorial's chapter 7 does), **Re-Cost**, save as
`pits-siteprep.dsnx`.

**Read.** Field 8 should hold 10,000 or 30,000 (one charge or three). The pit records'
site-preparation field (`OptParms_Pit-n`) shows where that cost is kept.

**Then.** Name field 8 as read from a sample in `roadEngStoredResults.ts`. Field 9 (attributes)
needs a design costed with a cost-bearing attribute; where RoadEng enters such a cost is not in
its documentation that was found.
