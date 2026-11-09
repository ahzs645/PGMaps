# Historical access worked example

These files contain **invented training data**, not provincial feature extracts or
assertions about actual BC road use. See the [workflow and expansion guide](../../../docs/forestry-road-design/access-history.md).

![Synthetic routes before and after the bridge closure](access-history-comparison.png)

[Open the vector comparison](access-history-comparison.svg). It is generated from
the same coordinates and trace results as the project, not from a browser screenshot.

- [Openable road project](synthetic-access-history.road.json): use **Open** in Forest road design.
- [Portable history bundle](synthetic-access-history.bundle.json): use **Terrain → Access history → Import** in another project.
- [Generated evidence report](synthetic-access-history-report.md): inspect the two original 2010 route assertions and their sources.
- [Expected outcomes](expected-outcomes.json): compare block A in 2010 and 2022, including excluded roads and conflicting bridge evidence.

The same example is available through **Projects → Browse example scenarios →
Training · reconstruct block access and bridges**. It works without ministry requests.

Block A's inferred 2010 path is approximately **1.264 km** through the shared
bridge. At 2022-08-01, the bridge has a closure and conflicting 60 t / 0 t reports;
the available candidate uses the later bypass and is approximately **2.364 km**.
That later route does not explain the block's 2009–2010 harvest. The two 2010
paths total approximately **2.725 km** when counted separately, but use about
**1.825 km** of unique source road geometry, including about **0.900 km** of overlap.
Construction costs remain unknown.

Regenerate the project, bundle, report, expected outcomes and vector diagram with:

```sh
npm ci
npm run ci:prepare
npm run example:access-history
```

No network query is made by the generator. It uses the application's source
implementation, parser and serializers so the example stays reviewable and importable.
The PNG preview is a raster copy of the SVG. To refresh it with Inkscape installed:

```sh
inkscape examples/forestry/access-history/access-history-comparison.svg \
  --export-type=png \
  --export-filename=examples/forestry/access-history/access-history-comparison.png
```
