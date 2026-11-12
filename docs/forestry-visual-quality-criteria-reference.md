# Visual quality: wording, tables, factors and criteria (reference, November 2026)

Every definition, table, conversion factor and decision rule found in the 26
documents of the [report survey](forestry-visual-quality-report-survey-2026-11-11.md),
set against the _Visual Impact Assessment Handbook_ (BC Ministry of Forests, 2022) as the baseline, and against what `/dev/forestry/visual-quality` encodes
in `via.ts` and `vqo.ts`.

Topics run in the order of the procedure. Each one gives the handbook's text
first, then the variants found in practice, then the page's position. Document
numbers are the survey's. Section numbers (3.4.1, Table 6, App 2) are the
handbook's unless named.

The verbatim transcriptions, with page numbers, are kept **outside the
repository** with the source files: `~/Downloads/via/_catalogue/` holds one
file per document group and a copy of the handbook. They are not committed, for
the same reason as the sources.

## 1. The objective: the five classes

### FPPR s.1.1 (handbook Table 1, verbatim)

Each class shares one stem: "consisting of an altered forest landscape in which
the alteration, when assessed from a significant public viewpoint, is". It then
continues:

| Class                | Symbol | Continues                                                                                                                                                   |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preservation         | P      | "(i) very small in scale, and (ii) not easily distinguishable from the pre-harvest landscape"                                                               |
| Retention            | R      | "(i) difficult to see, (ii) small in scale, and (iii) natural in appearance"                                                                                |
| Partial retention    | PR     | "(i) easy to see, (ii) small to medium in scale, and (iii) natural and not rectilinear or geometric in shape"                                               |
| Modification         | M      | "(i) very easy to see, and is (ii) (A) large in scale and natural in its appearance, or (B) small to medium in scale but with some angular characteristics" |
| Maximum modification | MM     | "(i) very easy to see, and is (ii) (A) very large in scale, (B) rectilinear and geometric in shape, or (C) both"                                            |

The handbook adds: "If forest stewardship plans include VQO definitions as part
of their results or strategies, they must be identical to those described in
FPPR Section 1.1."

**Variants found:**

- **04 (FREP 2008 protocol):** defines PR as "small to _moderate_" and "not _angular_ or geometric". That is not the regulation's wording.
- **21 (Board, Appendix 1):** reprints the definitions with mis-numbered clauses.
- **20 (MPB study glossary):** has its own definitions of the visual quality classes.
- **16 (slide 19):** two layouts at the same **7%** rate PR (two small openings) and M (one merged, angular opening). Scale and shape decide, not the number.

**The page** holds the FPPR wording in `VISUAL_QUALITY_CLASSES.description` and never the FREP variant. Keep it that way.

### Words used in the definitions (handbook App 1, "not legal interpretations")

| Term                       | Handbook glossary (verbatim)                                                                                                     | Page (`VISIBLENESS_TERMS`, `SHAPE_TERMS`)                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Not easily distinguishable | "Not visually apparent."                                                                                                         | Same                                                                          |
| Difficult to see           | "Requires much effort or skill to discern visually. Peripheral, obscured, or extremely distant."                                 | "Takes effort to discern. Peripheral, obscured, or very distant." Paraphrased |
| Easy to see                | "Able to discern visually without great effort or difficulty. Directly in sight or unobscured."                                  | "Seen without great effort. Directly in sight or unobscured." Paraphrased     |
| Very easy to see           | "Able to discern visually with little effort or difficulty. An immediately identifiable, visually dominant feature."             | "Immediately identifiable. A visually dominant feature." Paraphrased          |
| Natural                    | "Existing in or caused by nature … (irregular organic shapes, curvilinear lines, or a diffuse or dispersed pattern or texture.)" | Shortened                                                                     |
| Angular                    | "Having angles or sharp corners. (… 90-degree right angle corners.)"                                                             | Shortened                                                                     |
| Rectilinear                | "Contained by, consisting of, or moving in a straight line or lines. (… straight cutblock boundary lines and roads …)"           | Shortened                                                                     |
| Geometric                  | "Characterized by regular lines or shapes. (… squares, rectangles, triangles, and circles.)"                                     | Shortened                                                                     |

**Other vocabularies in use:**

- **22, 23** (attributed to FPPR s.1.1, which does not contain them):
  - They add each term's viewing duration, e.g. "Very Easy to see … as seen from single to multiple viewpoints of long duration".
  - They add a sixth visibility term, "**Extremely Easy to see** – … dominates the view, as seen from multiple stationary or continuous viewpoints of long duration (>1 minute)".
