# Visual quality: the simulation and report formats to remake (November 2026)

Can `/dev/forestry/visual-quality` remake every VIA in the
[report survey](forestry-visual-quality-report-survey-2026-11-11.md)? This page
answers from the figures themselves. Every figure in the 26 documents was cut
out and classified: 623 crops, of which **341 are simulations, perspectives or
the figures that support them**, plus 73 full pages showing how each format is
laid out.

The gallery is kept **outside the repository**, with the source files, because
the figures are third parties' work:

- `~/Downloads/via/_simulations/index.html` shows every kept figure, filterable by kind and by document. Each card gives what is drawn, how it was made, its framing, and what remaking it would take.
- `~/Downloads/via/_simulations/layouts/index.html` shows the 73 full pages.
- `simulations.json` holds the same records as data. `crops/` and `panels/` hold the images; multi-panel figures are cut apart in `panels/`.

Crop ids below (`c439`) refer to that gallery.

## The answer

**Yes, for every BC format in the set**, with one honest limit: realism. Each
format is a page layout filled with a few kinds of image, and the page already
computes every number any of them prints. What is missing is a handful of
render options (lens, fill style, outlines, callouts, panorama, a class pass for
pixel counts) and a way to lay pages out. Neither needs a new renderer. The road
view's camera already takes a vertical field of view (`DriveCamera.tsx`,
`setVerticalFieldOfView`). Frames are captured (`captureMapImage`), field photos
are aligned (`photoPose.ts`, `FieldPhoto.tsx`), the landform is draped,
`MapViewerCone` draws a view wedge, and jsPDF already writes the block note and
the FS1252.

The limit is that generated trees on 20 m AWS terrain will not look like a
Visual Nature Studio render on a 10 m LiDAR DTM, or like a retouched photograph.
The handbook ranks the methods (3.3.4): GIS drape, near-photo-realism 3D,
photo manipulation, LiDAR modelling. For the numbers, accuracy matters more than
realism. For a public referral page, the photo-montage route (S7 below) gives
realism without a better renderer, because the realism comes from the photo.

## The formats

