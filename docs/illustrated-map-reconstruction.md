# Rainforest to Rockies: geometric reconstruction

Reconstruction date: 25 November 2026. Reference: page 8 of Destination BC's supplied *Rainforest to Rockies Industry Brand Guidelines*. Workshop route: `/dev/illustrated-map/`.

## What was built

The map is now a drawing system. The scenery, trees, navigation marks, geography, route network and title study are composed from authored geometry. The forest is a deterministic field of short cubic strokes. The place names are composed from the supplied Great Forest font glyphs. No image tracing, threshold-to-contour conversion or old kit path data is used by this generator.

The complete reference kit has 63 individual element files. All 63 have corresponding rebuilt outputs: 18 scenic motifs, 14 navigation marks, 23 individual trees and eight drafting assets. A separate reconstructed title study brings the new catalogue to 64 entries. The full map also contains editable land shapes, six continuous highway centrelines, connecting routes, arrowheads and 14 groups of place names (18 lines). The component descriptions below explain every catalogue element.

The file uses the reference's 1536 by 945 artwork coordinates. It is a schematic, not a georeferenced dataset or a route-planning network. Its highways and place positions must not be used as surveyed or navigable coordinates.

## What the original material contains

Page 8 is a single embedded 1536 by 945 raster map. Its apparent fine lines are not original vector objects in the PDF. The old map kit is a prior vectorization: its reference map contains 8,896 paths, including 8,569 small filled hatch contours. The kit describes its hatch samples as traced and its overlap calculations as measurements of traced masks. Those files are useful for understanding the composition and measuring placement; they are not the construction model requested here.

Only placement metadata (bounding boxes, viewBox sizes and named feature positions) was carried forward. The old element path data, traced lettering and traced forest texture were not copied. The exact raster is available in the workshop's comparison tab, clearly labelled as the reference.

The later `Great_Forest_Destination_BC_assets` archive contains genuine web fonts and other Destination BC icons. Its rainforest and mountain web icons are different illustrations. They were inspected as additional references, not substituted for the page 8 pictograms. No Rainforest to Rockies official vector lockup master was found in that archive.

## The drawing model

### Land, routes and layer order

`layout.ts` contains purpose-drawn cubic land/coast shapes and a network of named route landmarks. `smoothPath` turns each route's ordered control points into editable cubic centreline segments. Vancouver, Hope, the northern junction, Kamloops, Golden, Mount Robson and Fernie are explicit shared points, as are the Seattle departure and the eastern and southern connector joins. Routes meet on those points rather than on visually close independent coordinates.

The SVG is layered as surroundings and water, mainland and island, forest strokes, boundary, dashed connections, continuous highways, trees, scenery, navigation, lettering and reconstructed title. Layer visibility controls generate the actual exported SVG. They are not cosmetic preview switches. Route strokes continue under shields and destination marks. Golden's label has a white backing for legibility. Hatching is clipped to separately authored forest regions, with small label and illustration keepouts.

### Scenery and trees

Each drawing is decomposed into meaningful pieces. For example, the cyclist consists of two wheels, frame/fork segments, a torso, articulated limbs and a head. The wine glasses have bowls, liquid areas, stems and feet; their groups are rotated as glasses. The hot spring uses placed stones and steam curves. The trees use shared construction functions with differing dimensions, branch tiers and lean. Changes to a branch rule therefore change a coherent tree family.

The final symbol pass uses tapered curved branch blades for the emerald trees and broader solid crowns with white separation in the mountain group. The mountain ridge has deliberately varied peak shoulders. Waterfall streams use short broken segments at two stroke widths, and the ripple rows have small variations in crest height and shape. These refinements were checked in aligned source/reconstruction overlays.

The new geometry is intentionally compact and clean. It does not simulate every edge irregularity in the compressed raster. The comparison pages show residual differences honestly, especially the detailed BC compass inset, small animal features, wave crests and the logo study. These are editable reconstructions, not a recovered illustrator master.

### Typography

The supplied `GreatForest-SmallCaps-v1.000` and `GreatForest-v2-Simplified-Regular-v2.002` files both parse correctly. Small Caps is used for place names. The Simplified Regular face is used for the larger Rainforest and Canadian Rockies labels. `lettering.ts` composes glyph outlines from source wording and authored ink boxes. It keeps each label's wording and font family in metadata; individual glyphs are ordinary editable SVG paths.