- **01:**
  - Visibility runs "Not visible, difficult to see, easy to see, very easy to see".
  - Scale is a seven-step list: "very small, small, small to moderate, moderate, moderate to large, large, very large".
- **21 (Board):** gives working meanings.
  - Very easy to see: "an observer requires almost no effort to see it".
  - Easy to see: "some effort is needed and … the observer might miss it when glancing at the scene".
  - Large in scale: "carries significant visual weight in the scene", increased by a "perpendicular view".
  - It also cites colour, texture and shape contrast, and a "horizontal orientation of the cutblock's rectilinear shape … opposed to the underlying pyramid-shaped landform".
- **2001 guidebook form (03, 05; also 22 and 23's "level of impact"):** "Not visible, Not visually evident, Subordinate, Dominant, Out of scale". The form prints no definitions.

**Change:** quote the handbook glossary verbatim in the page's (i) text. Keep
the Board's working meanings as reviewer help, labelled as the Board's. Map the
2001 terms only for reading older VIAs, never as inputs.

## 2. Scale and percent alteration

### Handbook Table 2 (and App 1, "% altered (policy)")

| VQO                  | Scale (FPPR s.1.1) | Most probable % landform alteration |
| -------------------- | ------------------ | ----------------------------------- |
| Preservation         | Very small         | 0%                                  |
| Retention            | Small              | 0–1.5%                              |
| Partial retention    | Small to medium    | 1.6–7%                              |
| Modification         | Large              | 7.1–18%                             |
| Maximum modification | Very large         | 18.1–30%                            |

The source is _Clearcutting and Visual Quality: A Public Perception Study_
(MOF, 1996). The handbook adds: "The numbers in Table 2 provide average results
from public perception studies and do not explicitly account for visual
landscape design, site disturbance, and tree retention."

The summary form's scale bar puts ticks at **0, 1.5, 4, 7, 12, 18, 24, 30+**.
Those are the class breaks plus a midpoint in each range, where the reviewer
marks the ocular class and the adjusted figure.

**Variants found:**

| Source                     | Printed                                                                                                             | Difference                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 02 (Kamloops Region table) | "P=0%; R<1.5%; PR<7%; M<18%; MM<30%"                                                                                | Strict upper bounds                                         |
| 05                         | "Less than 7.0 percent alteration" for PR                                                                           | Strict                                                      |
| 22, 23                     | Very small 0, Small 0–1.5, Small to medium **1.5**–7, Large 7.1–18, Very large 18.1–30                              | 1.5 is both R's top and PR's bottom; the body text says 1.6 |
| 11–15 (referrals)          | "should generally not exceed 1.5% / 7% of the perspective view of the landform from a significant public viewpoint" | A single cap, no floor                                      |
| 18 (Bear Lake, 2001)       | Retention "between 0-2%" for clearcut, patch cut and clearcut with reserves                                         | Wider R                                                     |
| 16 (slide 17)              | Same as Table 2                                                                                                     | —                                                           |
| 20 (MPB study)             | Scenes labelled MM at 13.8–13.9% and 38.8%; M at 5.5–6.2%                                                           | Specialists' labels, not % bands                            |

**The page:** `perspectiveMaxPercent` holds 0 / 1.5 / 7 / 18 / 30, inclusive at the top, which is Table 2. 7.0 is PR and 7.05 is M. A strict-"<" reading would put 7.0 in M. The page is right to follow Table 2 and should say so beside the figure. Above 30% the page reads MM; the bar's "30+" agrees.

### Planimetric (timber supply), for contrast

From _Procedures for Factoring Visual Resources into Timber Supply Analyses_
(1998), held in `vqo.ts`:

| Class | Table 3 range | Table 4 by VAC (low / medium / high) |
| ----- | ------------- | ------------------------------------ |
| P     | 0–1%          | 0 / 0.5 / 1                          |
| R     | 1.1–5%        | 1.1 / 3.0 / 5                        |
| PR    | 5.1–15%       | 5.1 / 10.0 / 15                      |
| M     | 15.1–25%      | 15.1 / 20.0 / 25                     |
| MM    | 25.1–40%      | 25.1 / 32.5 / 40                     |

No VIA in the set uses planimetric figures. Bear Lake's 0–2% and the MPB
study's "% of total area" are the only non-perspective numbers.

## 3. How percent alteration is measured (3.4.2)

The handbook form's lines are a, b and c:

- a) "% of landform altered by proposed openings"
- b) "% of landform in access roads (outside openings)"
- c) "% non-VEG contribution of existing openings"

