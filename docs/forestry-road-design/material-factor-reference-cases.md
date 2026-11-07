# Material factor conventions and reference cases

PGMaps keeps one calculation convention: `compactionFactor` is **compacted fill
volume per reusable bank volume**. The optional converter records another stated
ratio, converts it explicitly, and retains the entered ratio with the material.
It does not change the section, material-allocation or haul equations.

Read this with the [material and haul contract](../forestry-road-design.md),
[material allocation guide](material-allocation.md), and
[RoadEng follow-up implementation record](roadeng-follow-up-implementation.md).

## Source and verification status

The source for the tutorial values below is the user-supplied review, supplied as
`Pasted text(4).txt`, of PGMaps commit
`954226199e6051facc313622ee309527800e538b`. That review identifies a 245-page
RoadEng 11 manual dated 20 February 2025 in the
[supplied reference folder](https://drive.google.com/drive/folders/1VbnFAPZb3P1CkCrCM9vrxeLDEDGh432j).
It cites pp. 227–228 and 242 for the factor convention and pp. 242–243 for the
worked areas. These are **values transcribed from the supplied review**; the
primary manual and RoadEng execution were not independently inspected for this
implementation. The manual is not redistributed in this repository.

The review reports that the V10 archives contain Windows installers and that the
V11 tutorial installer was not extracted. No matched tutorial terrain, native
design or exported RoadEng quantity table is used as a test oracle here. The
tests below establish PGMaps' explicit convention and independent conservation
identities, not agreement with RoadEng or OptiHaul.

## Entering a factor

In the road's ground material definitions, the existing **compacted / bank factor**
still edits the canonical value directly. Expand the material's **factor
conversion**, select the convention stated by the source, enter its value and
an optional source note, then apply the displayed conversion. Reusable fraction
remains its own input.

| Entered convention   | Entered ratio `r`                       | Stored `compactionFactor`, `c` |
| -------------------- | --------------------------------------- | ------------------------------ |
| `compacted-per-bank` | Compacted fill / reusable bank          | `c = r`                        |
| `bank-per-compacted` | Reusable bank required / compacted fill | `c = 1 / r`                    |

The conversion does not round the stored result. Displayed decimals may be
shorter. Entered values and reciprocals must be positive and finite; an applied
material must still meet the existing canonical range of 0.1–2.

The quoted RoadEng fill-factor example maps to `bank-per-compacted` **when its
cut factor is 1**, under the ratio described in the supplied review. This is a
conditional example, not a general RoadEng import rule. A non-unit cut factor,
loose swell, density change or truck load volume requires its own stated volume
states and conversion.

### Conservation equations

For bank excavation `B`, reusable fraction `u`, and canonical factor `c`:

```text
reusable bank          = B × u
unusable bank          = B × (1 − u)
usable compacted cut   = B × u × c
bank required for fill = compacted fill / c
```

Reusable fraction represents material suitability or availability independently
of conversion between bank and compacted states. For example, 100 bank m³ with
`u = 0.8` and a bank/compacted ratio of 0.8 gives `c = 1.25`, 80 reusable bank m³,
20 unusable bank m³, and 100 usable compacted m³. Filling 80 compacted m³ consumes
64 bank m³. The remaining 16 reusable bank m³ and 20 unusable bank m³ leave
36 bank m³ to dispose of; `64 + 36 = 100`. The allocation test checks both this
identity and a finite disposal capacity, so a unit error changes feasibility.

## Saved provenance and compatibility

`GroundMaterial.volumeFactorProvenance` is optional in existing v1 project and
road-library JSON. A converted material may contain:

```json
{
  "compactionFactor": 1.25,
  "volumeFactorProvenance": {
    "convention": "bank-per-compacted",
    "enteredFactor": 0.8,
    "canonicalFactor": 1.25,
    "source": "Entered assumption: tutorial review, cut factor 1"
  }
}
```

Project import, project save, reusable-library import and runtime engineering
validation reject malformed, nonfinite, nonpositive or inconsistent records.
The entered ratio must convert to the recorded canonical factor, and that
factor must agree with the material used by the calculation. The comparison
tolerance is `1e-12 × max(1, |a|, |b|)` to accommodate floating-point arithmetic,
not rounded six-decimal imports. An optional source is plain entered text of at
most 500 characters, trimmed on import; it is not a verified citation.

Files without provenance keep their existing meaning and load without a
migration. Changing the canonical factor directly clears the old conversion
record. An unchanged factor, or a change to reusable fraction or another
independent material property, can retain it. Applying a new conversion replaces
the record and canonical factor together. The engine always uses the canonical
factor.

## Independent reference cases added here

All area examples assume cut factor 1 and reusable fraction 1. Area is in m²;
these examples do not assert a volume without an integration length.

| Case                             | Inputs                                                                                       | Independent expected result                                                                                  | Executable check                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct versus inverse ratio      | 100 reusable bank m³, entered ratio 0.8                                                      | Direct convention gives 80 compacted m³; inverse convention gives 125 compacted m³                           | [materialFactors.test.ts](../../src/pages/dev-forestry-roads/materialFactors.test.ts), explicit convention test                                                                       |
| Quoted deficit inputs            | Cut 9.3 bank m², fill 10.6 compacted m², bank/compacted 1.1                                  | Required bank `10.6 × 1.1 = 11.66`; deficit **2.36 bank m²**                                                 | Same file, independent deficit test                                                                                                                                                   |
| Quoted surplus inputs            | Cut 9.3 bank m², fill 10.6 compacted m², bank/compacted 0.8                                  | Required bank `10.6 × 0.8 = 8.48`; surplus **0.82 bank m²**                                                  | Same file, independent surplus test                                                                                                                                                   |
| Separate reuse and volume states | 100 bank m³, reuse 0.8, inverse ratio 0.8, fill 80 compacted m³                              | 64 bank m³ used, 36 bank m³ waste; 35.9 bank m³ disposal capacity is infeasible                              | [materialAllocation.test.ts](../../src/pages/dev-forestry-roads/materialAllocation.test.ts), inverse-factor conservation test                                                         |
| Provenance survives handoff      | Converted material plus source note                                                          | Same ratio, source and canonical factor after project and library round trips; old material files stay valid | [projectEngineering.test.ts](../../src/pages/dev-forestry-roads/projectEngineering.test.ts), optional factor evidence test                                                            |
| Invalid or stale evidence        | Wrong convention, nonpositive/nonfinite ratios, inconsistent canonical value, invalid source | Rejected; a changed direct canonical edit clears the record                                                  | [materialFactors.test.ts](../../src/pages/dev-forestry-roads/materialFactors.test.ts) and [projectEngineering.test.ts](../../src/pages/dev-forestry-roads/projectEngineering.test.ts) |

The supplied review quotes appendix results of 1.3 m² deficit and 2.12 m²
surplus for the two area examples. Neither follows from the stated inputs and
ratio. They are not adopted as expected results. This arithmetic discrepancy
does not establish that RoadEng's software calculates incorrectly; differing or
omitted inputs would need examination in a matched dataset.

## Existing checks retained in the catalogue

These are existing PGMaps model tests, not new external reference comparisons.

| Invariant or failure mode                                                                          | Existing executable case                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classified layers conserve excavation through clipped cut batters                                  | [engineering.test.ts](../../src/pages/dev-forestry-roads/engineering.test.ts), `conserves excavation while integrating exact clipped layers through the cut batters`                                                                                                                              |
| Excavated stripping only follows actual cut; preparation beneath fill is explicit                  | Same file, `reports cut-only stripping separately without changing ground or inventing removal beneath fill`; [sectionAssembly.test.ts](../../src/pages/dev-forestry-roads/sectionAssembly.test.ts), `strips ground beneath a fill, replaces it, conserves excavation and retains source samples` |
| Preparation removal is counted once                                                                | [sectionAssembly.test.ts](../../src/pages/dev-forestry-roads/sectionAssembly.test.ts), `reduces ordinary cut by the removed overburden instead of counting it twice`                                                                                                                              |
| Unusable waste remains bank volume                                                                 | [engineering.test.ts](../../src/pages/dev-forestry-roads/engineering.test.ts), `keeps nonreusable waste in bank units separate from compacted haul metrics`                                                                                                                                       |
| Quality constraints preserve scarce suitable material and do not invent quality for unknown borrow | [materialAllocation.test.ts](../../src/pages/dev-forestry-roads/materialAllocation.test.ts), `reserves scarce high-quality material for its range and rejects unknown borrow quality`                                                                                                             |
| A factor below one changes required bank and finite waste capacity                                 | Same file, `retains bank/compacted conservation and finite waste capacity with a 0.5 conversion`                                                                                                                                                                                                  |
| Surfacing and subgrade share finite pit capacity                                                   | Same file, `shares pit capacity between a required surface layer and subgrade demand`                                                                                                                                                                                                             |

The ordinary [reference scenario runner](../../scripts/check-reference-scenarios.ts)
and [browser reference scenarios](../../tests/e2e/forestry-road-reference-scenarios.spec.ts)
remain useful PGMaps regressions. Running the same PGMaps model twice, or
round-tripping its own outputs, does not provide an independent external oracle.

## Unverified comparisons and future cases

| Proposed case                                            | Evidence needed before marking verified                                                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct RoadEng section/material/haul comparison          | Extracted tutorial inputs, matching version/settings, CRS and units, terrain, alignment/profile, section and quantity tables, plus an explicit mapping of volume states |
| Non-unit cut factor or loose haul/truck counts           | Source definitions for cut, bank, loose and compacted states; measured conversion/density assumptions and a worked independent balance                                  |
| LandXML physical station placement in receiving software | Export/reimport in a named receiving application and checks that design events retain their physical coordinates, including projected versus ground distance            |
| Curved-road three-dimensional earthworks                 | An independent swept-volume or mesh reference with overlap treatment; current average-end-area tests alone cannot establish that result                                 |
| Vehicle body swept path                                  | Vehicle geometry and independent sweep/clearance results; inside-edge road geometry is insufficient                                                                     |

None of these comparisons is marked passed by the factor-converter work.

## Focused verification

```sh
npx vitest run src/pages/dev-forestry-roads/materialFactors.test.ts src/pages/dev-forestry-roads/projectEngineering.test.ts src/pages/dev-forestry-roads/materialAllocation.test.ts --maxWorkers=1
```

The focused run for this change passed **52 tests across three files**. The
existing `engineering.test.ts` and `sectionAssembly.test.ts` regressions also
passed **69 tests across two files**, covering the section/material and stripping
cases above. Broader integration and browser results belong in the follow-up
implementation record.
