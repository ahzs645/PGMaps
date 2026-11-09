# Cutblocks, harvest history and road status

The **Terrain → Cutblocks & harvest history** panel in `/dev/forestry/road-design`
connects historical harvested areas to a review of nearby mapped roads. Cutblocks
have their own panel; they are no longer mixed into **Constraints**.

## Try the scenario

1. Open **Projects → Browse example scenarios** and choose **Training · cutblocks
   and old access roads**. Its terrain, cutblocks and road events are synthetic and
   explicitly labelled. The saved reference year is 2026.
2. In **Terrain → Cutblocks & harvest history**, choose a cutblock. Read its age
   and source evidence, then **Locate cutblock on plan**.
3. Choose a nearby road candidate and **Review selected road**. The existing-road
   panel shows its physical-event evidence separately from tenure dates.
4. On the plan, click a cutblock or existing road to open its review. The map's
   **Table** button offers cutblock and road tables, including source identifiers,
   dates, search, sorting and CSV export. Hidden context layers also disappear
   from the table.
5. For real data, open a regional scenario with mapped cutblocks, or use your own
   terrain. **Load BC cutblocks** queries the area near the project roads.
   **Load roads near this cutblock** queries all FTEN tenure statuses around the
   selected block, so retired records are not excluded from historical review.

The existing **Design → Access from FSR** (End → **Planned block**) workflow still
proposes new connectors to eligible FSR sections. A nearby-road candidate in the
history panel is only a proximity result. It does not establish a connected
route, a constructed road, permission to travel, or an earthworks saving.

## Historical harvest evidence

