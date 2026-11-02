# LandSciTech roads browser adaptation

This directory includes TypeScript adaptations of the methods and the CLUS
demonstration fixture from [LandSciTech/roads](https://github.com/LandSciTech/roads),
version 1.2.2, reviewed at commit
`08c462de51076b550473cb709da633314c32cd87`.

Upstream copyright notices:

- Copyright 2018 Province of British Columbia.
- Copyright © Her Majesty the Queen in Right of Canada as represented by the
  Minister of the Environment 2021 / © Sa Majesté la Reine du chef du Canada
  représentée par le ministre de l'Environnement 2021.

The upstream authors are Sarah Endicott, Kyle Lochhead, Josie Hughes and Patrick
Kirby. Several graph routines were adapted upstream from the Province of British
Columbia's `roadCLUS` module. The upstream work is licensed under the Apache
License, Version 2.0; the full licence is in [LICENSE](LICENSE).

Changes in this adaptation: pure TypeScript/browser data contracts; deterministic
tie-breaking; explicit finite-input and workload limits; worker-compatible
execution; GeoJSON and JSON interchange; separate topographic samples and road
masks for the planning adapter; browser map presentation; and documented repairs
or differences where upstream R behaviour is unsuitable for planning. See
[the compatibility inventory](../../../../docs/forestry-road-design/roads-package-compatibility.md).

The adapted code is not the R package executing in a browser. A checked
mathematical fixture is evidence for that fixture only, not a claim that every
`sf`, `terra` or `igraph` edge case produces identical results. Synthetic browser
examples are teaching inputs, not surveyed roads or approved designs.
