# Flatten SF development page

`/dev/flatten` (San Francisco) and `/dev/flatten/pg` (Prince George) are native
PGMaps React/TypeScript pages using the same page, worker and controls. They use the shared
`MapSectionLayout`, `MapSidebarShell`, search fields, segmented controls,
sliders, statistics, toggles, scale and map controls. MapLibre renders the
imported streets, hillshade, route alternatives and draggable endpoints.

The uploaded Flatten SF ZIP supplies the graph, hillshade, routing engine and
offline search logic. `src/pages/dev-flatten/engine.js` preserves the original
engine; `search.js` extracts its offline index without the Leaflet UI. Typed
declarations expose these modules to the native routing adapter, React hook,
map renderer and sidebar. No Leaflet scripts or original DOM application are
loaded by this page.

`public/data/flatten-sf` is an app-owned imported snapshot, not a generated
bcdatamapper dataset. The clean data sync preserves this directory. The graph
and image remain byte-identical to the supplied files. The manifest and labels
are in `src/pages/dev-flatten/data.json`.

Walk/bike modes, calm streets, route trade-offs, loops, out-and-back options,
units, elevation inspection, share links and GPX export use the original
dataset and cost model. The original `#t~…` and `#l~…` share tokens remain
supported. The route search yields between small batches and cancels when
inputs change or the page unmounts.

Endpoint dots have 44 px grab areas and support mouse/touch dragging. The
Move start/Move finish controls choose which endpoint a map click or tap moves.
The mobile sheet leaves the map interactive; fitted routes reserve space for
the shared controls so they do not cover the endpoint dots. The shared marker
keeps MapLibre in control of its live coordinates until drag end; React renders
from controls or route searches cannot restore its old location. The viewport
stays still after endpoint moves; initial routes and explicit place searches
can frame the route. Drag positions trigger
leading/trailing live previews at most every 100 ms, skipping unchanged snapped
corners. Point-to-point previews use the original shortest and flat objectives;
loop previews use a smaller sector scan and publish valid closed loops as they
arrive. Distance, climbing and the elevation profile redraw before release.
Releasing flushes the final position, cancels old preview work and runs the full
alternative search even when the last preview already used that street corner.

Routing runs in a dedicated module worker, with request IDs and cancellation
keeping stale results out of the UI. The street background is drawn to a cached
canvas texture on camera changes, rather than rendering the entire street graph
on every live update. Selected routes crossfade through two persistent MapLibre
line buffers, and the elevation profile interpolates between sampled shapes.
Both transitions respect reduced-motion preferences.

Page-scoped WebMCP tools reuse PGMaps' registration lifecycle:
`search_flatten_places` searches the offline index and `read_flatten_route`
reads the current route. The page is also registered in the development
library and site-wide experience discovery.

City configuration in `src/pages/dev-flatten/cities.ts` supplies the graph,
hillshade, coordinate bounds, place index, attribution and default endpoints.
Models are cached separately per city. Switching pages remounts the controller,
terminates its worker and discards the other city's trip. Existing SF tokens and
unit preferences are preserved; PG tokens use the same format on the PG path.

Prince George uses an app-owned OpenStreetMap extract covering the urban area,
from 53.81° to 54.02° N and 122.92° to 122.62° W. The original snapshot is
`scripts/flatten-pg-source.json.gz`; it was fetched from Overpass on 2026-10-08.
`scripts/build-flatten-pg.py` preserves OSM junction IDs, direction/access tags
and separated bridge crossings. It restricts each travel mode to the largest
strongly connected network, matching the original engine. It samples the same
AWS Terrarium terrain source used by PGMaps forestry at zoom 13, interpolates
bridge/tunnel heights between endpoints, and removes small interior elevation
reversals. It emits the original binary bundle format; the routing engine is
unchanged. Calm cycling uses road classes and mapped cycle-lane tags.

The snapshot contains 14,237 graph nodes, 36,526 directed arcs and 311 named
place entries, including mapped short names. Search also derives named street
intersections. It does not include a house-number index. Terrain-derived grades
and climbing are estimates, with less detail than the SF lidar data. OSM turn
restrictions and time-dependent access restrictions are not modelled. This is a
development routing preview, not a surveyed accessibility or safety assessment.

Generated PG assets live in `public/data/flatten-pg`, preserved by clean scraper
sync as app-owned data. `sources.json` records the OSM timestamp, source snapshot
hash, DEM tile URLs/hashes and processing parameters. OpenStreetMap data is
ODbL-1.0; attribution is displayed on the map. The saved source extract is
included so the derived graph can be reproduced or inspected.

Rebuild the PG assets with Python, numpy, scipy and Pillow:

```sh
python3 scripts/build-flatten-pg.py --cache /path/to/terrain-tile-cache
```

Original author: [Drew Edwards](https://almostimplemented.com).
Source and analysis: <https://github.com/almostimplemented/flattensf>.

Focused validation:

```sh
npx vitest run src/pages/dev-flatten/routing.test.ts src/pages/dev-flatten/routing-pg.test.ts src/lib/siteWebMCP.test.ts
npx tsc -b
```
