# Great Forest (Destination BC)

The Rainforest to Rockies lettering face, committed for this test project at the owner's request. Each file's copyright and licence are its own. The fonts read "Copyright 2015 Adobe Systems Incorporated. All rights reserved." and carry embedding flag fsType 4 (preview and print). The source bundle states that downloading the material does not grant new reuse rights. Replace or remove these files before the project is published beyond testing.

| File                                                                                     | What it is                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GreatForest-SmallCaps-v1.000-VancouverIslandNorth.original.woff` / `.decompressed.ttf`  | Great Forest Small Caps 1.000, 194 code points (printable ASCII and more). Page 8's place names.                                                                          |
| `GreatForest-Simplified-v1.000-VancouverIslandNorth.original.woff` / `.decompressed.ttf` | Great Forest Simplified 1.000, 191 code points. Page 8's display lettering (RAINFOREST, CANADIAN ROCKIES); lowercase are capital-shaped alternates. Maple leaf at U+00A4. |
| `GreatForest-Regular-Recovered-PDF-Union-2015-2018.ttf`                                  | A derived, incomplete Regular: a union of the subsets embedded in the 2015 and V4.2 brand guides. 86 glyphs; J, Q, j, x and z are missing.                                |
| `GreatForest-v1-Simplified-maple-leaf-U00A4.svg`                                         | The Simplified font's maple-leaf glyph as SVG.                                                                                                                            |
| `partner-webfont-audit.json`, `regular-union-audit.json`                                 | Source URLs, name tables, code points and hashes from the source bundle; their paths are those of the full research archive.                                              |

The WOFF files are the originals served by Vancouver Island North's site; the TTFs are verified decompressions. `SHA256SUMS.txt` lists every file; the hashes match the source bundle's.

`scripts/illustrated-map/build-great-forest.py` reads the Small Caps and Simplified TTFs here and writes `src/lib/mapSheet/greatForestMetrics.generated.json`: the advance widths the sheet writers lay text out with. Map sheets set text in the face itself (`src/lib/mapSheet/greatForest.ts`): an SVG embeds the WOFF, and a PDF embeds the TTF.