**X = a + b + c**, measured "as seen in perspective view" and "relative to an
identifiable landform". The handbook adds: "It is important to include all
existing non-visually effective greened-up alterations into the simulation."

**As practised:**

| Source | Numerator                                             | Denominator                                 | Unit                         |
| ------ | ----------------------------------------------------- | ------------------------------------------- | ---------------------------- |
| 03     | Proposed + non-VEG                                    | "Landform 1" (the formula label says "VSU") | Render pixels                |
| 04     | Visible block fragments                               | Combined-VSU landform                       | Image-plane area             |
| 05     | Proposed + non-VEG                                    | Landform/VSU "net of private land and rock" | cm² on print                 |
| 06, 07 | Proposed (+ "not visually greened up")                | Landform − rock (− private land)            | cm²                          |
| 09     | Proposed + non-VEG                                    | **Gross** landform (net computed, not used) | cm²                          |
| 22     | Non-VEG + proposed + other sale's and CP-ready blocks | Landform − private land                     | Pixels                       |
| 23     | Non-VEG + proposed                                    | Landform (private land left in)             | Pixels                       |
| 20     | Cutblocks and roads                                   | Landform                                    | Planimeter on 8½ × 11 prints |
| 02     | Existing not greened up + proposed                    | "VLU" (the inventory unit)                  | Not stated                   |

**Rules attached to the measurement:**

- **Shoreline (App 3):**
  - "If you are greater than 1 km from the landform, map to the shoreline … exclude those portions of the landform screened by foreground vegetation."
  - "If you are 1 km or less from the landform, map to the top of the foreground trees."
- **Rock:** 22 excludes "significant areas of non-vegetated land such as rocky mountain slopes" from the landform. 05, 06, 07 and 09 net rock out.
- **Utility corridors:** 22 and 23 say they are "not considered as an 'alteration'" (a permanent feature "not subject to management to the VQOs"). 26 treats a transmission line as existing disturbance.
- **Private land:** netted out (05, 06, 22), left in (23), or drawn "trees down" as a worst case "so that the conclusions of the VIA hold true regardless of the land use changes on private land" (22). The Board notes that 05's simulation "shows private lands … as bare because FRPA requirements do not apply there".
- **Several VQOs on one landform (3.3.2):** "map the boundaries of the VQO polygons onto the landform in perspective view … use the landform and VQO boundaries to define landform sub-units".
- **Several VSUs in one landform:**
  - 04 combined them and applied the stricter objective, adding a "narrow ridgetop sliver" to "the much larger" unit it is seen with.
  - 22 took "the dominant VSU polygon".

**The page:** X is apparent (perspective) area by sightline. Lines a, b and c are the proposed openings, the visible roads and disturbance, and the not-greened-up existing openings. Masks net natural non-green ground; private land and permanent disturbance stay in the land base and add nothing. That matches 05 and 06 for rock, and 22 for corridors. It differs from 22 on private land: the page keeps it in the denominator.

**Change:**

- Name the denominator rule on every figure.
- Offer private land netted out as an option for reproducing a consultant's figure.
- Add landform sub-units for two VQOs on one landform.

## 4. Adjustments (3.4.3)

### Table 3 design elements: Good −1, Moderate 0, Poor +1

The page holds this table exactly (`DESIGN_ELEMENTS`):

| Element                                    | Good (−1)                                             | Moderate (0)                                                    | Poor (+1)                                            |
| ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Response to visual force lines          | Strong                                                | Force lines not apparent                                        | Weak or no response                                  |
| 2. Borrows from natural character          | Fully                                                 | Partially                                                       | Isolated or not at all                               |
| 3. Incorporates edge treatments            | Feathering and irregular boundaries present           | Either feathering or irregular boundaries present               | Neither aspect present                               |
| 4. Distance from the viewpoint             | >8 km                                                 | >1 and <8 km                                                    | <1 km                                                |
| 5. Position of opening on the landform     | Lower down & to one side                              | Small opening near center                                       | High on the landscape or large near center           |
| 6. Number, size and spacing of alterations | Three or more openings with variable size and spacing | One or two openings, or limited variability in size and spacing | Three or more openings with similar size and spacing |

