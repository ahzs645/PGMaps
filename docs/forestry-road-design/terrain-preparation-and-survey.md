# Terrain preparation and open survey handoff

The Terrain tab now includes explicit terrain preparation, independent image backgrounds and a
survey field book. Every terrain action makes a new checked original-ground grid and joins the
project's normal undo/save/restore path. The existing source is not silently modified in place.

## Combine ground sources

**Add GeoTIFFs to ground mosaic** combines the current embedded grid and selected GeoTIFFs.
Sources must use the same horizontal CRS and named vertical datum. Output uses the finest
source x/y cell spacing; an oversized result fails instead of silently degrading its resolution.
Choose whether the current or newly selected sources have overlap precedence. The first source
with a supported value supplies a cell; true gaps stay null. Bilinear sampling never bridges a
weighted missing source cell. The original source hashes and overlap choice are recorded.

**Combine LAS / LAZ sources** reads up to twelve files in a worker, checks their horizontal and
vertical CRS keys, combines the points, classifies when requested and creates one grid/TIN.
It uses the point-cloud options shown above the preparation panel. **Import GeoTIFF, LAS, LAZ or RoadEng**
at the top of the tab does the same when several LAS/LAZ tiles are chosen at once. Sources with
conflicting CRS keys are rejected, naming the files. Tiles that carry no CRS are asked about once
and take the EPSG code stated. Missing vertical keys are asked about in the same question; neither
this action nor the GeoTIFF mosaic takes the open terrain's vertical datum unless that is the
choice made there (`importTerrainWithAnswers` in `terrain.ts`).

**Preserve road corridor each side** retains full point density within the requested distance
of the active road's control line. It applies both to decoded-point thinning and the subsequent
TIN point budget. Surrounding points use deterministic lowest-point thinning. If protected
points alone exceed a budget, import fails and asks for a crop or a narrower corridor; protected
points are never silently discarded to make the budget. The pure preparation API additionally
accepts polygon AOIs. The displayed grid can still be coarser than source points where the
pre-existing output-cell budget requires it; preserved point density does not establish accuracy.

**Retain source TIN** stores source grid coordinates, elevations and constrained triangle indices
in the preparation record. This is optional because the arrays increase project size. The TIN
can be exported through **Save → Terrain surface LandXML**. With no retained source TIN the
export triangulates supported grid-cell vertices. Faces with missing vertices are omitted.
**Terrain ASCII grid** exports square-cell grids as ESRI ASCII, with a declared no-data value.
Both exports use the actual grid CRS and recorded vertical reference, not WGS84 elevations.

**Edit retained source TIN** selects a source vertex by index or finds the one nearest the
selected road station. Applying a new level rebuilds the grid from the edited triangle planes
while preserving constrained topology and source holes. This supports explicit level corrections;
it does not infer a new breakline or relocate vertices. Import a new breakline file and rebuild
the cloud TIN when topology must change. The edit and resulting cells join project undo/restore.

## Grade and combine design surfaces

**Grade a pad** places a rectangular plane at the selected road station with an entered level,
bearing, crossfall, longitudinal grade and cut/fill batter. The plane and its daylight batters
are sampled into the source grid; unsupported source cells remain unsupported. Review the
source footprint and resolution: a grid edge can clip a pad's daylight envelope. This is a
geometric grading operation, without retaining-wall or geotechnical design.

**Merge this road into ground for a junction** burns the calculated road prism and culvert
channels into the current square-cell grid. It uses the same `burnRoad` geometry as drainage,
then makes the composite available as original ground for another road. This avoids pretending
that two separate roads automatically share a finished intersection. The operation records
the road name and section count; its resulting grid and source hash are retained in the project.

Derived grids carry a hash of their grid and preparation record. Imported point-cloud terrain
also hashes its source identities and processing choices. A preparation record includes source
hashes/CRS/datums, processing method, classification/surface choice, breakline checksum,
preservation width and resulting cell size. The stored cells are sufficient for reopening;
rerunning point-cloud processing still requires the original source and breakline files.

Grading/composite actions also retain the previous checked grid as a named analytical reference
surface. Template components can reference these surfaces separately from current ground.
The Terrain panel lists removable snapshots; remove references from components before deleting
their target surface. A missing reference is a calculation error rather than default ground.
Every analytical reference must use the same explicitly named vertical datum as current ground.
Project parsing and sampler resolution reject mixed vertical references; no geoid conversion or
assumed equivalence between differently named datums occurs. Horizontal CRS conversion still
uses each reference grid's own projection.

