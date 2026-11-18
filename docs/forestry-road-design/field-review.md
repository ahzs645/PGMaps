# Field review: issuing a road to the crew and reading what comes back

Read this before you send a preliminary road to a field crew from **Review → Field review**, before
you import a crew's KML or KMZ, or before you change `fieldReview.ts`, `fieldPackPdf.ts`,
`FieldReviewSection.tsx`, `src/lib/geoPdf/writeViewport.ts` or the KML reader in
`surveyInterchange.ts`.

Field review covers the loop between a designer and a reconnaissance crew. The designer sends a
candidate road with specific questions (crossings, landings, rock, wet ground). The crew answers
them on a phone, offline, and the designer reads each answer against the road the crew walked and
the road as it stands now. The first release does this for one road at a time. It records each
answer and the station the designer confirms, and it **never changes the design**: a crossing
answer opens the culvert inputs at its station, and the designer makes any edit there.

## Issue field pack

**Issue field pack** makes an _issue_ (`issueRoad`) and stores it in `project.fieldReview.issues`
as one named undo step. An issue keeps:

- its label (`FR-01`, `FR-02`…, unique in the project), the road's id and name, the active
  profile's id, the revision typed beside the button and the day of issue;
- the road's **fitted centreline** as it was, longitude and latitude every
  `ISSUED_CENTRELINE_STEP_M`, with each vertex's chainage (`roadCentreline`);
- the station ticks every `FIELD_PACK_TICK_M`, as printed;
- the terrain's name, vertical reference and EPSG code;
- its checks. Each check has a stable id and a short label the crew writes back: `C-` crossing,
  `L-` landing, `R-` rock, `W-` wet ground, `X-` other, numbered per kind in station order of
  entry (`nextCheckLabel`). A check is a point or, with a length, a range.

Checks start as the Crossing Register's rows (`crossingCheckDrafts`, one per crossing, linked by
`crossingId`). **Add check at the selected station** adds a landing, rock, wet-ground or other
check at the plan's selected station, as a range when a length is entered. The bin leaves a check
out of this issue.

The issue keeps its own centreline because the designer will move the road before the crew comes
back. An answer is then read on the line the crew walked.

The button downloads two files built from the same issue:

- **KML** (`fieldPackKml`): the centreline, the station ticks and one placemark per check. The
  issue and check labels are in each placemark's **name**, which the crew sees, and in its
  `ExtendedData` (`issue_id`, `issue_label`, `check_id`, `check`, `kind`, `station`,
  `chainage_m`), which a returned file keeps.
- **Geospatial PDF** (`fieldPackPdf`): page 1 is the plan, north up and flat, framed on the issue
  with the issued centreline and checks drawn over it from the issue's own geometry. Page 2 lists
  each check with its station and question. Page 1 carries a `/VP` map frame
  (`addMapViewports`) over the image's rectangle, with the image's four corners and Web Mercator
  as its CRS. Web Mercator is the projection the plan was drawn in, so a reader's affine fit is
  exact.

