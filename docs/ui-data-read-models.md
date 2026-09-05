# UI data read models

`npm run data:build-ui` produces ignored files in `public/data/ui`. It runs after normal and clean data sync, including the existing predev/prebuild workflows. These are application read models derived from the canonical snapshots; they do not replace or migrate scraper-owned data.

- `restaurant-locations.json`: restaurant-only coordinates, source indexes, and the place metadata consumed by Food Safety. The original join order and location-override precedence remain unchanged. All inspection history remains available in the existing restaurant dataset.
- `search/*.json.gz`: deterministic compressed labels and navigation parameters for restaurants, parks, census variables, and property addresses. Geometry and inspection histories are omitted. Parks use the canonical CityPG `source/public_gis/parks.json` attribute names. Property search includes all available addresses rather than the previous runtime limit of 800.

Run `node --test scripts/build-ui-data.test.mjs` to validate extraction rules. Missing required inputs fail generation rather than silently publishing an empty index. Do not commit generated files or force-add ignored scraper data.

Global search shows static map/dataset links immediately, then publishes source results independently. Property addresses load once the query has at least two characters. CANUE uses the same v2 catalog as its map; recent crime queries run only for crime/theft/break/mischief searches. Remote sources time out after eight seconds and can be retried without losing other results.