Saved complete-cost currentness fingerprints the contents of the ground/reference grids and
retained TIN arrays, alongside their grid/datum/provenance metadata. Keeping an old source
checksum while editing cells therefore does not retain a current old cost. These compact
numeric fingerprints are change detectors rather than authenticity digests; independent image
background edits remain display-only.

## Independent canopy and image layers

Import a single-band canopy-height GeoTIFF or byte-valued RGB(A) orthophoto in **Canopy and image
backgrounds**. Each keeps its own source CRS, opacity and visibility. The plan displays the
projected image over the basemap/terrain, with road graphics above it. Canopy values use a
0–40 m green ramp. A background layer never becomes analytical ground or supplies missing
ground elevations. Background pixels and hashes survive project save/reopen. Rotated images and
images with no CRS are rejected.

The display pixels are stored in the project, so all backgrounds share one budget. An image that
fits what is left keeps its own pixels. A larger one is resampled for display, never refused for
its size: each source pixel is averaged into the display pixel under its centre, weighted by
opacity so no-data does not tint its neighbours, and the footprint stays the file's
(`resampleBackground` in `terrainPreparation.ts`). It takes at most half the budget, so a canopy
image and an orthophoto fit together. The notice and the layer's own line give the file's size,
the displayed size and the displayed pixel in metres. When the budget is spent the import says to
remove a background first.

## Survey field book and geographic linework

Enter observations as `station,bearing_deg,horizontal_m,grade_pct`, beginning from an entered
project-grid easting, northing and elevation. Bearings are clockwise from grid north. Optional
side shots use `id,station_index,signed_offset_m,height_difference_m`; negative offsets are left
looking forward along the traverse. The first station has index 0.

For a known closing coordinate choose **Bowditch**. Horizontal and vertical closure corrections
are distributed proportionally to each leg's horizontal distance. The preview reports raw
horizontal closure and its closure ratio, while CSV includes adjusted grid coordinates, CRS,
vertical datum and method. There is no uncertainty estimate, angle adjustment or instrument
correction model. A perfectly closed traverse has zero closure rather than an invented ratio.

### Ground and grid distances

**Horizontal distances are: Ground distances** reduces taped or EDM distances to the UTM grid
before the traverse is laid out (`scaleFactor.ts`). The book shows the factors it uses at the
survey start:

- the point scale factor k of the Transverse Mercator grid at that place (Snyder 1987, eq. 8-11,
  GRS 80, k₀ 0.9996);
- the elevation factor EF = R_G / (R_G + h), with R_G the Gaussian mean radius √(ρν) and h the
  ellipsoidal height: the start elevation plus the entered geoid height N (about −17 m around
  Prince George on CGG2013a; 17 m of error moves the factor by under 3 parts per million);
- the combined factor CSF = k × EF. Grid distance = ground distance × CSF, applied to each leg and
  side-shot offset. Heights still come from the ground distance and grade.

At Prince George (53.917° N, 122.75° W, 700 m) CSF is 0.99949373: 1,000 m on the ground is
999.494 m on the grid, and a 1 km traverse left unreduced is about 0.5 m long on the grid. One
factor serves the whole book, which is fine for a few kilometres; a long traverse that crosses
much of a zone or climbs a lot needs splitting. **BC Albers is refused**: an equal-area grid's
scale depends on direction (1.0027 north–south and 0.9973 east–west near Prince George), so no
single factor exists. Reduce in the UTM zone. A grid that is not UTM is refused the same way.

The LandXML export states the combined factor at the road's middle station in its header comment,
at the road's level with no geoid height.

**Save field book to project** preserves the observations and reduction settings. Saved books
can be reopened under the same CRS and vertical datum. **Add survey line** creates a separate
editable horizontal road line. Observed levels remain survey evidence; they are not silently
adopted as the road's engineered formation. **Export survey CSV** includes traverse stations and
side shots, with text protected against spreadsheet formula execution.

### Traverse files, start stations and station equations

