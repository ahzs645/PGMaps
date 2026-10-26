# Using the road design workspace: limits and checks

`/dev/forestry/road-design` is a planning tool. It turns terrain, an alignment and a template
into profiles, sections, quantities, costs and drainage screens quickly enough to compare
options. Every number it produces rests on inputs and simplifications that you need to know
before you use the number for a decision.

These guides say what each part of the workspace assumes, where its limits are and how a
problem shows up on screen. The calculations themselves are specified in the
[workspace contract](../forestry-road-design.md); the guides link to it rather than repeat it.

| Guide                                                              | Read it before you…                                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [Terrain and point clouds](terrain-and-point-clouds.md)            | choose or import terrain, or trust any elevation, grade or volume taken from it                |
| [Alignment and optimization](alignment-and-optimization.md)        | design curves and grades, or accept an optimized profile, route or corridor                    |
| [Sections, quantities and costs](sections-quantities-and-costs.md) | quote cut, fill, haul, disturbance or a cost, or compare alternatives on them                  |
| [BC cost evidence and estimation roadmap](bc-cost-evidence.md) | select regional sources, compare appraisal allowances or convert supplier quotes |
| [Drainage](drainage.md)                                            | use stream crossings, cross-drain candidates, ponding or culvert sizes                         |
| [Exports and project files](exports-and-project-files.md)          | hand a file to someone else, open it in another program, or rely on autosave to keep your work |
| [Known issues](known-issues.md)                                    | trust a result from an area with a known defect                                                |

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
