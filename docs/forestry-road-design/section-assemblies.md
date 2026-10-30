# Physical section assemblies and preparation

The Section tab and template-library editor now support ordered bench, finite slope, retaining-face
and excavated-key components, and separate surface courses. The geometry, sections, daylight,
quantities, prepared-ground display and drainage surface use the same evaluated section.

## Site preparation before construction

In Engineering → Ground, **Stripping before construction** adds a station range with a removal
depth, inside offsets from the centreline, outside offsets beyond each final catch line, and a
stripping material. The outside bounds are solved with the prepared-ground section: removing
material beneath a fill can move its toe outward. Source ground stays unchanged in the project;
`SectionSample.preparedGround` carries the altered surface. The section chart draws both lines.

Ordinary section cut is measured from prepared ground to design. Preparation removal is reported
separately in `preparationAreas` and enters station/road cut volume and the material ledger once.
It is never reusable. Fill includes the replacement volume beneath an embankment. Clearing
quantities and plan/3D preparation-margin strips include removal beyond the road catch lines.
Legacy shallow
stripping horizons remain excavated-cut classifications; they do not automatically become a
site-preparation instruction. A missing source sample anywhere in the preparation footprint makes
the section incomplete, including a missing area outside the final road catch lines.

For a 100 m straight road on flat 800 m ground, 802 m subgrade, 3 m half-widths, zero crown and
1:1 batters, 0.2 m removal plus 0.3 m outside offsets gives 5.2 m catch distance each side,
**1,804 m³ fill** and **220 m³ separately removed stripping**. Without removal the fill is 1,600 m³.

## Material-dependent batters

Ground materials optionally provide cut and fill slopes in H:V. Cut batter segments use the
material at their actual depth below original ground. Intersections with entered horizon depths
are added to the evaluated polyline, so material changes do not jump the batter elevation.
Unassigned strata inherit the side's template slope. An explicitly assigned subgrade fill
material can likewise supply the fill batter. These are entered assumptions; no geology or
stable slope is inferred from the DEM or material name.

For a quality-replaceable fill requirement, the batter uses the largest (flattest) entered H:V
among all eligible non-stripping materials; a missing material slope inherits the template.
The geometry therefore accommodates an allowed flatter-slope substitute rather than assuming
the nominated reference material will be the one delivered. An exact requirement uses that
material's slope. At the road-end cross-section, ranges retain their approaching assignment,
matching the material-classification convention.

## Ordered components and course layers

Bench, slope and retaining-face components advance outward from the formation or cut-side ditch
in list order. Their width and rise define actual segment endpoints. Conditions select cut,
fill or both situations. A finite retaining face represents geometry only; it does not calculate
wall stability, reinforcement or foundation capacity. Component point codes appear in the
section inspection and point-code exports.

An excavated key removes an entered width/depth of ground beyond the formation edge and replaces
it with fill. Its excavation and replacement demands enter the quantities once; an optional
material identifies the replacement demand. Keep keys within a fill footprint and review the
resulting section. An active key outside the constructed footprint makes the section incomplete
with a specific flag; a key whose cut/fill condition does not match is skipped deliberately.
The finished batter meets the stripped ground, not the bottom of a foundation trench, so an
excavated key cannot manufacture a false toe at its own vertical edge. The **Keyed rock-fill starter** adds two keys and steeper entered fill batters;
it is a geometric starter, not a geotechnical standard. Individual components can be saved in a
device-local library and imported/exported as `pgmaps-road-components-v1` JSON. Imported material
and reference IDs must also exist in the receiving project.

Surface courses have their own name, side, depth and optional material. An explicit stack
**replaces** the old `surfaceDepth` quantity. Courses lie above the designed subgrade and are
drawn on the section; the subgrade/design-surface datum is unchanged. The ordinary surfacing
rate remains applicable where no material-specific supply/haul rule is assigned. The shared
`surfaceLayersAt` helper provides the same start/midpoint/end course areas to Simpson integration
in engine, material-demand and complete-cost calculations.

## Reference features and surfaces

An optional reference feature anchors a component endpoint at the intersection of a named
context line or polygon boundary with the current section. The nearest intersection on the
specified side is used. A 3D feature supplies interpolated elevation only when its recorded
vertical datum matches the terrain's datum; a 2D feature uses prepared
ground at the intersection. An optional reference surface overrides that elevation. Built-ins
are original and prepared ground; other choices are retained analytical surface snapshots.
Display-only orthophotos or canopy images cannot become analytical surface references.

Horizontal offsets move the reference endpoint outward; vertical offsets raise/lower it.
Endpoints that do not advance beyond the preceding component, missing intersections and missing
surface samples produce an incomplete section with an explicit reference flag. They never fall
back to a relative component silently. The dense final checker and vertical optimizer accept the
same reference-source map as ordinary analysis. Reference components use finite typed operations,
not executable formulas or scripts.

## Limits and checks

| Bound | Enforcing code |
| --- | --- |
| 40 components; 20 surface courses per template | `sectionAssembly.ts`, `parseSectionComponents` / `parseSectionLayers` |
| Component width 0.01–50 m; rise −30–30 m; key depth 0–20 m and edge offset 0–50 m | `parseSectionComponents` |
| Course depth 0–2 m; stack at most 5 m per side | `parseSectionLayers` |
| 100 preparation ranges; depth 0–20 m; inside offsets 0–100 m; outside offsets 0–50 m | `parseSitePreparation` |
| No overlapping preparation station ranges or overlapping keys on one side | `parseSitePreparation`, `parseSectionComponents` |
| Material batters 0.1–10 H:V | `validatePreparation` |
| 24 preparation footprint iterations; 0.00001 m convergence; whole preparation footprint must lie inside section reach | `assembledSection.ts`, preparation iteration loop / reach check |
| Batter sampling step 0.05–0.25 m, plus refined horizon/daylight intersections | `assembledSection.ts`, `step` / side solve |
| 2,000,000 reference segment checks per analysis | `sectionReferences.ts`, `MAX_REFERENCE_SEGMENT_CHECKS` |
| Reference horizontal/vertical adjustment −100–100 m | `parseSectionComponents` |
| Component library import 1 MB, at most 40 definitions | `ComponentLibrary.tsx`, shared parser |

An unresolved preparation footprint or reference leaves quantities partial. Numerical integration
still depends on terrain support and station spacing. Surface courses are separate volume demands;
they do not establish pavement performance, compaction testing or structural design.

Matching component IDs in a template transition interpolate dimensions once. Changing component
type, condition, reference, material or shared-component order requires an explicit step
assignment with transition 0. Different key identities may not overlap during a transition.
These checks avoid duplicating one physical key or losing part of its fill-material demand.

`sectionAssembly.test.ts` checks physical removal/replacement, material-boundary slopes, referenced
3D geometry and named surfaces, keyed excavation, benches/codes, layer quantities, asymmetric
entry/exit tapers and invalid inputs. `forestry-road-section-assembly.spec.ts` exercises the actual
desktop and phone editors, JSON export/reopening and page/control containment.
