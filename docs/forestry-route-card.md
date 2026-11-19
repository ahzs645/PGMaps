# Route card and Other Considerations

Step 1 of `/dev/forestry/visual-quality` has a **Route card** section. For a chosen block it:

- reads the block's Route Card Tool Assessment live from public BC layers;
- takes the rows no public layer holds from the reviewer, or measures them from the reviewer's own file;
- drafts the Other Considerations paragraphs, with the maps the planners paste under them.

Save & export writes the same thing as **Route card**: the planners' workbook (`.xlsx`) or a Word document (`.docx`).
The section, the workbook and the Word file come from one render (`assembleRouteCard`), so they always say the same
thing. It is a screen and a record of review: nothing in it changes the visibility run.

Code: `src/lib/forestry/routeCard/` (DOM-free; the kit, exceljs and `fetch` are passed in) and, on the page,
`RouteCardPanel.tsx`, `useRouteCard.ts`, `routeCardEngine.ts` and `routeCardLayerFile.ts`. The evidence behind
every rule below is in `docs/research/route-card-reproduction-2026-11-18.md`.

## Rows and presets are data

- `catalogue/rows.json` lists one entry per route card row:
  - its label;
  - its source: `wfs` for DataBC's WFS, `arcgis` for the bcgwpub MapServer, or `notPublic`;
  - the fields it prints;
  - its search;
  - and, where PGMaps estimates the answer, its `estimate`.
- `catalogue/presets.json` arranges rows into a sheet's sections and lists the considerations it drafts. `reads`
  names rows read only for the paragraphs, such as the BEC subzone.
- Both are read through the hand parsers in `rows.ts`, so a preset made for another district is checked the same way.

### The rules, measured against the route card tool's own output

- **Y:** a feature touches or overlaps the block or road.
- **Within 200 m:** the nearest feature lies within 200 m. A feature 1.3 m away was Within, not Y.
- **N:** otherwise.
- **Existing Roads:** Y to 400 m and Within to 600 m (inferred from seven cases).
- **Invasive species:** Y for any site within 5 km, with no Within state.
- **Migratory Bird Rankings:** every forest inventory stand that touches the block.

The tool prints "Within 200 m of Block" even for the 600 m road search; PGMaps prints the distance it actually
searched. Distances are measured in BC Albers metres on features served in EPSG:3005.

Rows that share a layer and filter share one read. A row that could not be read prints *Not read*, and a row no
public layer holds prints *Not public*. Neither is ever N, because N says the layer was looked at and nothing was
there. Rows whose layer was chosen by name and never seen positive carry `confirmed: false`, and their note says so.

### Rows no public layer holds, and how each is filled