The PDF is made from the plan map. The plan is turned north-up and flat (pitch and roll 0, any 3D
terrain off), framed, captured and put back in a `finally`. A globe projection is refused rather
than registered. The capture is `withNorthUpPlan` (`planCapture.ts`), the same path a framed Map
PDF takes ([Map PDF](exports-and-project-files.md#map-pdf)); the field pack keeps the plan's own
pixel ratio and composes at twice CSS size, as it always did. A downloaded issue can be downloaded again from its row; removing an issue keeps
its observations and clears their match.

## Import observations

The crew records observations on a layer of their own, with the check's label (`C-03`) in the
point's name, note or a `check` attribute, and returns that layer as KML or KMZ. **Import
observations** reads it through `readSpatialFile` and keeps every **point** as a pending
observation (`readObservations`). This release counts lines and areas as "not read" rather than
importing them.

- The KML reader keeps each placemark's `ExtendedData` (both `<Data name><value>` and
  `<SchemaData><SimpleData name>`), its `id` as `kmlId`, and its `TimeStamp/when` or
  `TimeSpan/begin` as `timestamp`, as text properties the way a shapefile's attributes arrive. An
  attribute named like one of the reader's own properties (`name`, `description`, `source`) is
  kept as `kml_<name>`. Before this, the reader dropped every attribute.
- An observation's key is its placemark id, else a hash of its name, position and time
  (`observationKey`). Importing the same file again adds nothing and says how many were already
  held.
- An observation joins a check only by the check's label or id written in the file
  (`namedCheck`: attributes first, then name, then note), and only when exactly one check
  matches. A label two issues share matches nothing until the file names the issue. Otherwise the
  designer chooses; nearby checks (`FIELD_CHECK_NEAR_M`) are listed first and marked.

## Review changes

Each observation shows two station readings:

- **Station as issued**: every place the issued centreline comes within `FIELD_MATCH_RADIUS_M`
  of the point, nearest first (`stationCandidates`), with the signed offset (negative left
  looking up-station). Only local minima of distance count, and feet closer than
  `FIELD_CANDIDATE_SEPARATION_M` along the road are one candidate. The two legs of a switchback
  are two candidates, and the panel says "choose the leg"; a matched check puts the leg nearest
  its own station first.
- **Station now**: the same reading on the issued road as it stands, so a moved road shows where
  the answer now falls.

**Accept** records the chosen issued and current chainages, the check and the date. **Reject**
records the decision. **Review again** reopens it. Each is one named undo step. An accepted
crossing answer on the active road offers **Culverts at this station**, which opens the existing
culvert inputs there.

## Avenza and other field apps

- Avenza Maps imports a geospatial PDF and KML/KMZ features. It needs a **Pro** subscription for
  work use, so pilot with a crew that already has it. Test structured fields with a schema exported
  from Avenza itself; its exported placemarks carry them as `ExtendedData`, which the reader now
  keeps.
- QGIS/QField can open the KML and the PDF too. QFieldSync's offline packaging is a later option;
  the issue and its checks do not depend on the app.

**Not yet verified on a device.** The registration is pinned in `writeViewport.test.ts` against
PGMaps' own reader (interior points within a millimetre, GDAL's Web Mercator WKT accepted). A
real export opened offline in Avenza, and a GDAL-written reference PDF in the tests, are still to
do.

## What this release does not do

- Read a returned traverse (`.tr1`) against an issue. Use the survey field book; attaching a book
  to an issue is the next step.
- Turn a material observation into a ground-horizon assignment, or a crossing answer into a
  culvert. Both stay the designer's edits in their own editors.
- Read returned lines or areas.

## Limits and budgets

| Limit                                                         | Value          | Constant                                 |
| ------------------------------------------------------------- | -------------- | ---------------------------------------- |
| Issues a project keeps                                        | 50             | `FIELD_REVIEW_LIMITS.issues`             |
| Checks an issue takes                                         | 200            | `FIELD_REVIEW_LIMITS.checks`             |
| Observations a project keeps                                  | 2,000          | `FIELD_REVIEW_LIMITS.observations`       |
| Issued centreline vertices (coarser spacing past this)        | 5,000          | `FIELD_REVIEW_LIMITS.centrelineVertices` |
| Issued centreline spacing                                     | 2 m            | `ISSUED_CENTRELINE_STEP_M`               |
| Station ticks on the pack                                     | 100 m          | `FIELD_PACK_TICK_M`                      |
| Distance from a centreline that gets station candidates       | 75 m           | `FIELD_MATCH_RADIUS_M`                   |
| Candidates closer than this along the road are one            | 30 m           | `FIELD_CANDIDATE_SEPARATION_M`           |
| Candidates listed per road                                    | 3              | `FIELD_MAX_CANDIDATES`                   |
| A check this near an unmatched point is listed first          | 50 m           | `FIELD_CHECK_NEAR_M`                     |
| ExtendedData attributes kept per placemark; name; value chars | 50; 100; 2,000 | `KML_ATTRIBUTE_LIMITS`                   |

## Project file and Place on map

`project.fieldReview` is optional: a project without it reads and writes exactly as before
(`parseFieldReview`). It holds coordinates, so **Place on map** refuses while it holds anything
and names "field review issues" (`localPlane.ts`'s `UNMOVED`).