`fontGlyphs.generated.json` holds only the working glyph subset. Rebuild it with `scripts/illustrated-map/build-font-glyphs.py` and the supplied fonts. The complete font files are not committed. The former kit's Open Sans editable layer and raster-derived letter contours are not used.

Highway numerals and the compass letters use a separate, small authored monoline alphabet. Their individual symbol SVGs therefore contain vector strokes instead of live text or an Arial dependency. The contact-sheet headings and captions remain ordinary SVG text; they are presentation labels outside the map artwork.

The large two-line title is a separate geometric study: its display letters are constructed from stems, bowls, counters and diagonals, and the Wander Mark study from a rounded diamond and mountain/tree chevrons. It is explicitly marked as reconstructed. It is not presented as an official source master. Destination BC's [2024 toolkit](https://www.destinationbc.ca/content/uploads/2024/03/Rainforest-to-Rockies-Industry-Brand-Toolkit.pdf), page 5, provides the route for requesting the third-party logo.

### Colours

| Role | Colour | Basis |
| --- | --- | --- |
| Deep ink | `#00392F` | Canopy Green, guideline page 32 |
| Routes and emerald scenery | `#1A7667` | Alpine Emerald, guideline page 32 |
| Light trees and accent marks | `#B0BD36` | Lush Moss, guideline page 32 |
| Forest strokes | `#BCC454` | Sampled reference-map reproduction colour, not the named Lush Moss swatch |
| Water and surrounding land | `#D6DFDE`, `#E6E7E8` | Reference-derived background colours |
| Light paper | `#FFFFFF` | White |

## A systematic forest texture

The original is a field of short near-vertical marks whose ends form flowing horizontal ribbons. This observation informs the reconstruction. It does not establish how the original artist made the image.

The generator starts with regularly separated columns and row boundaries. A smooth coordinate warp bends the shared row boundaries and leans neighbouring strokes together. Small variation is keyed to seed, row and column, so the result is repeatable and resizing does not shuffle existing marks while the requested pitch remains within the stroke budget. Each short segment becomes a cubic Bézier. The final SVG clips the field to land and keeps specified areas clear. Individual hatch swatches carry their own clipped SVG viewport, so boundary strokes cannot spill into adjacent catalogue entries or an embedding layout.

This is an original implementation of a warped ribbon field informed by the research below. It does not sample the raster, extract its contours or repeat a traced texture tile. Its public controls are spacing, band height, stroke width, curvature and seed. The metadata records the settings and generator version. Extreme requests are bounded; the generator reports if it must increase effective spacing to stay within its 30,000-stroke budget.

A texture is not usefully judged by exact pixel coincidence with the original random marks. Review its coverage, dominant direction, spacing distribution, band length, white seams, spatial variation and appearance at final display/print size. The reference and generated swatches are included in the review material. The first revision had overly prominent regular white seams; the second pass reduced the band gap and varied the band boundaries.

## Research: what other implementations contribute

