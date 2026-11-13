# Detail DEM areas and folder imports

**Layers → Add folder** reads nested shapefiles with their own sidecars and coordinate system.
The role dialog suggests numbered operational road names from `FEATURE_NAME`/`FEATURE_NA`
and a canonical block filename such as `ABC123.shp`; every choice remains editable before import.
Boundary copies, historical openings, visual inventory and other reference files stay reference.
References start hidden on import and reopening. Planned blocks remain visible. When **Load
proposed roads into the road switcher and profile** is checked, each proposed line also becomes
an editable road. Its empty vertical alignment follows the calculation ground; importing a line
does not invent formation controls. Disconnected multiline parts remain separate. Reimporting
an identical named road does not duplicate it. Numbered names belonging to another block are
kept distinct, never assigned to the enclosing folder's block.

**Prepare 1 m DEM download boxes after import** opens an area review, without reading elevation.
It makes buffered rectangles per feature rather than a huge envelope between distant blocks. Feature envelopes above the per-box budget split into native tiles at most 2,048 m a side (`HRDEM_BOX_SIDE`); all their cells are retained. Envelopes above the total download budget still require a smaller selection.
Choose individual features, change the buffer, omit boxes, show them on the plan, or download
their GeoJSON. Reference layers explicitly used as cutblock buffers are excluded from these
automatic DEM candidates. Other reference shapes remain selectable. No file or elevation
request starts until the user chooses an output or **Load this area**.

**Download 1 m DEMs** writes a ZIP with one Float32 GeoTIFF per successful box, the boxes, and a
coverage report naming every failed box. The native 1 m grid, EPSG:3979, CGVD2013 and no-data
survive export. Downloads do not replace calculation terrain. **Load this area** loads a single
box into the project's calculation terrain and embeds it in the project file; Undo restores the
previous terrain. A failed or uncovered box leaves the existing terrain unchanged.

## Sources and coverage

Native ground comes only from NRCan's `hrdem-mosaic-1m` STAC collection and its **dtm** COG asset,
using integer pixel windows of the base image, never a DSM or resampled overview. Files are on
`canelevation-dem.s3.ca-central-1.amazonaws.com`, which supports CORS and byte-range requests.
The very large mosaic files are never downloaded whole. The batch retains at most two open
mosaics so adjacent boxes reuse their metadata and byte blocks.

The national model's 1 m coverage is incomplete in BC. A catalogue tile's broad envelope does
not establish coverage: valid native cells do. Missing cells remain null, and a wholly empty
window is an error. There is no automatic substitute for missing 1 m ground. A user may separately
choose the regional screening source, which keeps its own resolution and datum label.

The plan's **High-resolution DEM relief** uses NRCan's WMS `dtm-hillshade`: the best available
HRDEM display source can be 1–2 m, rendered at map scale. It is display only, never analytical
ground. It loads visible 512 px tiles from z12 through z16 and reuses z16 above that. Regional
Terrarium relief sits underneath, capped at z12. The selected project terrain is drawn above
these context layers, and Sentinel stays above the rasters and below engineering layers.
Selecting **Basemap** disables both relief backgrounds.

**Show nearby active FSR records (1 km)** is off by default. On load/download it queries each
box's buffered local area, merges overlapping query windows and deduplicates source road IDs.
It never queries the huge envelope between scattered boxes. FTEN active FSR tenure records are
review context, not proof of a built or usable road. Refreshing preserves user road judgements.
A failed area says records were not read, rather than reporting no FSRs.

## LidarBC: download, then load back

**Source → LidarBC · download, then load** lists the LidarBC bare-earth DEM tiles under the chosen
area (one block, road or the map view): 1:2,500 tiles first, then the older 1:20,000 sheets, newest
first, read live from the LidarBC tile index (`lidarBcDem.ts`, layers 5 and 6 of
`LiDAR_BC_S3_Public`). The files sit on the NRS object store, which sends no CORS headers, so the page
can link to them but never read them: each tile is a plain link, the reader downloads it, then picks
the files with **Load downloaded files…**. Sizes shown are the product's median from the
`docs/research/bc-lidar-portal.md` survey; the index carries none.

The files are read back through `Blob` slices (`localDemWindow.ts`), so only the strips the area
crosses are read: a 618 MB 1:20,000 sheet is fine. The window is the area's own bounding box,
widened by the buffer, in the files' projection (UTM, NAD83(CSRS)); the NRCan box drawn in
Canada-wide LCC comes out turned in UTM and needs a rectangle up to 2.7× larger, so it is not
reused. Cells stay native unless **Cell size** asks for 2–4 m, each the mean of its known source
cells, which a long or diagonal road needs to fit the road terrain's cell limit (the reference road with a
100 m buffer is about 5 million 1 m cells); the terrain's name and record say so. Several tiles of one acquisition join on their shared grid, the first file
wins where two overlap, and missing cells stay missing. The DEMs carry no vertical key; LidarBC states
CGVD2013 for them, and the terrain's vertical reference says so. The preparation record identifies
each file by a SHA-256 of its name, size and modified time, not its bytes, which would hold the
whole file in memory.

