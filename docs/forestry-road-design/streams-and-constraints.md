# Streams, constraints and terrain profiles

**Terrain** keeps these three jobs apart. **Streams** holds each reach and its evidence, **Constraints**
holds areas the road keeps out of or pays to cross, and **Terrain profiles** holds saved ground profiles
and samples any mapped line. Opening a stream shows its assessment; **View terrain profile** is an action
inside that view.

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

## Cost groups

The Design tab's **Crossing prices** used to call its price label a class. It is a **cost group**: a name
for a price you choose. It has no link to the riparian class, and saved groups keep their meaning.

## Riparian areas on the map and in search

`riparian.ts` draws the class's reserve and management widths as **preliminary horizontal screening
buffers**. The outer search envelope is channel half-width + reserve + management. The reserve band
includes the channel half-width; the outer management envelope includes the inner band. Colours and
legend entries distinguish reserve, management and unresolved extent. Hiding streams hides these map
bands but never disables their route constraints.
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