**Load traverse file** reads a traverse in one of the text formats RoadEng's Survey/Map and
Terrain modules read (`traverseFiles.ts` over `softreeTraverse.ts`): a Softree ASCII (`.ASC`) or
IPD traverse, a Polycorder Roads traverse, a unit survey (`.pol`) or a Laser Technology raw survey
(`$PLTIT`). The content decides the format, never the name. None of them states its units, so the
book asks for them for every file and has no default; the raw format's own unit letter is
reported when it differs from the answer, never used in its place. A unit survey also asks what
its vertical readings are (inclination, zenith angle, slope %, elevation difference or elevation)
and whether its distances are slope or horizontal, because RoadEng takes those as import options,
not from the file. A file that gives no absolute start (Polycorder always, a unit survey without
an `SR` record) says so and is read from the **Survey start** fields. Reading fills the book's
start, legs, side shots, start station and station equations; the notice says how far the file's
own coordinates lie from the reduction where it gives them, and what the book could not hold.

### Field notes and writing them back

What a traverse file holds beyond legs and side shots is the book's **field notes**
(`SurveyBookRecord.softree`, `SoftreeTraverseDetails`): per station the labels, ground layers and
their depths, a culvert, HI/HT, the backshot, side-shot depths and codes and the ground slope beyond
the last side shot; and the located points (IFS and radial shots, unit-survey shots that are not
square side shots). Lengths stay in the file's unit. The **Field notes** fold under the side shots
lists each station that has any, one row each: its name, then its label, culvert size, ground layers
and HI/HT as tags. A row opens the station's notes for correction: label, between-station label,
ground layers and depths, HI/HT, and the culvert (size and box width in millimetres, gradient,
downstream azimuth and direction; added or removed). Side-shot depths, slopes beyond the shots and
the backshot are shown as read. **Add field notes at** gives a station without notes a culvert or a
label. The leg's rise is the slope reading plus HI minus HT, so changing HI or HT moves that leg's
grade in the traverse CSV by the same rise and the reading stays as taken. Edits change the open
book only; **Save field book to project** adds it as one undo step, and once a book is saved or
opened, **Save** writes it in place (one undo step each time) and **Save as new** adds a copy.

Every traverse writer writes the notes its format has a field for (`softreeTraverse.ts`), and the
export notice names the rest with their counts ("Not written, because a unit survey has no field
for them: culverts at 1 station; …"):

| Format            | Writes                                                                                                                                              | Has no field for                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Softree ASCII     | labels 1 and 2, three ground layers and two depths, culvert, HI/HT, backshot, two depths per side shot, slope beyond the shots, points as IFS shots | side-shot codes                                                                                                                          |
| IPD               | the same, and side-shot codes                                                                                                                       | —                                                                                                                                        |
| Polycorder Roads  | label, two soils (2 characters) and the top depth, culvert width, one depth per side shot, slope beyond the shots when under three shots              | between-station label, third layer, second depth, culvert gradient/azimuth/direction, box height, HI/HT, backshot, second side-shot depth, codes, points |
| Unit survey       | labels as point codes, HI/HT on each foreshot, points as side shots named by their own name                                                         | between-station label, ground layers, culverts, backshot, side-shot depths, slopes beyond the shots                                     |

Culvert sizes follow each format's convention (`softreeCulvert.ts`): Softree ASCII writes a pipe's
diameter or a box's height and width in thousandths of a unit; IPD a pipe in millimetres (inches in
a feet file) and a box in units; Polycorder's culvert width has no stated unit and is read as the
ASCII size. A culvert moves between formats and units through metres; written back in its own
format and unit it is written as read.

The book also keeps the file as written (`SoftreeTraverseSource`: each record's line, the line
ends, the version line), when it fits the book's limit. Written back in the format and unit it was
read in, a record whose leg, side shots and notes are unchanged keeps its bytes, and an edited one
changes only the fields whose values changed: TYPE bits, reference shots, turning-point flags, blank
fields, padding spaces, backshot and repeated unit-survey shots and D:M:S angles all survive. An
unedited book read from Softree's help examples (the road survey, the boundary traverse with its
spaces and its typo, the Polycorder rows, the unit survey) comes back **byte for byte**, as do
generated files in every writable format in metres and feet. Across formats or units the records
are written afresh: the same traverse and the notes the format holds, number formatting the
writer's. A file too large to keep as written keeps its notes, and the notice says it will be
written afresh. In a unit survey whose main line changed in number or names of points, the survey is
written afresh and the notice says so; an edited side shot there is written in place of the one
read, under its own point name.

