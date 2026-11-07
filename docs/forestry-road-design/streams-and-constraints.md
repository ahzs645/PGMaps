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
- **A review records what it rested on.** Changing the width, fish or watershed status, the 1 km average
  or the reach geometry reads as **Needs review**, and restoring them clears it.
- **Older projects** open with their streams unassessed.

## Cost groups

The Design tab's **Crossing prices** used to call its price label a class. It is a **cost group**: a name
for a price you choose. It has no link to the riparian class, and saved groups keep their meaning.

## Constraints

An area with no cost is **excluded**, so route search cannot enter it. Entering a cost per metre lets the
search cross it at that extra cost. The cost is a routing input and does not make crossing the area
permissible.

## Not done yet

Stream crossings still price from the route-search allowance. A stable crossing record for each road,
structure options, shared estimates and corridor loading of provincial data are later work. The class
does not yet draw riparian areas on the plan or constrain route search.
