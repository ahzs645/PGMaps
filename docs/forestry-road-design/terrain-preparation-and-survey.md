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
It uses the point-cloud options shown above the preparation panel. Sources with conflicting
CRS keys are rejected. Identical missing vertical keys need an explicitly entered vertical datum.

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
ground elevations. Background pixels and hashes survive project save/reopen. Rotated images,
unknown CRS and images over the budget are rejected; resampling must be an explicit external step.

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

**Save field book to project** preserves the observations and reduction settings. Saved books
can be reopened under the same CRS and vertical datum. **Add survey line** creates a separate
editable horizontal road line. Observed levels remain survey evidence; they are not silently
adopted as the road's engineered formation. **Export survey CSV** includes traverse stations and
side shots, with text protected against spreadsheet formula execution.

Road/context import additionally accepts KML and KMZ. KMZ needs `doc.kml` or one unambiguous
KML file. Imported lines and polygon holes become normal geographic linework and pass through
the existing alignment/context validation. KML altitude is discarded, because it does not
establish ground or a compatible vertical datum. XML entities/DTDs and external network links
are not followed. Native RoadEng, DWG and proprietary field-collector projects still need a
documented exchange specification; these open imports/exports do not imply binary compatibility.

## Limits and checks

| Limit | Enforcing implementation |
| --- | --- |
| 12 ground/mosaic sources; 1 GB combined point-cloud files | `MAX_TERRAIN_SOURCES`, `mosaicRasters`, `loadLas` |
| 4,194,304 output cells, with no mosaic coarsening | `MAX_PREPARED_CELLS`, `mosaicRasters` |
| Point thinning: existing 3,000,000 decoded points / 1,500,000 TIN points | `DEFAULT_MAX_POINTS`, `tinSurface.ts` `MAX_POINTS` |
| Retained TIN: 250,000 vertices / 500,000 faces | `gridSurface`, `parseTerrainPreparation` |
| TIN elevation editing: 100,000,000 triangle-cell checks | `editTinElevation` |
| Named analytical reference surfaces: twelve / 4,194,304 total cells | `parseTerrainReferenceSurfaces` |
| Preservation regions: 2,000 vertices / 100 polygons / 100,000,000 point-vertex operations | `preservedPointMask` |
| Six backgrounds / 1,048,576 combined display pixels | `parseTerrainBackgrounds`, `loadTerrainBackground` |
| Graded pad ≤500 m wide / 1,000 m long, batters 0.1–10 H:V | `gradePad` |
| 20 saved field books / 2,000 legs / 10,000 side shots / 100 km per traverse | `parseSurveyBooks`, `reduceTraverse` |
| KML: 30 MB expanded / 500 features / 50,000 vertices / 100,000 XML elements | `xmlTree`, `parseKml`, `readSpatialFile` |

Analytical tests cover protected points and budget failure, mosaic overlap/no-data/CRS rules,
pad planes and batters, retained-TIN validation, LandXML/ASCII coordinates and missing faces,
Bowditch closure, signed side shots, malformed surveys, KML polygon holes/altitude handling and
a real zipped KMZ. Existing LAS/LAZ, TIN/breakline and terrain-restoration tests remain in the run.