The handbook's prose still says "The sum of the five components"; the table and
the form list six.

**Variants found:**

- **22, 23** rate seven elements Good/Moderate/Poor without scores:
  - force lines, natural character, edges ("Heavy dispersed retention across the block acts as feathering"), **islands/patches**, distance, position, overall design;
  - **distance Poor under 2 km, Moderate 2–5 km, Good over 5 km**;
  - "N/A" for a block not visible.
- **2001 form (03, 05)** asks yes/no questions instead:
  - "Have major lines of force been identified and used …? (If Yes, attach visual force analysis)"
  - "borrowed from the natural character"
  - "edge treatments … (feathered edges, irregular cutblock design, etc.)"
  - "'islands,' or patches of trees … maintained"
  - "existing human-made alterations visible in the unit that exhibit poor design?"
- **01** adds "Existing Human-made present? Angular & Geometric (Poor), Small to Moderate but Angular (Moderate), Natural Appearing (Good)".

### Table 4 roads, landings and sidecast

The page holds this table exactly (`ROADS_VISIBILITY`):

| Description                                                     | Factor |
| --------------------------------------------------------------- | ------ |
| No roads or sidecast are visible                                | 0      |
| Roads or sidecast are visible, but subordinate in the scene     | +1     |
| Roads or sidecast are significantly visible, but small in scale | +2     |
| Roads or sidecast dominate the scene                            | +3     |

### Table 5 tree retention

The page holds this table exactly (`RETENTION_LEVELS`):

| Description                                           | Factor |
| ----------------------------------------------------- | ------ |
| Less than 15% tree retention (rated Low)              | 0      |
| Tree retention levels between 15–22% (rated Moderate) | −1     |
| Greater than 22% tree retention (rated High)          | −2     |

The handbook also says (3.4.3.3): "If tree retention is aggregated and has been
netted out of the block in the percent alteration calculation, it is not
considered as an adjustment factor a second time."

### The handbook's own form disagrees with its tables

The App 1 form prints the roads row as **"none subordinate significant
dominant"** and the retention row as **"Good Moderate Poor"**, with **no
scores**. Practitioners scored the form's words, and not the tables:

| Form         | Roads ticked → scored | Retention ticked → scored |
| ------------ | --------------------- | ------------------------- |
| 06 VP2       | none → **+1**         | Moderate → 0              |
| 06 VP5       | none → **−1**         | Poor → **+1**             |
| 07 VP3       | none → 0              | Poor → **+1**             |
| 07 VP5       | none → **−1**         | Poor → **+1**             |
| 07 VP1, 2, 4 | subordinate → **0**   | Poor/Moderate → 0         |

Read against Tables 4 and 5:

- "none" is always 0 and "subordinate" is +1.
- Retention is never positive. **Good = High (over 22%) −2, Moderate = 15–22% −1, Poor = Low (under 15%) 0.**

01 shows the same reading of "Good": "Retention Good (>22%)".

**Change:** label the page's retention choices with both vocabularies, e.g.
"Good · over 22% retained (high) · −2", and the roads choices with the form's
one-word labels. A reviewer copying from the form then lands on the table's
score. The checker in the survey should flag a positive retention factor or a
non-zero "none".

### The adjusted figure

"X*(1 + 0.14*Y)" (3.4.3), with Y = design + roads + retention. With six
elements, Y runs from −8 to +9. Below about Y = −7.1 the factor turns negative;
the page holds the result at 0, and the handbook does not address it.

These worked figures check against the handbook formula:

| Source | X × factor  | Result |
| ------ | ----------- | ------ |
| 06 VP2 | 7.8 × 1.42  | 11.08  |
| 06 VP3 | 12.4 × 1.28 | 15.87  |
| 06 VP5 | 2.5 × 0.44  | 1.10   |
| 07 VP3 | 2.8 × 0.86  | 2.41   |

App 9's sample sheets, with the Y their figures imply:

| Sample          | Ocular class | Unadjusted → adjusted | Implied Y                           |
| --------------- | ------------ | --------------------- | ----------------------------------- |
| Hwy 3 rest stop | R            | 1.1 → 0.5             | −4 (1.1 × 0.44 = 0.48)              |
| Edna Lake       | R            | 1.6 → 1.2             | −2 (1.15)                           |
| Coquihalla Hwy  | **PR**       | 1.4 → 0.8             | −3 (0.81)                           |
| Harrison Lake   | PR           | 7.1 → 6.1             | −1 (6.11)                           |
| Lillooet South  | M            | 11.0 → 9.4            | −1 (9.46)                           |
| Phillips Arm    | M            | 8.5 → 9.5             | +1 gives 9.69; the sheet prints 9.5 |

