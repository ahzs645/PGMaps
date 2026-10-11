# Water-temperature dashboard preview

Open `/dev/water-temperature` from the development library. This page recreates
the core UNBC WaterTempVIZ workflow using PGMaps' React, MapLibre, shared UI and
Recharts stack: four-station comparison, search/coverage filters, daily/monthly/
seasonal means, a linked date-range navigator, calendar-aligned seasonality,
air/water scatter plots and filtered daily CSV export.

## Comparison with the reference

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
| OpenStreetMap, Esri imagery and no basemap                | Same basemaps and 50% raster opacity; additional PGMaps colors mode uses the designer's shared style transform                                                                                                   |
| Station symbols and initial camera                        | Green translucent circles before selection; gray context circles and larger selected rings, using the source's red/blue/green/purple colors. Initial center/zoom match the source; Fit all stations is explicit. |
| Daily/monthly/seasonal aggregation and custom season      | Included, with 75% calendar-day coverage                                                                                                                                                                         |
| Navigator, drag range, 1m/3m/6m/1y/All                    | Included; presets available in time-series fullscreen too                                                                                                                                                        |
| Mean/range and individual-year seasonality                | Both display modes, plus local XY drag zoom and reset                                                                                                                                                            |
| Air/water scatter, minimum air filter and XY zoom         | Included; tooltip identifies station, date and both temperatures                                                                                                                                                 |
| Clickable station legends                                 | One common legend shows/hides a station across all three charts; the source legends operate per chart                                                                                                            |
| CSV download                                              | Daily observations within the selected dates; hidden series remain in the export                                                                                                                                 |
| Image/PDF chart exports, help dialogs, guided tour        | Not ported                                                                                                                                                                                                       |
| Watershed boundaries and basin filtering                  | Not ported; referenced GeoJSON is absent from the local source snapshot                                                                                                                                          |

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

The scatter uses the reference's 2px points and density-dependent opacity,
independently scaled air/water axes, and a clipped 1:1 line. A single high-DPI
canvas renders every paired observation, avoiding thousands of React/SVG nodes.
Hover resolves the nearest observation within 12px and shows its station, date
and temperatures; filtering or resizing invalidates the old hover. Recharts
still draws the axes/grid, while the toolkit’s `XYPlot` handles interaction.

## Data sources

The Vite development middleware reads the existing sibling checkout at
`../unbcwatertemp-viz/public/data`. Set `PGMAPS_WATER_TEMP_DATA_DIR` before starting
Vite to use another snapshot directory. It serves only `stations.json`,
`config.json` and named station JSON files under `data/`.

The page is listed in the live `/dev` library as well as the local library.
Production loads `stations.json`, `config.json` and each selected station's
observations directly from the reference repository's public
[`main/public/data`](https://github.com/ahzs645/unbcwatertemp-viz/tree/main/public/data)
snapshot through `raw.githubusercontent.com`. It follows the repository's main
branch, so published data updates appear without rebuilding PGMaps. Station
files are fetched on selection and cached for the current page session.

No source files are copied into PGMaps or its production build. The local
middleware endpoint remains development-only.
The source config's update date and Daymet availability are available on the
header's information icon. Calculation notes live on the mode controls' hover
text so the dashboard reserves its space for plots. The frontend neither runs
the original R pipeline nor refreshes data.

OpenStreetMap and Esri imagery use actual raster tiles at 50% opacity. They are
not vector recreations of those maps. PGMaps colors uses Carto vector tiles
recolored by the same function as `/dev/design`; it is a separate visual preset.
Watershed filtering, a guided tour and chart-image exports are not included in
this first preview. The local source snapshot contains no watershed GeoJSON or
station basin assignments, so basin membership is not inferred.

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
tile fetching and named color presets remain host-owned. The source map's
watershed outlines/filtering are still unavailable in this checkout. This is
a code comparison, not a claim of pixel-identical Leaflet/MapLibre rendering.

Validate with the focused Vitest calculation tests, TypeScript and ESLint, and
`tests/e2e/water-temperature.spec.ts`. The browser tests stub station data and a
valid MapLibre style, test real marker selection and navigator movement, check
CSV contents and exercise mobile resizing, load retries, simultaneous desktop
graphs, calendar presets, legend visibility, pane collapse, every fullscreen
surface, and seasonal XY dragging.
