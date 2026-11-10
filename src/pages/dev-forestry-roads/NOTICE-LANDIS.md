# LANDIS-II Forest Roads Simulation adaptation

`skidSpurs.ts` adapts one method from the
[LANDIS-II Forest Roads Simulation extension](https://github.com/Klemet/LANDIS-II-Forest-Roads-Simulation-module)
by Clément Hardy (doi:10.5281/zenodo.5510629), reviewed as the `master` branch archive supplied
on 10 November 2026. The upstream work is licensed under the Apache License, Version 2.0; the
full licence text is in [roads/LICENSE](roads/LICENSE).

What is adapted: ground that is out of skidding reach is served in order of its straight-line
distance to the nearest road, closest first, and each new road is a least-cost path joined to
the nearest road already connected to the network.

Changes in this adaptation: TypeScript, no upstream code; the spur aims at the point that best
covers the uncovered patch rather than at the uncovered cell; spurs are drawn by PGMaps' own
grade-limited router (`routing.ts`) on the 12 m ground trend; each spur is shortened to the least
length that keeps its coverage gain; reach follows the slope-dependent skid model in
`skidReach.ts` rather than a fixed disc; and the order is deterministic.

No code from the GPL-licensed projects reviewed alongside it (ForestRoadNetworkPluginForQGIS,
SylvaRoad, forestroaddesigner, Sylvaccess, SEILAPLAN, QuickTurn, ALSroads, RFLTools, Topografia,
Lima VVA) or from the unlicensed 3D-CHA is included in PGMaps. See
[the 10 November 2026 review](../../../docs/forestry-road-design/field-review-and-reference-repos-2026-11-10.md).