Coquihalla is the handbook's own case of the ocular class (PR) outranking the
number (R). These six belong in `via.test.ts`.

## 5. Partial cuts (3.4.4)

**Handbook Table 6**, "Visual equivalent to clearcut percent alteration factors
for partial-cut alterations". Rows are volume removed 10–90%; columns are mean
residual height 5–50 m. The page's `PARTIAL_CUT_EQUIVALENT` holds every cell
exactly. Its code comment calls it "FS1252 Table 4", the 2001 guidebook's
number; it is Table 6 in the 2022 handbook.

**The confidence notes differ by source:**

- **Handbook:** "Since there is a 50% confidence level in the visual equivalent to clearcut alteration numbers, results near the VQC boundaries will have considerable uncertainty attached to them." Partial cuts and clearcuts on one landform: "add the clearcut percent alteration numbers with the partial cut 'visual equivalent to clearcut' numbers".
- **16 (slide 18, "Table 10 – Predicting VQOs for Partial Cuts"):** gives classes, not numbers, and every class matches Table 6 read through Table 2. Its note says "a **90% or better chance** of achieving the VQO shown, within 10–40 m tree height". The two notes describe the same table with different confidence. Print the handbook's.
- **01 ("Partial Cut Harvesting Alteration Guide"):** the same classes, except two cells (20% removed at 25 m and 30 m) labelled PR but coloured R inside the R boundary. Table 6 gives 1.2 and 1.4 there, which is R.

**Older and other units in use:**

- **2001 form (05):** "What percent volume or stems retention is proposed? %Volume Remaining / % Stems Remaining", assessed "by volume or stems remaining … as outlined in _Visual Impacts of Partial Cutting_ (1997)".
- **02 (Kamloops Region):** "assessed more by basal area, volume, and stems remaining rather than by scale of alteration".
- **18 (Bear Lake):** removal capped at "40 - 50% of the stems / volume" for Retention, citing the "Partial Cutting to Meet VQO's Study".
- **11–15 (wildfire referrals):** "approximately 50% of trees will be retained" and "35% … still considered a high retention partial cut" (14); "only one third of the timber removed" (15).
- **02 (dispersed retention):** "10–15 mature stems/ha". **21:** "10 to 15 trees per hectare".

**Change:** keep Table 6 as the only conversion. Accept stems and basal area
only as a reviewer-stated estimate of "% removal", with the unit recorded beside
it. Never convert silently: stems and volume differ in a stand of mixed sizes.

## 6. Final rating (3.5.1, Table 7)

| Rating          | Handbook Table 7 (verbatim)                                                             | App 1 form                            | 22, 23                                      |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| Well met        | "Definition achieved and % alteration well within VQO range"                            | Same                                  | Same                                        |
| Met             | "… may be near boundary or **somewhat** in excess of VQO range"                         | "… may be near boundary or in excess" | "… % alteration **in excess** of VQO range" |
| Inconclusive    | "Definition on class boundary and % alteration may be in excess of VQO range"           | Same                                  | Same                                        |
| Not met         | "Definition not achieved and % alteration may be near boundary or within range for VQO" | Same                                  | "… within VQO range"                        |
| Clearly not met | "Definition not achieved and % alteration is in excess of VQO range"                    | Same                                  | Same                                        |

Rule: "In cases where there are different results from the two methods, the
basic VQC (ocular) is considered the primary determining factor." The form says
"The definition is the primary determining factor."

The page's `VIA_RATINGS` follows the handbook's wording. Table 7 gives no number
for "well within"; the page's `WELL_WITHIN_SHARE` (the top fifth of the range is
"near the boundary") is the page's own and is labelled so.

**Decision rules stated across the set:**

- **All viewpoints:**
  - 02: "VQO's must be achieved from all viewpoints."
  - 05: "Visual quality objectives must be achieved from all selected viewpoints."
  - The Board found non-compliance from two viewpoints of four (21).
  - 04 treated a viewpoint where the block is seen only "potentially … through the trees" as an exception, "for demonstration, not for application".
- **Which criteria matter most:**
  - 05: "three criteria (the first two being the most critical ones): (1) meeting basic definition and intent of VQO, (2) quality of design, and (3) scale of alteration."
  - 22: "The percent alteration alone cannot determine whether a VQO is met or not met."
