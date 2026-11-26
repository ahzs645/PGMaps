# Illustrated map exports

The workshop defaults to real geography. Export that composition and its offline reviewer with:

```sh
node --import tsx scripts/illustrated-map/export-geographic.ts /absolute/path/to/output
```

This writes the styled geographic map, a base map, the dry-land mask, northern and all-BC hatch alternatives, transparent layers, all 64 elements, a schematic style reference, provenance, and **geographic-review.html**. The northern outputs are **geographic-northern-hatch.svg** (complete map) and **geographic-northern-forest.svg** (transparent hatch layer). See [the geographic guide](../../docs/illustrated-map-geographic.md) for local GeoJSON preparation, projection, source notices and generalization limits. Land fill and hatch clip reuse the same geographic boundary, including water holes.

The workshop keeps coastal coverage as its default. Select **Northern BC · reference style** to add the reference's broad northwestern hatch field within the same geographic frame. Two sibling style-clip paths unite the coastal and authored northern extents; one continuous hatch field is clipped by that union and the shared geographic land mask. This is a decorative coverage choice, not a current forest inventory or an expansion to the whole northern province.

## Another region

`build-geographic-map.py --region region.json` builds geography for any place; without it, the script builds BC. `compose-region.ts` draws a generated geography with a hatch recipe, as SVG and vector PDF:

```sh
node --import tsx scripts/illustrated-map/compose-region.ts geography.json out/ [--preset id | --recipe recipe.json] [--coverage coverage|region]
```

See **Reusing the style elsewhere** in [the geographic guide](../../docs/illustrated-map-geographic.md).

## Schematic reference export

Run from the PGMaps checkout after installing its dependencies:

```sh
node --import tsx scripts/illustrated-map/export.ts /absolute/path/to/output
```

With no output argument, the script writes to `tmp/illustrated-map-export`.
Use `node --import tsx`, which does not need the separate IPC listener used by
the `tsx` command in restricted execution environments.

The exporter uses the same DOM-free drawing functions as `/dev/illustrated-map`.
It writes the full map, transparent overlay, element contact sheet, hatch swatch,
every individual element under `elements/<category>/`, a construction inventory,
and an offline `review.html`. The HTML bundles the same generator with esbuild
and embeds `public/illustrated-map/page8-reference.jpg` for comparison. It opens
directly from disk and makes no network requests.

The script overwrites its named outputs and does not remove other files from
the destination. Generated outputs belong outside committed source directories.
Change geometry in `src/lib/illustratedMap/`, then regenerate; do not edit exported
SVGs as the source of the workshop.

The map exporter uses the current hatching preset and composition defaults:
white glyph outlines and natural illustration overlap. The forest field is
clipped to the intersection of the land and forest regions; its flow is not
rotated to follow the boundary. The offline controls change these same options.

The compass's BC shape is a compact derived geographic asset. Regenerate it
from the saved response to the source query recorded in
`src/lib/illustratedMap/bcInset.generated.json`:

```sh
node scripts/illustrated-map/build-bc-inset.mjs /absolute/path/to/statcan-bc-2021.json
```

The script projects to BC Albers, simplifies the retained landmasses and fits
them uniformly. Source attribution and generalization metadata travel with the
compass SVG. The moss-coloured journey accent remains illustrative.