| Format                                         | Documents                               | Page structure                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Images it needs                                                                                                                                              | Can remake                                                                                                                     |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **F1 Photo over simulation**                   | 01, 02, 12, 08, 10                      | Photo above the simulation of the same frame, captioned with viewpoint and date; 01 adds an overhead and an oblique "model confirmation" render                                                                                                                                                                                                                                                                                                                                 | S1 or S7, S8 (01 is ~7.5:1), S11                                                                                                                             | Yes, once S7/S8 exist                                                                                                          |
| **F2 Existing / proposed / analysed triptych** | 05, 06, 07                              | Per viewpoint: inset map with sightline, attribute table, rationale, then existing photo, painted montage and the same montage outlined (red VLU, purple rock, green proposed, orange private, yellow non-veg) with a cm² box; then the Appendix 1 form                                                                                                                                                                                                                         | S7, S3, S12, calc box                                                                                                                                        | Yes. The form data exists; needs S3 on S7 and the layout                                                                       |
| **F3 Perspective Viewpoint Analysis sheet**    | 03, 22, 23                              | 11×17 landscape title block, then a wide water-level render, then a footer with landform/blocks/viewpoint, inventory label key, % calculation box (pixels) and legend. Paired with an unannotated render and a photo                                                                                                                                                                                                                                                            | S1, S3 (landform outline magenta/purple/orange, blocks green outline over tan or magenta fill), S4 cyan callouts ("Likely not visible", "Possible glimpses") | Yes, with the class pass for pixel %                                                                                           |
| **F4 District comparison package**             | 04                                      | Strip of all viewpoints "scaled to viewing distance for comparison, 45 deg. field of view"; per viewpoint a render, a terrain-only render with VSUs and VQOs labelled, a lines-of-force overlay, a photo panorama with an "Area of Alteration" ellipse; % area table                                                                                                                                                                                                            | S1, S5, S6, S8, S10                                                                                                                                          | Yes; S6 needs the most new work                                                                                                |
| **F5 Calculation on the photo**                | 09                                      | Photo/simulation pair, then a grid over the photo with numbered polygons and a cm² table                                                                                                                                                                                                                                                                                                                                                                                        | S7, S3                                                                                                                                                       | Partly. The page measures from projection, not hand-drawn polygons; it can draw the projected outlines and print its own table |
| **F6 Referral panoramas**                      | 11, 13, 14, 15                          | Stacked very wide panoramas titled by viewpoint, treated ground tan with retained-tree stipple, plain-language caption                                                                                                                                                                                                                                                                                                                                                          | S7, S8, S2                                                                                                                                                   | Yes, once S7/S8 exist                                                                                                          |
| **F7 Pre / simulation / post**                 | 21 (FPB), 16                            | Three panels from one camera, yellow callout on the block at issue, "Private land" labels                                                                                                                                                                                                                                                                                                                                                                                       | S7 for the middle panel, S13                                                                                                                                 | Yes. Field-photo alignment is the hard part and exists                                                                         |
| **F8 Time steps**                              | 18, 19, 24, 25                          | Same view at each entry or year (2001/2015/2070; year 1/40/80; 2022/2032/2042), photo on top, coupes coloured by phase or species, natural-colour and seasonal variants, legend panel with 16 phase or 14 species classes                                                                                                                                                                                                                                                       | S9, S1, S15                                                                                                                                                  | Partly. Recovery years exist; harvest passes and thematic colour do not                                                        |
| **F9 EA before/after**                         | 26                                      | Before and after photo simulation, side panel with "Location map and viewpoint" (view wedge) and regional map                                                                                                                                                                                                                                                                                                                                                                   | S7, S12                                                                                                                                                      | Partly. The panel and wedge exist; built structures are out of scope                                                           |
| **F10 Deck and teaching slides**               | 08, 16, 17                              | Flat pink blocks on a render (08); Google Earth with yellow outlines (16, 17)                                                                                                                                                                                                                                                                                                                                                                                                   | S2 flat fill, S3 outlines                                                                                                                                    | Yes                                                                                                                            |
| **F11 Perspective view with overlay text**     | 27 (a licensee perspective view render) | One wide render with everything on the image: the title in the sky ("Visual Impact Assessment / area / blocks / Perspective View / Viewpoint n"), a "Visual Quality Objective Legend" panel at top left over subtly tinted VQO zones, proposed blocks yellow-tan, other blocks and openings paler tan, underlined labels above the skyline with vertical leaders, small white labels on secondary features, and a camera information block at bottom left (Appendix 7's fields) | S1, S2 flat fills, S3 zone tints, underlined labels, camera block                                                                                            | Yes: preset _Perspective view · overlay text_ (`perspective-overlay`), structure only                                          |
| **Forms**                                      | 03, 05 (2001); 06, 07 (Appendix 1)      | Covered in the [criteria reference](forestry-visual-quality-criteria-reference.md)                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                            | FS1252 exists; Appendix 1 per viewpoint is next                                                                                |

## The simulation styles

Each style is a render option or an overlay. "Have" means the page draws it
today.

| Style                                   | Seen in (example crops)                                                                                 | What is drawn                                                                                         | Page today                                                                                                | What it takes                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1 Natural eye-level render**         | 22 (c437–c472), 23, 03, 02, 06 not-visible proofs, 08                                                   | Terrain, generated conifers, water, sky; renders often water-level and very wide                      | Have: road view with terrain, imagery, VRI-calibrated trees, haze                                         | Lens presets (§ camera below). Water reflection is a nice-to-have; 03 and 22 render it                                                                                                |
| **S2 Alteration fill**                  | Tan with retained-tree stipple (05–07, 11–15, 21); pink or magenta flat (08, 22); white (09); grey (05) | The opening's ground, and retention within it                                                         | Partly: the road view clears trees in a block and shows thinned stands; ground is imagery or forest floor | A fill option per block: cleared ground (as now), slash/tan texture, flat colour, none. Fresh slash reads red-brown, not grey (21 found the grey montage understated contrast)        |
| **S3 Analysis outlines in perspective** | 03, 22, 23, 05–07 (c… "annotated" panels), 09                                                           | Landform outline, sub-landforms dashed, proposed blocks, existing non-veg, private land fill, rock    | Partly: landform and ridge bands drape                                                                    | Draped line layers per class, occluded by the terrain like the drape. A legend in the formats' own colours, or the page's own colours, chosen per template                            |
| **S4 Callouts**                         | 22, 23 (cyan), 21 (white, yellow focus), 01 (red), 03                                                   | Block id, visibility note, leader line to the visible part                                            | No                                                                                                        | Anchor at the visible part's screen centroid (the run knows which samples are seen), draw on the captured frame                                                                       |
| **S5 Terrain-only drape**               | 04 p141, 18 (c262)                                                                                      | Grey shaded terrain, VSU or constraint polygons draped and labelled with VQO                          | Partly: the EVQO drape exists                                                                             | A "terrain only" switch (no imagery, no trees, hillshade) and labels on the drape                                                                                                     |
| **S6 Lines of force**                   | 04, 18 (c263, c265)                                                                                     | Convexity and concavity arrows on the render and on the plan                                          | No; ridge layers exist                                                                                    | Ridges and hollows from the DEM (curvature), drawn as arrows in both views. This is the handbook's App 4 visual force analysis                                                        |
| **S7 Photo-montage**                    | 05–07, 09–15, 17, 21, 26                                                                                | The proposal painted into the real photo, hidden where the ground or foreground trees hide it         | Partly: the photo is aligned and proposal points project onto it                                          | Render the block mask from the aligned camera with terrain occlusion, then composite the S2 fill or S3 outline onto the photo. Season-match the fill (snow in 09, autumn larch in 12) |
| **S8 Panorama**                         | 01, 13–15 (8–10:1), 18 (3 × 45°), 22, 25                                                                | Several frames side by side, sometimes with azimuth ticks                                             | No                                                                                                        | Capture N frames at the chosen lens across a bearing range and join them (cylindrical), printing azimuth ticks. The handbook asks for ≥25% overlap in photos; renders need none       |
| **S9 Thematic and time steps**          | 24, 25 (phase and species colours), 18, 19                                                              | Coupes coloured by felling phase or species; the same view at year steps; newly altered vs greened up | Partly: recovery years exist                                                                              | Colour stems by an attribute (phase, species from VRI `SPECIES_CD_1`, age class). Grow regeneration by the height–age curve the page already holds                                    |
| **S10 Comparison strip**                | 04 p138                                                                                                 | Every viewpoint at the same field of view, stacked, "scaled to viewing distance"                      | No                                                                                                        | Batch-capture the recorded viewpoints at one lens, stack them, print the distance on each                                                                                             |
| **S11 Oblique and overhead check**      | 01, 05 p10, 02 p6, 19                                                                                   | Raised camera, footprints tinted and labelled                                                         | Partly: the route overview raises the camera 150 m                                                        | A raised camera preset over the block, footprints filled                                                                                                                              |
| **S12 Location inset with view cone**   | 06/07 inset maps, 21 appendix, 26, 18                                                                   | Small plan map: viewpoint, sightline or wedge, VQO lines, blocks                                      | Have: plan map, `MapViewerCone`                                                                           | Capture the plan framed on viewpoint and wedge at the lens's HFOV. App 7 asks for "centre and cone of vision lines matching the perspective view"                                     |
| **S13 Pre / post pairing**              | 21, 16                                                                                                  | Photo before, simulation, photo after, all from one station                                           | Partly: alignment works per photo                                                                         | Allow two photos per saved view (pre and post) with one camera                                                                                                                        |
| **S14 Stand condition**                 | 01 (red/grey pine), 03 (burned snags), 20 (MPB colour classes)                                          | Dead crowns, snags                                                                                    | No: the stand is live VRI                                                                                 | Crown colour from VRI dead-stem share or the aerial overview survey. Never a mask: dead forest is not alteration                                                                      |
| **S15 Season and light**                | 02 and 09 (winter), 12 (autumn), 25 (late spring, summer, autumn)                                       | Snow, larch colour, sun angle                                                                         | No                                                                                                        | Season tint on the stand and ground; sun position (the viewshed page has the solar code, planner review item 10)                                                                      |

## Camera and framing

The handbook fixes most of what the formats leave out:

- Lens 50 mm: "Use a 50- or 55-mm lens … Avoid wide-angle or telephoto lenses". HFOV 39.6° full-frame; 57 mm is "human eye equivalency".
- Eye height 1.6 m.
- The simulation uses "the same simulated focal length as the reference photos".

The formats in the set ran at:

- 45° (04);
- about 25° (05–07's 50 mm on a 1.6 crop body, 80 mm equivalent);
- panoramas of 100–140° (01, 13–15).

The road view runs at 36.9° vertical, about a 35 mm lens. Every remade figure
should therefore carry its lens and HFOV in the caption, and default to 50 mm.

A wide sheet such as F3 (about 3:1 to 6:1) is a panorama of 50 mm frames, not
one wide-angle frame. The fisheye corners in some of 22's renders are what one
wide frame looks like.

## Pixel percent from the render

F3 and F2 print a percentage measured on the image: pixels or cm². To print the
same kind of box from the page's own frame, add a **class pass**. Render the
same camera once more with flat colours, one per class:

- landform visible
- proposed block visible
- existing non-veg visible
- private land
- rock

Read the frame back and count pixels.

That pixel ratio is the apparent-area ratio the run already computes by
sightline, measured a second way. The two should agree within resolution, and
the page should show both. A disagreement means the drawn view and the analysis
differ (screening timber, sub-landform clipping). That is worth knowing before a
sheet goes out.

The box prints the denominator rule: gross, net of rock, net of private land.
F2's, F3's and F5's documents each use a different one; see the criteria
reference, section 3.

## How to build it: recipes and sheets

Two pieces of data, following the road designer's pattern of one command
registry laid out by `public/workspace-layouts.json`:

1. **A render recipe** names one image. It holds:
   - the camera: station or viewpoint, bearing or bearing range, pitch, lens in mm or HFOV, eye height, panorama frames;
   - the scene: imagery, trees natural/thematic/off, terrain-only, water, haze, season;
   - the alteration style: cleared, texture, flat colour, outline, none;
   - the overlays: landform, sub-landforms, VSU drape, non-veg, private land, rock, block outlines, callouts, lines of force;
   - the passes: colour, and the class pass for pixel %.

   A saved view already holds the camera, so a recipe is a saved view plus a style.

2. **A sheet template** places boxes on a page:
   - title block;
   - image slots, each naming a recipe;
   - tables bound to run fields (attribute table, % box, Appendix 1 fields);
   - legend generated from the recipe's overlays;
   - inset map;
   - free-text rationale.

   F1–F10 each become one template. jsPDF and the block note's image handling already do the drawing.

Keep both DOM-free where they compute, as `blockNote.ts` is: the recipe resolves
to MapLibre layer state in the page, and the template to jsPDF calls with images
passed in. A template copies a format's structure, never its branding: no third
party's logo, title-block artwork or company name. The logo slot is the user's
own, as the block-sheet rules require.

## Suggested order

1. **Lens presets and the caption block (S1).** Small. Every format needs them.
2. **Alteration fill and outlines (S2, S3), the class pass, and callouts (S4).** These give F3 and F10 outright, and the analysis panel of F2.
3. **Photo-montage (S7) and pre/post pairing (S13).** These give F1, F2, F6 and F7, the formats the public and the Board see.
4. **Panorama (S8) and comparison strip (S10).** These give the referral panoramas and F4's strip.
5. **The template layer**, starting with the Appendix 1 per-viewpoint form (F2's last page) and the F3 analysis sheet.
6. **Terrain-only drape (S5), lines of force (S6), oblique check (S11).**
7. **Time steps and thematic colour (S9), stand condition (S14), season and light (S15).** These are needed for F8 and the beetle and fire cases.
