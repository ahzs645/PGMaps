# Illustrated map exports

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