- **Cumulative scope:**
  - The handbook includes "existing non-visually greened-up alterations within the landform unit".
  - 2001 form, 04, 05: "all known alterations proposed … for the next 5 years (i.e., all operations proposed by the same or different licensees)".
  - 02: "all proposed operations within the VLU (e.g. other licensee blocks or future blocks)".
- **Existing condition:**
  - "DOES EVC EXCEED ESTABLISHED VQO?" (05).
  - 01: "If No, opportunity may exist to add alteration. If Yes, then detailed assessment by a qualified forest professional and visual specialist is required".
  - 04: "Does the EVC in adjacent units exceed the established VQO for those units?"
- **Foreground (04):**
  - "Is the visible portion of proposed alteration within 1 kilometre of the viewing locations?"
  - Then the screen's type ("Deciduous / Coniferous / Mixed Forest / Landform"), whether it hides the operation ("YES / NO / Partial"), whether it is designed properly and whether it is windfirm.
  - The handbook (3.0) says the criteria are uncalibrated under about 1 km, which the page flags.
- **When plans change:** "an alternative approach … would have been to redo the VIA when it decided to change the harvesting system" (21).
- **Consult first (02):** "It is strongly recommended that the district visual landscape specialist be consulted prior to carrying out a VIA."

## 7. Viewpoints (3.2)

**What to record (3.2, App 1 3.2.1):**

- GPS longitude and latitude ("degrees, minutes, and decimal seconds")
- elevation (m)
- viewing direction ("compass bearing (0-360°) from the viewpoint to the center of the landform")
- viewing distance ("to the center of the landform that contains the alteration(s)")
- viewpoint importance 1–5
- description ("highway rest stop, boat launch, road junction")
- "Viewpoint Number **_ of _**"

**Viewpoint type, which the form calls importance (3.2.1).** The page holds these as `VIEWPOINT_TYPES`:

1. "Glimpse view, less than 10 seconds"
2. "Sustained side view"
3. "Sustained focal view or traveling toward the alteration for more than one minute"
4. "Viewpoint at a rest stop, campsite, or other static short-term view location"
5. "Viewpoint at the location of a community, commercial tourist-related enterprise, or other static long-term view site"

**Variants:**

- 22 and 23 call this "Significance", from _Effectiveness Evaluation of Visual Impacts_ (MOF 2005). Their labels run "(1) Low … (3) Moderate … (5) High"; 23 adds "(2) Low to Moderate", "(4) Moderate to High".
- 2001 form: importance "Major / Minor / Potential", duration "High / Moderate / Low", distance "Foreground / Midground / Background".

**Other numbers in the handbook:**

- "The highway traveler, moving for example at 90 km/hour, has a cone of vision limited to 50 degrees or less."
- "If there are two or three open views and one glimpse view, the glimpse view will normally be the least important."

**Distance bands in use:**

| Source                            | Bands                                                         |
| --------------------------------- | ------------------------------------------------------------- |
| Handbook Table 3 (design element) | <1 km poor, 1–8 km moderate, >8 km good                       |
| BC VLI zones (page)               | Foreground 0–1 km, middleground 1–8 km, background beyond     |
| 05                                | "Foreground = 0-1km Midground = 1 – 5km Background = 5 –12km" |
| 22, 23 (design element)           | <2 km poor, 2–5 km moderate, >5 km good                       |
| 01                                | Poor (<1 km), Moderate (1 to 8 km), Good (>8 km)              |

## 8. Camera, simulation and presentation

**Lens and eye (App 2, App 7, App 8, 3.2.2):**

- Lens: "Use a 50- or 55-mm lens … Avoid wide-angle or telephoto lenses." "Lens focal length (50 mm recommended)."
- "Human eye equivalency is 57 mm." Take "two sets of photos: one set at a standard focal length …; the second set zoomed in".
- Crop factor: "Nikon DSLR cameras that are not full frame have a crop factor of 1.5; Canon … 1.6." Example: 1.5 × 50 = 75 mm, so use 35 mm (50 / 1.5 = 33.3) for 50 mm equivalence. The form records "Lens Focal Length", "Sensor Crop Factor" and "Adjusted Focal Length".
- Eye height: "Elevation of viewpoint above ground (normally 1.6 m)."
- Table A8.1, HFOV by focal length:

