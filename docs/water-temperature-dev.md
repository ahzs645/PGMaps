# Water, weather and streamflow dashboard

Open `/dev/water-temperature` from the development library. This page recreates
the core UNBC WaterTempVIZ workflow using PGMaps' React, MapLibre, shared UI and
Recharts stack: four-station comparison, search/coverage filters, daily/monthly/
seasonal means, a linked date-range navigator, calendar-aligned seasonality,
air/water scatter plots and filtered daily CSV export.

## Water dashboard comparison with the original reference

Compared against the local reference's `src/pages/index.vue`,
`StationMap.vue`, `TimeseriesChart.vue`, `SeasonalChart.vue` and
`ScatterChart.vue`. It has **four surfaces: the map and three charts**,
not four independent chart panels. Seasonality switches between mean/range
and individual years. PGMaps now follows that arrangement:

| Reference capability                                      | PGMaps preview                                                                                                                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fluid dashboard; collapsible station column               | Full available width and height on desktop; fixed collapsible station pane, with search/list in a dialog                                                                                                         |
| Map + time series above two side-by-side comparison plots | Same simultaneous arrangement; stacked plots on phones                                                                                                                                                           |
| Chart fullscreen                                          | Full-window expansion on each chart, plus the map and entire dashboard; plots resize and stay mounted                                                                                                            |
| Four station overlays with stable colors                  | Shared map/list selection and matching colors across all plots                                                                                                                                                   |
| OpenStreetMap, Esri imagery and no basemap                | Uses the shared PGMaps Carto vector basemap, following the site's light/dark theme; no page-specific basemap selector                                                                                            |
| Station symbols and initial camera                        | Green translucent circles before selection; gray context circles and larger selected rings, using the source's red/blue/green/purple colors. Initial center/zoom match the source; Fit all stations is explicit. |
| Daily/monthly/seasonal aggregation and custom season      | Included, with 75% calendar-day coverage                                                                                                                                                                         |
| Navigator, drag range, 1m/3m/6m/1y/All                    | Included; presets available in time-series fullscreen too                                                                                                                                                        |
| Mean/range and individual-year seasonality                | Both display modes, plus local XY drag zoom and reset                                                                                                                                                            |
| Air/water scatter, minimum air filter and XY zoom         | Included; tooltip identifies station, date and both temperatures                                                                                                                                                 |
| Clickable station legends                                 | One common legend shows/hides a station across all three charts; the source legends operate per chart                                                                                                            |
| CSV download                                              | Daily observations within the selected dates; hidden series remain in the export                                                                                                                                 |
| PNG/JPEG/SVG/PDF chart exports and chart help             | Included in each compact chart options dialog                                                                                                                                                                    |
| Guided tour                                               | Not ported; chart-specific instructions are available in the options dialogs                                                                                                                                     |
| Watershed boundaries and basin filtering                  | Nechako outline and station membership use BC Freshwater Atlas watershed 8886                                                                                                                                    |

The station pane has no independent scroll port. Its map fills the available
desktop height, with one line per selected station below. Its color/code/name row also toggles
that station across all three plots. The common legend appears above the plots
when the station pane is collapsed and inside each expanded chart. Search, coverage
filters and the full station list open in the shared station-browser dialog.
The dialog retains selection and filters, restores focus to its trigger and
closes before the containing fullscreen dashboard when Escape is pressed.

Small desktop windows keep the plot grid scrollable when a usable chart height
cannot fit. Mobile uses ordinary page scrolling. Fullscreen exit preserves
station selection, the shared range, seasonal display and local scatter zoom.

Page actions, date inputs and range presets share a single desktop toolbar;
phones wrap the same controls. Station-pane, fullscreen and library actions use
labeled icon buttons, and CSV keeps a short visible label. Chart headers keep
their controls on one line. The two lower plots keep their controls in their headers and use the remaining
height for plotting. Like the reference, they zoom by dragging an XY rectangle;
Reset zoom appears inside the plot only after zooming. Focus a plot and press
`+` to zoom or `Home` to reset. Seasonality shows one nearby series in its tooltip,
with the observed range or the original individual-year date. Year grouping and
seasonal summaries are cached until the input series changes.
Mean & range remains the default. In either mode, hovering near a line emphasizes
that station or station/year and dims the other lines and bands. The tooltip
shows the observed range in mean mode and the original date in Years mode. Moving away, changing the data or zooming clears the emphasis.
Tooltip content wraps and stays inside each measured chart, including narrow
and fullscreen views. The timeline's vertical Water °C axis starts at zero when
readings are nonnegative, preserves below-zero readings and uses rounded bounds
and readable ticks for the visible date range.