The provincial source is [Harvested Areas of BC (Consolidated Cutblocks)](https://catalogue.data.gov.bc.ca/dataset/b1b647a6-f271-42e0-9cd0-89ec24bce9f7),
through [the published ArcGIS layer](https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer/4?f=pjson).
The adapter retains the unique `VCCB_SYSID`, `OPENING_ID` when available,
`DATA_SOURCE`, source/published dates and retrieval time. Multipart source
features become separate project polygons with stable part identifiers.

| Source field                             | Meaning in this workspace                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `HARVEST_START_DATE`, `HARVEST_END_DATE` | Source estimates of the start and end of the harvest interval. Retained with their calendar years and labelled estimated. |
| `HARVEST_START_YEAR_CALENDAR`            | Reported start year. Alone it does not establish when harvesting ended.                                                   |
| `HARVEST_MID_YEAR_CALENDAR`              | Source midpoint year. Ages based on it are labelled estimates.                                                            |
| `DATA_SOURCE_DATE`, `PUBLISHED_DATE`     | Dataset provenance, never substituted for a harvest date.                                                                 |
| `AREA_HA`                                | Source polygon area; not recalculated or summed across split parts.                                                       |

The [November 2024 provincial methodology](https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/stewardship/forest-analysis-inventory/data-management/standards/about_consolidated_cut_blocks_2024.pdf)
describes the consolidated end date as an estimate: RESULTS contributes the
last logging disturbance completion, satellite change detection uses image
dates, and VRI contributes its harvest-year date. A populated date is therefore
not independently verified completion evidence. `yearMethod` distinguishes an
estimated interval, an estimated midpoint, start-only evidence and unknown
timing. The loader does not invent an end-year field: it derives `endYear` only
from an explicit `HARVEST_END_DATE`. Midpoint age never means years since
completion. Imported stand age, fire year and generic age columns are ignored.

**Harvest age reference year** is saved as `RoadProject.harvestHistoryYear`.
Elapsed calendar years describe time since reported harvesting; they are not
stand age or an assessment of regeneration. A start/end interval produces an
age range. Missing completion evidence is explicit. Unknown or future history
is never silently turned into zero years of age.

The map groups known harvest ages into 0–10, 11–30 and 31+ years. A range spanning
groups remains uncertain rather than being assigned to one side of a boundary.
These are display groups, not silvicultural thresholds or road-condition rules.
Proposed blocks and unknown harvest history have separate labels. The legend is
built from the same feature properties as the map.

## Road status and deactivation

[Forest Tenure Road Section Lines](https://catalogue.data.gov.bc.ca/dataset/243c94a1-f275-41dc-bc37-91d8a2b26e10)
supplies road geometry and administrative attributes. Its
[published schema](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/196?f=pjson)
has `AWARD_DATE`, `RETIREMENT_DATE`, `FILE_STATUS_CODE` and
`LIFE_CYCLE_STATUS_CODE`. These fields do not establish the date of physical
road deactivation. `ACTIVE` alone does not establish a usable road.

The [Prince George district road notices](https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/local-road-safety-information/prince-george-natural-resource-district-road-safety-information)
include proposed and completed deactivations, with road numbers and kilometre
limits. Other districts are listed on [BC's local resource-road safety page](https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/local-road-safety-information).
These are useful evidence sources, but a notice can apply to only part of a
tenure line and a date beside a notice is not necessarily the date work was
completed. This release links the notices for review; it does not automatically
join web-page text to whole road geometries.

The district also publishes an [official Prince George road-alert map](https://governmentofbc.maps.arcgis.com/apps/webappviewer/index.html?id=da77454784c84d1098bd57385ecc1829)
with point notices for closures and deactivation. Its `REPORTED` field is the
notice report date, not a completed-work date. Records can be old or incomplete;
the district web page can carry newer notices. The [dataset catalogue](https://catalogue.data.gov.bc.ca/dataset/4e3e501d-2d21-456e-8789-917146d6f785)
marks this source **Access Only**. The workspace links the official viewer;
it does not copy, cache, export or automatically join those point records.

The consolidated-cutblock and FTEN catalogue entries also carry **Access Only**
terms; this guide does not describe any of these datasets as Open Government
Licence data. [BC catalogue guidance](https://www2.gov.bc.ca/gov/content/data/finding-and-sharing/bc-data-catalogue/list)
and [Map Hub terms](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/web-based-mapping/agol/terms-of-use)
distinguish source access from permission to reproduce or redistribute data.
This change retains the application's direct client-query pattern for cutblocks
and roads. It includes adapter code and synthetic training fixtures, with no
provincial source extracts bundled or rehosted. Source references remain in
project and CSV outputs so their applicable terms can be checked for downstream use.

Record physical evidence under **Existing roads & reuse → Physical road history**.
The source reference is required for a known event. Leave event dates blank
when the source does not establish them. Observing an already deactivated road
is recorded as an observation date, not invented as the deactivation date.
For a partial-road notice, import a line scoped to the affected segment before
assigning the event.

| Map appearance        | Evidence represented                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Red dashed line       | Recorded physical deactivation; still red if a reviewed rehabilitation scenario allows reuse. |
| Dark red short dashes | Closed or unavailable planning condition.                                                     |
| Blue long dashes      | Recorded reactivation; current road condition still requires review.                          |
| Amber dashes          | Reviewed rehabilitation planning input.                                                       |
| Teal line             | Reviewed serviceable planning input.                                                          |
| Slate dotted line     | Retired tenure with unknown physical condition.                                               |
| Grey dashes           | Unknown physical condition.                                                                   |

Saving a physical event clears the existing reuse opt-in. A deactivated road
can enter a reuse-cost scenario only after the user explicitly chooses
rehabilitation, records a planning or field-review basis and enables reuse.
The source status remains visible. No automatic current-condition, bridge
capacity, reactivation cost or legal permission is inferred from harvest age.

## Persistence and imports

Project JSON and the browser project library retain `harvestEvidence`,
`roadEvidence.deactivation` and the reference year. Context GeoJSON retains the
feature evidence; its age reference year remains a project setting. Existing
projects without these optional fields still load; their unknown history stays
unknown. Refreshing FTEN facts retains separately recorded physical-event and
condition evidence. If a road line changes, its retained evidence requires
scope review and reuse is disabled.

A road import can carry a `roadEvidence.deactivation` object, or a top-level
`properties.deactivation` object:

```json
{
  "status": "deactivated",
  "basis": "source-record",
  "reference": "Completed works report, section 3, road segment 2.1–4.6 km",
  "deactivatedOn": "2020-09-15",
  "observedOn": "2020-09-18",
  "notes": "Example schema only. Supply the actual source and segment geometry."
}
```

Use `reactivated` with a `reactivatedOn` date when supported, or `unknown` with
dates omitted. Calendar dates are validated strictly; impossible dates and
reversed event chronology are rejected. Example values above are illustrative.

## Bounds and failure behaviour

- The history panel uses a one-kilometre query margin around project roads or
  the selected cutblock. It ranks loaded road candidates within 1,000 m of the
  polygon footprint (`NEARBY_CUTBLOCK_ROAD_M`), accounting for polygon holes.
  It does not trace a connected network.
- Proximity geometry stops after 2,000,000 checks (`MAX_NEARBY_ROAD_CHECKS` in
  `harvestHistory.ts`) with crop/simplify guidance rather than partial candidates.
  The same source ID links split multipart cutblock polygons for this distance.
- Cutblock imports read GeoJSON, a zipped shapefile, KML or KMZ within the spatial import limits
  (120 MB, 500 features, 50,000 vertices; `spatialImport.ts`). A polygon with harvest evidence or
  the consolidated-cutblock fields keeps it; a plain polygon is **planned** or **harvested** as the
  importer chooses, never by default. A history panel request is bounded to 20 seconds
  (`HISTORY_LOAD_TIMEOUT_MS`).
- Queries reject over-wide extents and truncated or oversized responses.
  Project limits remain 500 context features and 50,000 context vertices; an
  over-budget merge is rejected before changing the project.
- A failed source leaves the current project intact and shows an error. It
  never substitutes synthetic records into a real-data load.
- Public layer refreshes can change coverage and source records. Missing
  mapped linework does not establish absence of a road, and a returned line
  does not establish that it was built.

The regression coverage checks date precision, unknown history, stable source
identifiers, save/reopen, multipart handling, proximity, deactivation/retirement
separation, road-reuse guards, map/legend/table agreement and the review controls.
The browser acceptance spec is included in the existing manual forestry-road
workflow; no new automatic workflow has been added.