A listed tile is a footprint, not coverage. Under the reference block's roads (November 2026) the index lists
sheet `093i003` (NDMP Floodplains 2019), but the sheet has elevations only in its south-west corner;
the roads have no public LiDAR (no 1:2,500 tiles, no point-cloud tiles, no HRDEM). A load reports the
share of the area with elevations and names any file that had none there; a load with no elevations
at all is refused and the terrain is unchanged.

Above the tiles the dialog states LidarBC's acquisition status for the area (`lidarBcStatus`, the
layer behind LidarBC's availability dashboard): planned, flown ("Actual Acquisition") or available,
by year. It is the only public sign of LiDAR flown but not yet published; the reference block's roads read
"Actual Acquisition (2024)" with no tiles. The owner names the service "Progress_Dummy_Data", so the
line is a lead to confirm with lidar@gov.bc.ca, never a promise, and a failed read says "not read"
without hiding the tiles.

## BC CDED: download, then load back

**Source → BC CDED** is for where no LiDAR is published. CDED is BC's terrain from TRIM air photos:
posts every 0.75 arc-seconds, about 14 m east–west by 23 m north–south at 54° N. It is no finer than
the regional terrain and does not resolve a road bench; it is an independent survey, so it is a second
opinion on a hillside. The dialog names the half-sheets under the area from the NTS grid
(`cdedTilesFor`, no index is queried) and links them on `pub.data.gov.bc.ca`, which sends no CORS
headers; the reader downloads the zips (about 2 MB each) and picks them as they are. `cdedDem.ts`
unzips, parses the USGS-format ASCII DEM and keeps the posts around the area at their own spacing as a
WGS84 terrain, voids kept. Heights are stated as CGVD28 by the product specification; the files'
header datum code is kept in the preparation record and the claim is unverified for these files. A
link can be dead where BC publishes no file. Findings behind this:
`docs/research/bc-road-terrain-sources-2026-11-12.md`.

## Limits and budgets

| Limit                           | Value      | Enforcing constant/code                               | When exceeded                                |
| ------------------------------- | ---------- | ----------------------------------------------------- | -------------------------------------------- |
| Native cells per box            | 4,194,304  | `terrain.ts` `MAX_ROAD_RASTER_CELLS` / `detailWindow` | Larger feature envelopes split into bounded native tiles |
| Boxes per download              | 64         | `hrdem.ts` `HRDEM_MAX_DOWNLOAD_BOXES`                 | Omit boxes or split the download             |
| Native cells per download       | 32 million | `HRDEM_MAX_DOWNLOAD_CELLS`                            | Omit boxes or reduce the buffer              |
| Buffer                          | 0–2,000 m  | `detailWindow`                                        | Invalid input refused; UI offers 0–1,000 m   |
| Mosaic items per box            | 4          | `HRDEM_MAX_ITEMS`                                     | Refused, with no unbounded pagination        |
| Time per box                    | 90 s       | `HRDEM_TIMEOUT_MS`                                    | Aborted and recorded as unread               |
| Individual byte response        | 32 MiB     | `HRDEM_MAX_RANGE_BYTES` / `RangeClient`               | Refused; whole-file HTTP 200 also refused    |
| Byte transfer per mosaic/window | 64 MiB     | `RangeClient`                                         | Refused; choose a smaller box                |
| Range requests at once          | 4          | `RangeClient` read queue                              | Further ranges queue                         |
| Open mosaics in a batch         | 2          | `readHrdemWindow` session cache                       | Older handles released                       |
| Native boxes at once            | 1          | `downloadHrdemBoxes`                                  | Reads sequentially and can be cancelled      |
| FSR queries at once             | 2          | `detailFsr.ts` `loadDetailFsrs`                       | Further local windows queue                  |
| LidarBC tiles listed per area   | 60         | `lidarBcDem.ts` `LIDAR_BC_MAX_TILES`                  | List is cut and says so; choose a smaller area |
| LidarBC files read at once      | 12         | `localDemWindow.ts` `LOCAL_DEM_MAX_FILES`             | Refused; load fewer files                    |
| LidarBC cells read back         | 4,194,304  | `MAX_ROAD_RASTER_CELLS` / `readLocalDemWindow`        | Refused, naming the cell size that fits; pick one road or a smaller buffer |
| LidarBC cell size               | 1–4 × the file's cell | `LOCAL_DEM_MAX_CELL_FACTOR`                 | Refused                                      |

Provider requests do not poll or automatically retry failures. Large native loads and downloads
require the explicit action in the review dialog. The geometry and budgets are covered by unit
tests; the folder/import/profile and native-loader flows have browser regression coverage.

Sources: [NRCan CanElevation access documentation](https://nrcan.github.io/CanElevation/stac-dem-mosaics/),
[HRDEM mosaic metadata](https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b).
