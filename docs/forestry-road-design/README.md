# Using the road design workspace: limits and checks

`/dev/forestry/road-design` is a planning tool. It turns terrain, an alignment and a template
into profiles, sections, quantities, costs and drainage screens quickly enough to compare
options. Every number it produces rests on inputs and simplifications that you need to know
before you use the number for a decision.

These guides say what each part of the workspace assumes, where its limits are and how a
problem shows up on screen. The calculations themselves are specified in the
[workspace contract](../forestry-road-design.md); the guides link to it rather than repeat it.

| Guide                                                                 | Read it before you…                                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Terrain and point clouds](terrain-and-point-clouds.md)               | choose or import terrain, or trust any elevation, grade or volume taken from it                           |
| [Alignment and optimization](alignment-and-optimization.md)           | design curves and grades, or accept an optimized profile, route or corridor                               |
| [Forester constraints and route comparisons](planning-constraints.md) | choose screening constraints, reviewed existing-road reuse or live route previews                         |
| [Existing roads and reuse](existing-roads.md)                         | load BC roads or user linework, review age/condition evidence, or enable existing-road cost preferences   |
| [Dated road-condition evidence](road-condition-evidence.md)             | assess inspection or imagery age, resolve conflicting findings and closures, or review refreshed road geometry |
| [Gravel and aggregate sources](gravel-sources.md)                     | compare local or zero-acquisition aggregate, delivered costs, source capacities and nearby BC pit records |
| [Full-cost horizontal alternatives](full-cost-alternatives.md)         | choose a new connector using checked geometry, connected loaded/return haul, finite supply and reused-road costs |
| [Connected road network](connected-network.md)                         | review real junctions, access restrictions, rehabilitation and dated bridge load ratings |
| [Final connector checks](final-connector-checks.md)                     | assess fitted curves, loaded grades, crossings and the full cut/fill footprint before adopting a comparison |
| [Connected-access training scenario](full-cost-training-scenario.md)    | try the offline road-network, gravel-haul, rehabilitation, bridge-closure and dated-evidence comparisons |
| [Sections, quantities and costs](sections-quantities-and-costs.md)    | quote cut, fill, haul, disturbance or a cost, or compare alternatives on them                             |
| [Section assemblies and site preparation](section-assemblies.md) | construct stripped ground, material-sensitive batters, components, keyed fill and layered surfaces |
| [Material allocation](material-allocation.md) | require suitable fill, enforce construction directions/sidecast, or solve economic supply and disposal |
| [Terrain preparation and survey](terrain-preparation-and-survey.md) | preserve corridor density, mosaic/edit/combine surfaces, import backgrounds or reduce a field traverse |
| [Drawings and vertical alternatives](drawings-and-vertical-alternatives.md) | keep several profiles under one horizontal road or author portable plot-book chapters and labels |
| [BC cost evidence and estimation roadmap](bc-cost-evidence.md)        | select regional sources, compare appraisal allowances or convert supplier quotes                          |
| [Drainage](drainage.md)                                               | use stream crossings, cross-drain candidates, ponding or culvert sizes                                    |
| [Exports and project files](exports-and-project-files.md)             | hand a file to someone else, open it in another program, or rely on autosave to keep your work            |
| [Drawings and vertical alternatives](drawings-and-vertical-alternatives.md) | compare named profiles on shared horizontal geometry, or author portable report chapters and safe drawing labels |
| [Known issues](known-issues.md)                                       | trust a result from an area with a known defect                                                           |
| [RoadEng / Terrain Tools gap audit — 30 October 2026](reference-gap-audit-2026-10-30.md) | compare the current app with the supplied software folder and prioritize remaining work |
| [Reference implementation and validation](implementation-and-validation-2026-10-30.md) | review the delivered audit extensions, scenario checks and mobile verification |

## Five checks that apply everywhere

1. **Know your terrain.** The header badge names the terrain and its resolution. The training
   hillside is synthetic, and the regional DEM is too coarse for earthworks. Only the published
   1 m LiDAR, or ground you imported and checked yourself, supports site-level numbers.
2. **Read the coverage.** Quantities, costs and the drainage check only count stations where
   both ground and design are known. Coverage below 100 % means some of the road is missing
   from every total, and a partial total is not comparable with a complete one.
3. **Treat defaults as placeholders.** Rates, rate presets, material horizons, shrink factor,
   design storm, runoff coefficient and pipe roughness all start from generic values. Replace
   them with your own before a number leaves the workspace.
4. **An optimizer answers the question it was asked.** The profile optimizer, route search and
   corridor optimizer each minimize a stated objective within bounded settings. A better score
   is not a better road until you have checked what it changed: ends, grades, curves,
   drainage and the things the objective leaves out.
5. **Planning, not construction.** Nothing here is a survey, a hydrotechnical assessment, a
   geotechnical assessment or a construction drawing. The plot book and report say "not for
   construction" for that reason. Field verification and the professional sign-off your
   jurisdiction requires come after this tool, not instead of it.

## Where the limits come from

Each guide's "Limits and budgets" table names the file and constant that enforces a limit, so
the table can be checked against the code when the code changes. Update the guide in the same
change as the constant. When a limit is a judgement rather than a constant (for example, a
ground-filter threshold chosen for steep BC hillsides), the guide says why it was chosen.