| Row | What it is | How the row is filled |
| --- | --- | --- |
| First Nations | The Consultative Areas Database. Its public report (the CAD map's *SOE Report*) named the same nations as the tool on every test block, but it sends no CORS headers, so a browser cannot read it | Enter it; the row links to the database |
| MK/PG/RV OP# and referral dates, BCTS Roads, Block State | BCTS records. The public BCTS layers hold only part of them; the developed states (WIP, PP) are named-user only | Enter it, or import a BCTS export |
| CSFN ESI moose rows, ESI study area | Held under the Environmental Stewardship Initiative's data agreements | Enter it, or import the layer if you hold it |
| Arch Sites | RAAD, restricted to licensed users | Import your own RAAD site export, or enter it |
| Fisher rows (11) | The BC Fisher Habitat Working Group's habitat retention layer (bcfisherhabitat.ca), one download per region | **Import the regional download as it comes** (below) |
| Migratory Bird Rankings | An industry nest-density matrix that is not published | **PGMaps estimates it** (below); enter the tool's ranks to replace the estimate |
| Lakeshore Management Zones | Lake classes on the district's plan maps only | Enter it; zones run 250 m from class A lakes, 100 m from B to D and 50 m from E |
| Cable line | Public: TRIM cultural lines coded cable or aerial cableway | Read live (`confirmed: false`: no test block was near one) |

An entry or import is the reviewer's record (`viaReview.routeCard.blocks[block id].entries`), marked with its source
in every file. An imported file is measured by the row's own rule (`imported.ts`), and only the answer is kept: the
file itself is never stored.

### The fisher rows from the Working Group's own download

The 11 fisher rows are the fields of the Working Group's retention layer, one for one:

| Row | Field |
| --- | --- |
| Natural Resource Region | `Region` |
| Natural Zone | `Fisher_habitat_zone` |
| Harvest Impact Warning | `Harvest_impact_warning` |
| Denning, Branch Resting and Cavity Resting warnings and stems/ha | `*_warning`, `*_primary_density` |
| CWD single and piles | `CWD_resting_piece_density`, `CWD_resting_pile_density` |

Each row is filled through its `importField`. To import it:

- Pick the region's zip as downloaded; it holds a File Geodatabase. `routeCardLayerFile.ts` opens it with gdal3.js
  (`dev-avast/gdal.ts`) and chooses the layer that carries the route card's fields.
- Only the features round the block are read, through the layer's spatial index. The Omineca layer has about 700,000
  polygons in 548 MB and took about 3 minutes to read round one block in the browser.
- One import fills all 11 rows. The layer is kept in memory for the session, and *Measure* fills another block with
  one click.
- Real-number fields print as the tool prints them (`0.0`, not `0`).

The route card tool used the **June 2021** release (version 210215). It reproduced the tool's values for 10 of 11 test
cases exactly, order included. The 2025 release (version 250108) gives other warnings and densities, so the version is
printed with each entry. The download states no licence, so PGMaps never bundles or fetches it: the reviewer imports
their own copy.

### The migratory bird rank estimate

The tool ranks each forest inventory (VRI rank 1) stand 1 to 6 with an industry nest-density matrix, by:

- BEC zone;
- stand type;
- age class;
- height class.

The matrix is not published. PGMaps estimates the rank with its own stated rule (`catalogue/birdNestRank.json`,
`birdRank.ts`):

- **Start from age:**

  | Age | Starting rank |
  | --- | --- |
  | 80 years or less | 2 |
  | 81 to 250 years | 3 |
  | Older than 250 years | 4 |

- **Stands older than 80 years:** +1 at 19.5 m tall, +2 at 28.5 m.
- **Stand type:** −1 for 75% pine or more, −1 for a black spruce lead, +1 for 25% deciduous or more.
- **Limits:** the rank stays within 1 to 6. Ground that is not treed has no rank.

Against the ranks the tool printed for eleven blocks and roads, on VRI read in November 2026, the estimate gave:

- 4 of 11 sets exact;
- 28 of the 34 printed ranks found.

The tool appears to rank an older inventory: back-dating stands about seven years made 5 of 11 exact. That offset
is not applied, because it rests on an unknown inventory vintage.

The estimated row is marked *Estimate* in the section, and "Estimated:" in the files' notes. An entered rank replaces
it. Do not change the rule to fit a matrix copied from a dataset without a licence; add evidence to the calibration
instead.

## Other Considerations: wording as rules

- **Wording:** each consideration is a document-kit JSON component in `catalogue/considerations/`.
- **When it is called for:** `catalogue/considerations.json` holds the condition (`when`), checked against the facts.
  From the planners' sixteen sheets:
  - **Visuals:** only when EVQC is Y. "Within 200 m" never called for it.
  - **TAP:** when the remnant row is Y or Within.
  - **Caribou:** when the winter range row is Y.
  - **Arch:** when Arch Sites is Y.
  - **Old Forest, Patch Size, Watershed, Migratory Bird Habitat and Fisher:** always.
- **The facts:** `facts.ts` measures and names them, as plain values, never as wording:
  - the NDT and its main subzone;
  - the old-seral target from `catalogue/biodiversity.json`, by NDT, zone and biodiversity emphasis option;
  - the share of the block in draft OGMAs;
  - which side a TAP polygon lies on;
  - how far the access road runs through TAP and winter range units;
  - the patch made with openings and planned blocks within 100 m;
  - the fisher classes and bird ranks.
- **Missing values:** a value the facts lack prints as a bracketed placeholder and is listed to complete. It is never
  guessed.

`biodiversity.json` holds only figures the planners' paragraphs confirm: NDT1 ESSF 19%, NDT1 ICH 13% and NDT2 9%
(all low BEO, older than 250 years), and the NDT1/2 patch classes (x-large has no target). Add a row only with its
source.

What only the reviewer gives is asked for under *What the paragraphs ask you for*:

- how the unit meets its old-forest objective;
- the patch analysis's current and future figures;
- the patch decision and initials;
- a TAP note.

The reviewer's own paragraph replaces the draft and is kept, with the draft offered again by *Use the draft*. The
Visuals paragraph is step 5's own: the reviewer's when written, else the draft. The hand-copied sheets name the wrong
block in 12 of their sentences; a generated draft takes the name from the scene.

## Figures

The planners paste a picture under some paragraphs: a map under TAP and under caribou, and a road-view screenshot
under Visuals.

- **TAP and caribou maps:** `figures.ts` draws them from the same reads the route card made, in BC Albers, north up,
  with a legend, north arrow and scale bar:
  - TAP remnant polygons and draft OGMAs, with the block and its access road;
  - winter range units, with no-harvest zones darker.
- **Visuals:** carries up to three views saved of this block.
- **Where they show:** the sidebar shows the maps under their paragraphs. The files rasterise them with
  `sheetPngBlob`. They are drawn from data, never a screenshot.

## Files

**Excel**

- *Route Card Tool Assessment* puts the title in B2 and each section as a coloured band from row 4. Each row's label,
  value and names sit in B, C and D at the rows the tool writes them (District at 5, RVQC at 77), Y rows in bold.
- PGMaps' notes on the route card (why a row was not read, who entered it, an estimate) go in column E, outside the
  tool's columns.
- *Other Considerations* puts the topic in B and the paragraph in C from row 2. Its figures sit in the same row, under
  the text, side by side, scaled so the row stays within Excel's 409-point limit.
- Nothing else goes beside the paragraphs: what the file is, and what it is not, is on the *Notes* sheet.

**Word**

- The recipe's own document, written by document-kit's `writeDocx`: the route card as a table, then each
  consideration with its figures.