**Start station** is the field station of the survey start, and a **station equation** renames the
chain from a back station on: from the back station (start station plus horizontal ground distance)
on, stations are named from the ahead station. RoadEng's formats have no field for equations; a
station column that jumps by more than its rounding is read as one, and the writers write field
stations so RoadEng, which reads only the first station, builds the same traverse. Back stations
must rise along the traverse and lie on it (`checkStationEquations`). The reduction states the
range of field stations, and the survey CSV gives each station's `field_station` beside its grid
`chainage_m`. Field stations run on ground distances: with **Ground distances** a grid chainage is
divided by the combined scale factor first.

**Export traverse file** writes the open book as a Softree ASCII or IPD traverse, a Polycorder Roads
traverse (three side shots a side, three decimals for new numbers) or a unit survey, in the units
chosen, with its start station, equations and field notes where the format carries them. After a
file is read, or a book with notes opened, the format and units start at the file's own. The notice
lists what the format could not carry.

### Softree terrain and location ASCII

**Import terrain** also reads a Softree terrain ASCII file (one line per point: name and sub ID,
station, X, Y, Z, comment), known by its content (`softreeImport.ts`). The format has no TIN and no
flag for which features are ground, so the ground is a TIN of every levelled point, rasterised at
half the TIN's median edge (1 m at finest). A feature whose levels are all 0 is a drawn feature with
no level and is left out of the ground, as PGMaps' own RoadEng export writes such features. Drawn
features do not become layers; a RoadEng terrain (`.terx`) brings those. **Import road line** reads
a RoadEng location ASCII coordinate file in either of the help's example layouts: the subgrade's
`CL` points are fitted as a road within 0.1 m, the subgrade levels become its profile, and the
ground (`OG`) levels its design-file ground. Neither file states its units or coordinate system:
both are asked, and a project on a flat plane reads them in its plane. Both files are also written
from Save & export ([Exports and project files](exports-and-project-files.md)).