The scatter uses the reference's 2px points and density-dependent opacity,
independently scaled air/water axes, and a clipped 1:1 line. A single high-DPI
canvas renders every paired observation, avoiding thousands of React/SVG nodes.
Hover resolves the nearest observation within 12px and shows its station, date
and temperatures; filtering or resizing invalidates the old hover. Recharts
still draws the axes/grid, while the toolkit’s `XYPlot` handles interaction.

## Data sources

The Water stations tab reads `stations.json`, `config.json` and selected
daily series from the [UNBC publisher feed](https://nhgwatertemp.unbc.ca/).
Source filenames may include spaces. The browser fetches and caches station
files on demand for the current page session. Downloads include the filtered
daily CSV with published minimum, maximum and reading count, plus links to
15-minute water and hourly air files when published. UNBC's daily water feed
also supplies air values without a per-reading provenance field. The dashboard
labels them as supplied air values. The [Zenodo archive](https://zenodo.org/records/15053907)
is the cited release for the publicly licensed 2019–2024 sub-hourly data.

Vite uses the sibling snapshot at `../unbcwatertemp-viz/public/data` when its
station catalog is present at startup. Set `PGMAPS_WATER_TEMP_DATA_DIR` to
select another snapshot directory.
The middleware serves the catalog, config and named station JSON under
`data/`. The browser fetches weather and streamflow from their public feeds
at runtime.

Both station maps use the shared light/dark Carto basemap. The watershed
overlay and membership filter use Freshwater Atlas named watershed 8886 in
PGMaps' existing stream-order-8 boundary snapshot. Filtering changes map and
browser membership. Water stations already selected remain in the comparison.

## Weather stations and measured air

Open the Weather stations tab directly with `?view=weather`. The UNBC weather
catalog lists locations, coverage dates, published fields and units, original
downloads, metadata and monthly gzip CSVs. The tab displays one station
and variable at a time at the source interval. It defaults to the last month
of that station's published record and fetches only months intersecting the
chosen date range. A valid range is read as soon as both dates are entered
(there is no Apply step), and the last readings stay up, faded, while the
next range loads. Each interactive window covers up to 92 days to keep the
original-interval chart and table responsive. The original archive link
covers the complete published record. The station map opens framed on every
station; its legend explains the marker colours.

Variable names come from UNBC's per-station data dictionaries (each
station's `MetadataLog.xlsx`, sheet "Params": logger column, parameter,
sensor model, height or depth), kept in `VARIABLE_LABELS` in
`weatherData.ts`. `SV_` columns are the SnowVue10 snow sensor, `SR50AT_` the
SR50AT, and the shortwave, longwave and albedo terms the Apogee SN-500 net
radiometer. Where the dictionary does not settle a meaning the name says only
what is certain: Browntop Mountain's `_2` columns are "second sensor", since
its log lists two anemometers without saying which column is which. Names
sort numerically, so depths read 5, 10, 15 cm. `weatherData.test.ts` pins
every variable the catalog offered in November 2026; a new column UNBC
publishes shows its raw name until it is added there.

Timestamp offsets, source units, multiple quality codes and missing readings
are preserved; units are printed as symbols (Deg C as °C) on screen, and the
CSV keeps them as supplied. The quality code summary, an (i) beside the
Quality codes filter, counts supplied codes across the chosen date range;
the filter controls the chart, table and filtered export.
Some codes describe conditions such as nighttime or a station visit. The
filtered CSV keeps the units row and all source columns. François Lake is a
metadata-only station in the reviewed feed.

Nulki Lake and Quesnel Lake West Arm are the two catalog IDs verified as
co-located across the networks. Their optional comparison matches the water
feed's daily date labels to the weather station's source calendar dates.
A measured daily air mean requires at least 72 distinct quarter-hour slots
marked Pass. Other sites need reviewed pairings and date conventions before
being used for combined analysis. Weather feed support, attribution and
reuse terms, update cadence, and the provenance of the water feed's supplied
air values remain questions for UNBC.

## Historical streamflow

Open the Streamflow tab with `?view=flow`. It pulls archived daily discharge
from Water Survey of Canada via GeoMet HYDAT for Vanderhoof (08JC001) and
Isle Pierre (08JC002). Choose a Nechako River temperature site independently.
The two charts share their date window and use different vertical units.
The initial summer 2024 range is a worked example with observations from
both sources. Missing dates stay open and CSV includes the discharge quality
symbol where supplied. The gauge link opens current readings separately.

## Semantics and boundaries

- Station filtering changes the browser/map, not the current comparison.
- Selected stations retain their assigned colors until removed.
- Legend visibility affects the displayed plots and their counts; it does not
  remove the station selection or its CSV observations.
- Date inputs, plot dragging and the navigator share one range. It filters both
  downstream charts and daily CSV rows. Aggregation changes reset that range.
- Monthly/seasonal means require 75% of actual calendar days, including leap
  years. November–February seasons start in November of the preceding year.
- Daily dates are calendar dates, plotted at UTC midnight to avoid time-zone
  shifts. Seasonal plots align month/day against the leap-year 2000 calendar.
- Zero is an observation; missing/nonfinite measurements remain missing. CSV
  includes blank missing values and the source snapshot date.
- Seasonality bands show observed minimum/maximum, not confidence intervals.
- Calendar zoom presets clamp month ends, including leap days.
- Scatter plots require paired air/water observations. Their minimum-air filter
  and zoom are local to that plot. Date-range changes still filter its inputs.

The dev page orchestrates state. `dev-water-temperature/data.ts` holds pure
calculations and `useWaterTemperature.ts` owns transport/cache/selection.
`Charts.tsx` is a domain adapter: it prepares UTC dates, calendar-year lines,
observed ranges and paired observations, then renders toolkit components.

Reusable charts live under `@pgmaps/geo-toolkit/visualizations/react`:
`TimeSeriesChart`, `LineBandChart`, `ScatterPlot`, `ChartViewport`, `XYPlot`
and canvas points. They accept numeric data, stable IDs/colors, axis formatters,
tooltip callbacks and controlled ranges. The toolkit's `/ui` exports
`DashboardToolbar`, `RangeControls`, `SeriesLegend`, `SelectedSeriesList`,
`FullscreenPanel`, `FullscreenButton` and `useElementFullscreen`.
The independent consumer's `/charts` page uses these same compiled exports with
synthetic energy data, numeric hour ranges and two independent workspaces.

The host supplies dates, presets, units, source data, filtering, aggregation,
export transport and layout. There is no water-temperature or station policy
inside the chart toolkit. The existing project-package schema is unchanged.

Basemap appearance is shared through `buildBasemapStyle` in the toolkit's
`/map/map-styles` export; both `/dev/design` and this dashboard use it. Source
tile fetching and named color presets remain host-owned. PGMaps draws its own BC Freshwater Atlas outline and filters station membership against that geometry.

Validate with the focused Vitest calculation tests, TypeScript and ESLint, and
`tests/e2e/water-temperature.spec.ts`. The browser tests stub station data and a
valid MapLibre style, test real marker selection and navigator movement, check
CSV contents and exercise mobile resizing, load retries, simultaneous desktop
graphs, calendar presets, legend visibility, pane collapse, every fullscreen
surface, and seasonal XY dragging.

## Chart interaction audit (2026-10-10)

Compared `TimeseriesChart.vue`, `SeasonalChart.vue`, `ScatterChart.vue` and
`pages/index.vue` at reference revision `ca382f9` against the host adapters and
shared toolkit. Fixed station labels disappearing from timeline tooltips; added
station-colored markers for monthly/seasonal points (including a lone seasonal
mean), period-specific tooltip headings with correct cross-year season dates,
and aggregation-specific axis units. Seasonality now emphasizes the inspected
line in both modes, dims unrelated bands and retains January/December ticks.
Mean & range remains the default. All three charts signal pending data loads,
even with the station pane hidden.

Each chart's options dialog has contextual help and PNG/JPEG/SVG/PDF downloads
of its current range/zoom, with title, units, period and station legend. SVG
retains vector lines/axes and embeds the scatter canvas as PNG. PDF embeds a
2× resolution chart image. Downloads are generated locally; no export service
receives the observations. Toolkit capture/options/loading behavior is generic;
PDF packaging, filenames and water-temperature text remain in the host.

The source uses per-chart legends; PGMaps intentionally retains its shared
station visibility control. Its UTC calendar dates, calendar-day coverage and
leap-year alignment also remain intentional corrections to the reference's
timezone/30-day aggregation/ordinal-day behavior. The reference's daily scatter
and its paired-point metadata are preserved without downsampling.

Browser checks verify aggregation markers and hover periods, nonempty rendered
chart pixels in downloaded PNGs (including canvas points), SVG axes/metadata,
PDF image content, fullscreen options/zoom preservation and collapsed-pane
loading. The independent energy consumer exercises the same export helpers and
options dialog through compiled toolkit exports.