| Primary source | What it does | How it applies here |
| --- | --- | --- |
| [Tyler Hobbs: Flow Fields](https://www.tylerxhobbs.com/words/flow-fields) | Describes angle fields, curve integration, length, spacing and collision checks | Explains correlated direction and controlled variation; useful conceptual basis for short curved marks |
| [anvaka/streamlines](https://github.com/anvaka/streamlines) | Renderer-independent JavaScript, RK4 integration, seed points, separation controls, point output; MIT | Best reusable option for a future true flow-field mode; the returned paths can become SVG. Long unrestricted streamlines alone do not supply this map's ribbon bands |
| [Rough.js v4 hachure](https://roughjs.com/posts/release-4.0/) | Seeded variation and rotated scanline polygon hatching | Good for ordinary sketched fills and polygon clipping. Its diagonal hachure is a different visual structure from this forest |
| [Flow Lines](https://github.com/msurguy/flow-lines) | Interactive formulas and SVG/polylines; MIT | Useful precedent for controls, presets and editable SVG export |
| [hatched](https://github.com/plottertools/hatched) | Image thresholds converted to diagonal/circular line hatch; MIT | Useful comparison and print workflow, but an image-driven hatch would not satisfy the requested drawing system by itself |
| [vpype](https://github.com/abey79/vpype) | SVG path sorting, clipping and plotting pipelines; MIT | Optional production cleanup. Keep the cubic master separately because its pipelines can flatten curves to polylines |
| [svgpathtools](https://github.com/mathandy/svgpathtools) | Curve geometry, intersections, length, bounding boxes and SVG I/O; MIT | Useful offline validation and comparison, not a hatch generator |
| [Jobard and Lefer, 1997](https://web.cs.ucdavis.edu/~ma/SIGGRAPH02/course23/notes/papers/Jobard.pdf) | Evenly spaced streamline placement | Algorithmic reference for a possible advanced flow-field mode; cited by the streamline implementation |

No third-party hatching implementation is copied or installed by the new PGMaps module. The research is used to choose a method appropriate to the reference. A separate image-to-flow precedent, [vpype-flow-imager](https://github.com/serycjon/vpype-flow-imager), has GPL-3.0 licensing and is not imported here.

## Every element

Dimensions below are each component's local viewBox. The full-map placement is independent, and every component is also exported as its own SVG. White coastal waves are shown over water in the element sheet.

### Scenic illustrations

| Element | Local size | Construction |
| --- | --- | --- |
| `bear` | 68 × 45 | Anatomical landmarks, four leg cutouts and one continuous cubic outline. |
| `birds` | 56 × 28 | Two pairs of curved wing strokes with distinct lean. |
| `cyclist` | 86 × 72 | Two wheel rings, fork, frame, articulated rider and oval head. |
| `fishing-boat` | 77 × 51 | Bezier hull, seated figure, fishing rod and line. |
| `gondola` | 50 × 52 | Rounded cabin, divided windows, sill lights and suspension triangle. |
| `grove` | 107 × 102 | Five instances of the shared trunk-and-branch grammar. |
| `hiker` | 40 × 75 | Head, tapered torso and legs, bent arm, backpack and pole. |
| `hot-springs` | 108 × 57 | Elliptical stone ring, bather and three steam curves. |
| `mountain-range` | 221 × 105 | Composed peak vertices, snow faces, foreground trail and reusable trees. |
| `orca` | 61 × 41 | Back, dorsal fin, nose, belly and flipper landmarks with white patches. |
| `water-ripples-north` | 49 × 39 | Three rows of rounded chevrons: two, four and two crests. |
| `water-ripples-south` | 38 × 30 | Smaller instance of the shared three-row ripple grammar. |
| `waterfall` | 90 × 80 | Rock lip, independent falling streams, spray strokes and pool arcs. |
| `wave-coast-east` | 54 × 23 | Two crest arcs and a shallow white return curve. |
| `wave-coast-north` | 59 × 25 | Two unequal crest arcs and a shallow white return curve. |
| `wave-coast-orca` | 79 × 19 | Three low crest arcs on a shared white ribbon. |
| `wave-coast-west` | 100 × 22 | Three broad crest arcs on a shared white ribbon. |
| `wine-glasses` | 97 × 76 | Two rotated bowl, wine, stem and foot assemblies. |

### Navigation and title

| Element | Local size | Construction |
| --- | --- | --- |
| `compass-bc` | 232 × 229 | Circle, cardinal arrows, letters and a deliberately schematic BC polygon. |
| `dot-kamloops` | 28 × 28 | One slightly tilted ellipse. |
| `flag-fernie` | 69 × 94 | Pole, stepped waving cloth and destination disc. |
| `flag-golden` | 68 × 94 | Same flag grammar with a slight lean. |
| `flag-mount-robson` | 68 × 95 | Pole, stepped waving cloth and destination disc. |
| `mile-zero-leaf` | 36 × 34 | Three-lobed leaf, stem and constructed numeral; small scale instance. |
| `pin-vancouver` | 42 × 50 | Rounded teardrop and circular white centre. |
| `shield-1-east` | 59 × 61 | Three-lobed highway leaf and independently editable number. |
| `shield-1-west` | 59 × 61 | Same leaf grammar; placement distinguishes the route marker. |
| `shield-3-east` | 53 × 49 | Five-point shield with two curved sides and constructed numeral. |
| `shield-3-west` | 53 × 49 | Shared shield shape and constructed numeral. |
| `shield-5-north` | 53 × 49 | Shared shield shape and constructed numeral. |
| `shield-5-south` | 53 × 49 | Shared shield shape and constructed numeral. |
| `shield-99` | 53 × 49 | Shared shield shape with a two-digit number width. |
| `title-study` | 460 × 150 | Constructed block lettering, rounded diamond and three mountain/tree chevrons. A reconstruction study; an official logo master has not been recovered from these files. |

### Tree instances

| Element | Local size | Construction |
| --- | --- | --- |
| `tree-emerald-01` | 26 × 35 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-02` | 21 × 29 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-03` | 28 × 40 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-04` | 29 × 40 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-05` | 29 × 40 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-06` | 27 × 38 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-07` | 23 × 38 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-08` | 29 × 38 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-09` | 30 × 43 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-10` | 35 × 51 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-11` | 36 × 51 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-12` | 31 × 44 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-13` | 31 × 43 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-emerald-14` | 31 × 42 | Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance. |
| `tree-moss-01` | 27 × 34 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-02` | 28 × 38 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-03` | 29 × 38 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-04` | 28 × 38 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-05` | 30 × 40 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-06` | 25 × 31 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-07` | 25 × 32 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-08` | 21 × 25 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |
| `tree-moss-09` | 31 × 39 | Three tapered crown tiers and trunk; dimensions and lean vary by instance. |

### Drafting assets

| Element | Local size | Construction |
| --- | --- | --- |
| `blank-highway-leaf` | 59 × 61 | Reusable three-lobed leaf without a number. |
| `blank-highway-shield` | 53 × 49 | Reusable curved shield without a number. |
| `destination-flag` | 68 × 95 | Reusable pole, cloth and destination disc. |
| `main-highway-line` | 178 × 44 | One cubic centreline with rounded caps; 6.8 source-pixel stroke. |
| `dashed-connector-line` | 178 × 44 | One curved centreline with an 8/9 dash rhythm. |
| `illustration-leader` | 178 × 44 | One curved leader with a 4/4 dash rhythm. |
| `forest-hatch-square` | 225 × 225 | Seeded cubic strokes between smoothly warped rows. Regenerates at any extent; no raster contours or tiled source swatch. |
| `forest-hatch-strip` | 320 × 90 | The same anchored stroke field as the square, clipped to a strip. Each mark remains an editable open stroke. |

## Use and export

Open `/dev/illustrated-map/` in a development build. The Map, Elements, Hatching and Compare tabs use the same SVG builders as downloads. Compare offers an ink overlay with opacity or a side-by-side view. The page never requests geographic data to draw this schematic.

To write the independent vector package and an offline interactive review:

```sh
node --import tsx scripts/illustrated-map/export.ts /absolute/output/directory
```

The exporter writes the full map, overlay, element sheet, swatch, separate layers and all individual SVGs. The standalone `review.html` contains its engine and reference and opens without a server or network connection. The editable source remains in `src/lib/illustratedMap/`.

To regenerate lettering from the two supplied font files:

```sh
python3 scripts/illustrated-map/build-font-glyphs.py \
  --smallcaps /path/to/GreatForest-SmallCaps.ttf \
  --regular /path/to/GreatForest-v2-Simplified-Regular.ttf
```

To run the focused correctness checks:

```sh
npx vitest run src/lib/illustratedMap src/spaRoutes.test.ts
```

## Validation and limits

The generator is deterministic and free of DOM/network access. Tests cover finite/bounded hatch output, stable marks under resizing, maximum curvature, invalid controls, explicit output budgeting, standalone SVG parsing, image-free vectors, layer/export correspondence, resolved clipping references, shared route junctions and glyph-based lettering. The browser checks exercise the desktop and narrow-screen workshop, controls, tabs, reference overlay and downloads.

Visual verification uses the exact source raster, per-element side-by-side sheets, aligned overlays and the reconstructed full map. No accuracy number from the old tracing kit is claimed for this new drawing. The new route geometry is authored schematic geometry, and the icons are constructed interpretations. The hatch has deliberately new marks. The title study should be replaced with an authentic supplied master if the final application needs the official marketing lockup.

A direct MuPDF SVG conversion can ignore clipping, masks, `currentColor` and dashed strokes in this kind of file. It can therefore produce a misleading preview. Use a standards-compliant browser or Resvg for the final SVG check; PDF exports in the delivery are printed from the browser's actual SVG rendering.

## Extending this into a real PGMaps style

The reusable pieces are the component grammar, vector stroke generator, palette and SVG composition. A later geographic mode should obtain actual coastline/forest/road features through PGMaps' existing map toolkit, project them to an artboard, generalize them for the intended scale, reserve labels and symbols, and generate texture in stable projected coordinates. Its scale, attribution and geographic data provenance should remain distinct from this page-8 schematic. This reconstruction does not replace any existing live basemap, route geometry or forestry analysis.