| Focal length (mm) | 12    | 16   | 20   | 24   | 35   | 50   | 70   | 85   | 105  | 200  | 300  |
| ----------------- | ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| HFOV (°)          | 111.1 | 95.1 | 82.4 | 73.7 | 54.4 | 39.6 | 28.8 | 23.9 | 19.5 | 10.3 | 6.87 |

- Viewing distance: "distance from viewer = width of image / [2 x tan (HFOV / 2)]"; example 38.1 cm / [2 tan(19.8°)] = 53.2 cm. Minimum image 25 × 30 cm at arm's length; posters about 61 × 76 cm viewed from 1.2–1.5 m. App 2 gives a minimum report image of 4 × 6 in, preferably 5 × 7 in; App 7 recommends 11 × 17 in plots.

**Photographs:**

- "clear (90% cloud free)".
- "25% overlap minimum" for panoramas, "left to right while staying level", tripod.
- "East-facing units are best viewed in the morning and west-facing units … in the afternoon."
- "The visual absorption under winter versus summer is very different."

**Simulation accuracy checklist (3.3.4):** "Viewpoint coordinates are correct, view angles and directions are correct, simulation focal lengths match the photograph focal lengths, tree heights in the foreground and at the edge of the block are accurate, leave areas are correctly positioned, past alterations … are included …, there is no vertical or horizontal exaggeration, and there are no apparent anomalies." Also: "A good simulation will overlay the pre-harvest field photo and the landscape features should match up."

**What to show on each visualisation (App 7):**

- title, area, viewpoint name or number, GPS
- eye height
- licensee and cutting permit
- existing and proposed blocks and roads with numbers
- average tree height used
- lens focal length
- direction of view, vertical viewing angle, vertical exaggeration ("none recommended")
- producer, date plotted, grid resolution

The plan-view map shows the viewpoint "with centre and cone of vision lines
matching the perspective view", existing and proposed blocks and VSU labels, at
"1:50 000 or larger". The map, plot and photo are oriented alike, with a colour
legend if colours replace labels.

**In practice:**

- 05 recorded "50" as "digital equivalent" on an APS-C body (really 80 mm). 06 and 07 recorded 50 × 1.6 = 80 mm.
- 04 rendered at 45°.
- 18 used three 45° frames.
- Most figures are wide panoramas.

**The page:**

- Eye height 1.6 m matches App 7.
- The road view's 36.9° vertical is about a 35 mm lens; App 2 calls 28–35 mm wide-angle, which "'pushes' landforms away".
- Step 2 already computes HFOV from EXIF (`toolImports.test.ts` expects 39.6° at 50 mm).

**Change:**

- Default the road view's captures to 50 mm (39.6° HFOV, about 27° vertical at 3:2).
- Offer 57 mm, the photo's own adjusted focal length, and a panorama of 50 mm frames.
- Print App 7's fields on every exported view.

## 9. Landforms (3.3.2, App 3)

**Definitions:**

- Landform: "A distinct topographic feature that is a sub-unit of the broader landscape, three dimensional in form, and delineated from a significant public viewpoint in perspective view … generally defined by ridges, drainage channels, valleys, shorelines, and skylines."
- Landscape: "The entire scene viewed at one time from one place."
- VSU: "A distinct topographic unit as viewed from one or more viewpoints and delineated based on the homogeneity of the landscape and biophysical elements. It is equivalent to a polygon in a visual landscape inventory."
- On the difference: "usually the VSU will be larger than a landform and contain more than one homogeneous landform."

**How to draw one (App 3):**

- "Eighty percent of the time landforms are reasonably easy to define."
- Look for "recognizable forms (e.g., conical or pyramidal)".
- "If … a creek draw bisects the topography … independent landforms … are typically created."
- In horizontal landscapes, "distance zones may correspond to distinct landforms".
- "The base of a landform can also be defined by the tops of foreground trees."

**The page:** the terrain landforms (ridge layer seen, face turned to the view) follow App 3's ridge and distance-zone reading. Sub-units for two VQOs, the shoreline 1 km rule and the background sub-landform marked N/A (23) are not built.

## 10. Green-up and recovery

- **Handbook:** green-up counts only as "existing non-visually effective greened-up alterations"; the 2022 handbook gives no heights.
- **The page:** uses the 1998 procedure's Table 6, `VEG_HEIGHT_BY_SLOPE`, area-weighted over slope classes:

| Slope (%)  | ≤5  | ≤10 | ≤15 | ≤20 | ≤25 | ≤30 | ≤35 | ≤45 | ≤50 | ≤55 | ≤60 | >60 |
| ---------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Height (m) | 3.0 | 3.5 | 4.0 | 4.5 | 5.0 | 5.5 | 6.0 | 6.5 | 7.0 | 7.5 | 8.0 | 8.5 |

Its stated assumptions: well stocked, little site disturbance, middleground, vertical viewing angle under 20%.

- **05:** older blocks excluded when they "have met visually effective green-up based on slope, stocking, tree heights and appearance".
- **24, 25 (UKFS adjacency):** a coupe is not felled beside a felled one until the restock reaches **2 m** (Achray) or **1.3 m** (Achnashellach). Achray also uses "5–15 years" between neighbouring coupes.
- **18 (lakeshore management zone):** at most 25% of the zone cut per pass, at most 10% equivalent clearcut area, partial cuts retaining at least 50% basal area, otherwise clearcuts capped at 5 ha. Screening vegetation is assumed at 18 m (20 m on the viewshed map).

## 11. Inventory labels

- **App 1 3.1.3:** "VLI Polygon No. **_ EVC _** VAC **_ VSC _** EVQO **_ Date Est. _** Source Document \_\_\_". The establishing mechanism is one of "FRPA Section 181, GAR Section 7.2, GAR Section 17, or FPPR Section 9.2".
- **VSC (22, 23 footnote):** "expressed on a scale of 1 to 5, with 1 being 'very high sensitivity' and 5 being 'very low sensitivity'".
- **VAC:** "High (H) – Landscape has high ability to absorb alteration and maintain its visual integrity", likewise Moderate and Low.
- **EVC:** "It uses the same categories as the VQO … only current to the most recent VLI."
- **Inventory method (16, slide 9):** "Each landscape unit is assessed using 35 factors, rated for visual sensitivity to forest alterations, and assigned a Visual Sensitivity Class." The sample label is "0005 / PR / M/H/H/H / 3".
- **Legacy labels:** 02 uses "VLU # / VSR / VAC / EVC / VQO" with "Date of Inventory: Unknown". 06 prints "NVS" (not visually sensitive) in the EVQO column. 04 uses "NVS\*\*" for "previously unmapped visible area".

## 12. Public perception (MPB study, 20): context, not regulation

- **Rating scale:** public acceptance rating (PAR) from −3 "Very Unacceptable" to +3 "Very Acceptable", with 0 "Neutral".
- **Colour classes:**
  - Green ≥85% green
  - Red >70% red
  - Grey mostly grey
  - Green-Red: <70% red, the rest green
  - Green-Red-Grey: none above 60%
  - Green-Grey: green under 85%, the rest grey
- **Percent alteration** is defined as "the scale of human alteration to the landscape, including cutblocks and roads, expressed as a percentage of a landform". **Dead forest is not alteration.**
- **Acceptance thresholds:** "6% for all scenes and 8% when Grey or Green-Grey/Grey-Green landscapes were omitted."
- **Tourism (16, slides 25–26, Nimmo Bay 2003):** 77.1% of clients would return to a retention scene, 70.8% to partial retention, 35.4% to modification.

## 13. What to change on the page

From this reference, in order of effort:

1. **Quote the handbook glossary verbatim** in `VISIBLENESS_TERMS` and `SHAPE_TERMS` (section 1).
2. **Fix the code comment:** the partial-cut table is the 2022 handbook's Table 6 (the 2001 guidebook's Table 4). Print Table 6's "50% confidence" note wherever a partial cut adds to X (section 5).
3. **Label Table 4 and 5 choices with the form's words** and the retention percentage, so "Good" lands on −2, never +1 (section 4).
4. **Add App 9's six sample sheets** as rating tests (section 4).
5. **Lens defaults and App 7's caption fields** on exported views (section 8).
6. **Denominator options and landform sub-units:** private land netted or kept; two VQOs on one landform; background sub-landform N/A (sections 3, 9).
7. **The scale bar** with the form's ticks (0, 1.5, 4, 7, 12, 18, 24, 30+) for the ocular mark and the adjusted figure (section 2).
8. **A 2001-form reading table** for older VIAs: Not visible / Not visually evident / Subordinate / Dominant / Out of scale; Major / Minor / Potential; and the 2001 partial-cut "% volume / % stems remaining" (sections 1, 5, 7). Use it for the checker, not as page inputs.