Every spatial import accepts KML and KMZ ([how files are read and classified](exports-and-project-files.md#bringing-spatial-files-in)).
KMZ needs `doc.kml` or one unambiguous KML file. Placemark points, lines and polygons with their
holes are read with their names; a placemark never says what a feature is, so `parseKml` assigns
no kind and the import asks. KML altitude is discarded, because it does not establish ground or
a compatible vertical datum. XML entities/DTDs and external network links are not followed. Native RoadEng, DWG and proprietary field-collector projects still need a
documented exchange specification; these open imports/exports do not imply binary compatibility.

## Limits and checks

| Limit                                                                                     | Enforcing implementation                                                    |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 12 ground/mosaic sources; 1 GB combined point-cloud files                                 | `MAX_TERRAIN_SOURCES`, `mosaicRasters`, `loadLas`                           |
| 4,194,304 output cells, with no mosaic coarsening                                         | `MAX_PREPARED_CELLS`, `mosaicRasters`                                       |
| Point thinning: existing 3,000,000 decoded points / 1,500,000 TIN points                  | `DEFAULT_MAX_POINTS`, `tinSurface.ts` `MAX_POINTS`                          |
| Retained TIN: 250,000 vertices / 500,000 faces                                            | `gridSurface`, `parseTerrainPreparation`                                    |
| TIN elevation editing: 100,000,000 triangle-cell checks                                   | `editTinElevation`                                                          |
| Named analytical reference surfaces: twelve / 4,194,304 total cells                       | `parseTerrainReferenceSurfaces`                                             |
| Preservation regions: 2,000 vertices / 100 polygons / 100,000,000 point-vertex operations | `preservedPointMask`                                                        |
| Six backgrounds / 1,048,576 combined display pixels                                       | `MAX_BACKGROUND_PIXELS`, `parseTerrainBackgrounds`                          |
| Resampled background: at most 524,288 display pixels; refused under 16,384 left           | `BACKGROUND_LAYER_PIXELS`, `MIN_BACKGROUND_PIXELS`, `loadTerrainBackground` |
| Background file: 64 MB / 33,554,432 source pixels                                         | `loadTerrainBackground`, `MAX_BACKGROUND_SOURCE_PIXELS`                     |
| Graded pad ≤500 m wide / 1,000 m long, batters 0.1–10 H:V                                 | `gradePad`                                                                  |
| 20 saved field books / 2,000 legs / 10,000 side shots / 100 km per traverse               | `parseSurveyBooks`, `reduceTraverse`                                        |
| Combined scale factor 0.999–1.001; UTM zones only                                         | `SCALE_FACTOR_LIMITS`, `combinedScaleFactor`, `scaleFactor.ts`              |
| KML: 30 MB expanded / 500 features / 50,000 vertices / 100,000 XML elements               | `xmlTree`, `parseKml`, `readSpatialFile`                                    |
| Traverse file: 50 MB / 20,000 records / 25 side shots a side / 100 station equations      | `MAX_TRAVERSE_FILE_BYTES`, `MAX_TRAVERSE_RECORDS`, `MAX_SIDE_SHOTS_PER_SIDE`, `MAX_STATION_EQUATIONS` |
| Start station ±10,000 km; field notes: 20,000 stations or points / 2,000,000 characters a book, the file as written included | `MAX_SURVEY_START_STATION_M`, `MAX_SURVEY_SOFTREE_ITEMS`, `MAX_SURVEY_SOFTREE_CHARS` |
| Field notes: 10,000 characters a label or kept line; three ground layers; 25 side shots a side | `MAX_SURVEY_SOFTREE_TEXT`, `parseSurveyBooks`, `MAX_SIDE_SHOTS_PER_SIDE`        |
| Unit-survey side shot within 5° of square to its leg                                      | `SIDE_SHOT_SQUARE_DEG`                                                      |
| Polycorder export: three side shots a side, three decimals                                | `POLYCORDER_SIDE_SHOTS`, `POLYCORDER_EXPORT_DECIMALS`                       |
| Softree ASCII: 200 MB of text / 10,000,000 terrain points / 2,000,000 location points      | `MAX_SOFTREE_ASCII_BYTES`, `MAX_SOFTREE_TERRAIN_ASCII_POINTS`, `MAX_SOFTREE_LOCATION_POINTS` |
| Terrain ASCII ground: cells from 1 m; 1,500,000 TIN points                               | `SOFTREE_TERRAIN_MIN_CELL_M`, `tinSurface.ts` `MAX_POINTS`                  |
| Location ASCII road: fit within 0.1 m; profile from 0.01 m, at most 498 PVIs              | `SOFTREE_LOCATION_FIT_DEVIATION_M`, `SOFTREE_PROFILE_TOLERANCE_M`, `SOFTREE_MAX_PVIS` |

Analytical tests cover protected points and budget failure, mosaic overlap/no-data/CRS rules,
pad planes and batters, retained-TIN validation, LandXML/ASCII coordinates and missing faces,
Bowditch closure, signed side shots, malformed surveys, KML polygon holes/altitude handling and
a real zipped KMZ. `traverseFiles.test.ts` writes a field book in every traverse format, recognises
each by its content and reads back the same traverse, start station and equations, writes a book
with field notes back byte for byte in each format in metres and feet, and refuses saved notes a
writer cannot use; `softreeTraverse.test.ts` writes the help's examples back byte for byte through
the field book, writes a generated file with every note into every format in metres and feet (with
an equation) and reads back each note the format holds, and changes one field for one edited note;
`tests/e2e/forestry-road-survey-traverse.spec.ts` loads a generated file, reads its notes, corrects
a culvert, exports the file (one field changed) and reads it back;
`surveyInterchange.test.ts` checks field stations through equations and on ground distances, and
the CSV's `field_station` column; `softreeImport.test.ts` brings a location file written from a
calculated road back as that road (length within 0.07 m on a 428 m road with a 60 m curve, levels
within 0.07 m) in metres and in feet on a flat plane, and a terrain file back as its ground. Existing LAS/LAZ, TIN/breakline and terrain-restoration tests remain in the run.

### Provenance of the scale factors

Written from a functional specification (RFLTools §7 and §13.8, clean-room stage 1, 10 November
2026); no code from RFLTools (GPL-3.0) was used. The series and factors follow Snyder, J. P. (1987),
_Map Projections — A Working Manual_, USGS Professional Paper 1395, §8, and the geoid note
Natural Resources Canada's CGG2013a. Unlike RFLTools, one convention holds throughout (grid =
ground × CSF; RFLTools' survey block uses its reciprocal), scaling is about the survey start rather
than the drawing origin, and Albers is refused rather than given one factor. `scaleFactor.test.ts`
reproduces the specification's table: k 0.99960000, 0.99972341 and 0.99960331; EF 0.99984340 and
0.99989037; CSF 0.99956686 and 0.99949373; and the local-to-grid point 516,519.949 m E.
