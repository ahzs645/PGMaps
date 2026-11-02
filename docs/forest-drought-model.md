# Browser forest drought calculator

The research calculator in `src/features/forest-drought/model` is a pure
TypeScript adaptation of the daily water-balance kernel in
[`bcgov/forestDroughtTool` at `e02ddcbf`](https://github.com/bcgov/forestDroughtTool/tree/e02ddcbf8203e65bada1a36655887e1d0c8fe2f5).
It takes prepared daily climate observations and five soils, calculates daily
snow/water balance, and summarizes actual/potential evapotranspiration. It has
no network, DOM, random-clock, R, Rust or Wasm runtime dependency. The application
runs it in a Web Worker and terminates that worker to cancel a calculation.

The published **forDRAT** explorer is a separate product. Its published AET/PET
values and species risk ratings are not recalculated by this legacy model. The
legacy package uses ClimateBC 5.6 data preparation; the later forDRAT publication
identifies ClimateBC 6.21 and a different preparation workflow. A matching BGC
name does not establish numerical or scientific equivalence.

## Public API

```ts
import {
  parseClimateCsv,
  runSimulation,
  simulationSummaryCsv,
  simulationDailyCsv,
  simulationConfigurationJson,
} from '@/features/forest-drought/model'

const climate = parseClimateCsv(text)
const result = runSimulation({
  climate,
  latitude: 55,
  summaryPolicy: 'day-weighted',
}, (fraction) => reportProgress(fraction))
```

`runSimulation` returns the model ID and upstream revision, exact soils,
latitude lookup, input years, selected summary policy, original scenario
parameters, daily/monthly/yearly results, overall summaries and method notes.
Each scenario retains its own initial snowpack and adjusted daily climate.

The UI's run-record JSON includes the original uploaded CSV as well as model
settings and scenario parameters. `simulationConfigurationJson` is a smaller
settings-only export for independent consumers; preserve it with the original
climate file or daily export. Summary CSV has model/commit/validation, summary
policy, latitude, scenario, period, soil, means, totals, class, initial snow and
years. Daily CSV includes the model/commit, adjusted climate, snow, PET and every
soil's AET, daily ratio, storage, change and runoff. User-provided labels are
escaped against spreadsheet formula interpretation.

## Climate input contract

A CSV requires `date,tmn,tmx,ppt`, in any column order. Temperatures are °C;
precipitation is mm/day. `date` is `YYYY-MM-DD`. Optional `year`, `month` and
`day` columns must agree with the date. Additional columns are ignored; they
are not alternative field mappings. Quoted fields, UTF-8 BOM, CRLF and escaped
CSV quotes are supported. Empty/NA observations, malformed numeric strings,
duplicate headers, invalid dates and inconsistent row widths are rejected.

Inputs must be complete calendar years in strictly ascending, uninterrupted
daily order. Leap years require February 29. The calculator does not sort rows,
join disconnected years, fill missing days, estimate missing rain, or infer a
latitude. Supported date years are 1600–2399; temperatures must be within
−100–80 °C with minimum ≤ maximum; rain must be within 0–2,000 mm/day. These are
input integrity bounds, not a claim of model calibration throughout those
ranges. All numeric values must be finite.

The example generator creates a deterministic **synthetic** 2001 climate series
with a seasonal temperature curve and weekly rain. It is a format and
interaction demonstration, not a Prince George observation or future
projection. No sample result from it should be presented as site evidence.

## Core behavior retained from the R kernel

The translation follows
[`R/asmrCalc.R`](https://github.com/bcgov/forestDroughtTool/blob/e02ddcbf8203e65bada1a36655887e1d0c8fe2f5/R/asmrCalc.R):

- Monthly daylength is selected from the **50°, 55° or 60°** table. Latitude
  interpolation is not implemented, and arbitrary latitudes are rejected.
- Daily mean temperature, snow, vapor-pressure terms, radiation and Hargreaves
  PET follow the original equations and constants. Negative Hargreaves PET is
  set to zero; maximum temperatures ≤ 0 produce zero PET.
- Initial snowpack equals snowfall in the **last 47 input records**. With the
  enforced calendar contract this is November 15–December 31 of the final
  input year. It is a cyclic initialization assumption, not an observation of
  the snowpack before the first input day.
- The original first-day water-balance rule is retained. All five initial soil
  stores equal their AFC, and first-day runoff is zero.
- The original recurrence uses the current snowbank in `pPET`. Soil 3 and soil
  5 have special lateral-flow handling for negative infiltration rates. These
  equations are carried over, including their signs and previous-day rainfall.
- Soil storage is clamped **before** runoff/recharge, as upstream does. After
  that operation it can be negative or exceed AFC. Adding a second clamp would
  change subsequent daily ratios and is deliberately avoided.
- A day with PET ≤ 0 has ASMR 1. Otherwise ASMR is AET/PET. Neither daily ratios
  nor summaries are silently clamped to [0,1]. Nonfinite results fail the run.

The five default soils are decoded directly from the archived
`data/soilsData.rda`, with full binary64 precision retained in `constants.ts`.
Its SHA256 is
`729913da056da57ef03b452757c9b23eb12e68baf00316edd03de32109551b9b`.
The recurrence consumes AFC, AWSC and infiltration rate; the original root,
CF, AWSC1 and FC columns are not used by `asmrCalc`.

| Soil | AFC (mm, rounded for display) | AWSC (mm, rounded for display) | Infiltration-rate parameter |
| --- | ---: | ---: | ---: |
| Xeric | 24.480 | 17.392500 | 7.5 |
| Subxeric | 72.865 | 56.727231 | 25.9 |
| Submesic | 111.900 | 87.013636 | 24.9 |
| Mesic | 135.900 | 108.744340 | 0 |
| Subhygric | 109.440 | 81.015000 | −28.4 |

The coupled recurrence always requires all five soils, IDs 1–5 in that order.
Custom AFC must be positive and 0 ≤ AWSC ≤ AFC. All custom values must be
finite. The raw upstream infiltration convention is preserved; a negative
value has special lateral-flow meaning, not simply a negative rain observation.

## Summaries and classifications

Monthly results average all daily ratios for a calendar month across the input
years. They include winter and summer. **There is no May–September restriction
in this port or in the referenced `asmr()` wrapper.** Yearly results summarize
each complete calendar year. Overall summaries combine the chosen input years.

`summaryPolicy` applies consistently to baseline and custom scenarios:

| Policy | Overall/yearly mean ratio |
| --- | --- |
| `day-weighted` (default) | Arithmetic mean of daily AET/PET, giving every day equal weight |
| `equal-month` | Mean of the 12 calendar-month daily-ratio means, giving each month equal weight |

The ratio **ΣAET / ΣPET** is also returned under `ratioOfTotals`. It is not the
same statistic as either mean of daily ratios. It is `null` when total PET is
zero, while mean daily ASMR is still 1 in that case.

The original
[`asmr.R`](https://github.com/bcgov/forestDroughtTool/blob/e02ddcbf8203e65bada1a36655887e1d0c8fe2f5/R/asmr.R)
uses equal-month annual weighting for the current run but all-day weighting for
future runs. To reproduce those two published wrapper summaries individually,
use `equal-month` for the baseline and `day-weighted` for a future series. A
single browser comparison deliberately uses one visible policy for all of its
series. This is a documented wrapper change, not a claim of identical `asmr()`
behavior.

ASMR codes use the archived `asmrClass.rda` thresholds and R's right-closed
`cut` convention:

| Interval | Legacy ASMR code |
| --- | --- |
| 0 < ratio ≤ 0.55 | ED |
| 0.55 < ratio ≤ 0.65 | VD1 |
| 0.65 < ratio ≤ 0.75 | VD2 |
| 0.75 < ratio ≤ 0.85 | MD |
| 0.85 < ratio ≤ 0.95 | SD |
| 0.95 < ratio ≤ 1 | F |

Zero, negative, nonfinite and above-one values are unclassified (`null`).
These codes are not forDRAT species risk codes. The old `treeRisk` table is
archived as source evidence but not promoted into a new species classifier;
the repository does not provide an authoritative classifier using that table,
and its own documentation marks its lower-limit information as needing an
update. Published species risk remains in the forDRAT explorer.

## Climate scenarios and year selection

`applyMonthlyAnomalies` adjusts temperatures additively and rain
multiplicatively, matching the method in
[`asmrFuture.R`](https://github.com/bcgov/forestDroughtTool/blob/e02ddcbf8203e65bada1a36655887e1d0c8fe2f5/R/asmrFuture.R).
Each custom scenario must supply all 12 months exactly once, with finite
`{tminDelta,tmaxDelta,precipMultiplier}` values. Negative rain multipliers and
adjustments that produce invalid climate are rejected. Matching anomalies to
daily records never changes their chronological order.

`deriveMonthlyAnomalies` converts baseline/future monthly normals to those
coefficients. Baseline precipitation of zero makes the ratio undefined and is
rejected, including 0/0. `averageMonthlyNormals` supports averaging normals
before conversion, as the older code does for its mean-RCP scenario. The
browser does not label arbitrary user anomalies as ClimateBC 5.6, ClimateBC
6.21, RCP4.5, RCP8.5 or a particular future period. This implementation does
not bundle the old `bgcClim` projections as selectable forecasts.

`selectYearRange` selects an available continuous inclusive range. For
researchers who need the older preference for ten years from 1961–1990 within
1940–2000, `selectPreferredYears` supplies an explicit `count`, `preferred`,
`allowed`, and unsigned 32-bit `seed` policy. Sampling is repeatable Mulberry32,
not R's RNG sequence. The requested count is honored in both branches; the old
`yearSelect` hardcodes 10 in one branch. Fewer available years than requested
produce an error.

Use those selected years with **`summarizeCalculatedYears` after calculating
the entire continuous climate series**. This preserves the snow and soil state
from intervening years. It reports original source years and selected years
separately. It does not reproduce `asmrRun`'s disconnected random-year input
concatenation. `asmrSelect` calls a `summariseASMR` helper not defined in the
pinned package; the new summary API provides an explicit replacement.

The browser never calls `cleanECData`. Its precipitation expression
`mean(ppt2,ppt3)` passes the second observation as R's `trim` argument, and its
`*_filled` output columns do not match the daily kernel's input contract.
Rejecting missing observations avoids silently choosing a correction. Weather
downloading and scientific gap filling remain preprocessing responsibilities.

## Limits and budgets

| Limit | Enforcing constant / rule | Purpose |
| --- | --- | --- |
| CSV size | `MAX_CLIMATE_CSV_BYTES = 8_000_000` | Bounds upload/parser work; UI checks file bytes and parser checks string length |
| Daily observations | `MAX_CLIMATE_DAYS = 36_600` | Roughly 100 continuous complete years |
| Custom scenarios | `MAX_SCENARIOS = 9` | Baseline plus up to nine sensitivity runs |
| Combined work | `MAX_SOIL_DAY_EVALUATIONS = 500_000` | `days × 5 soils × (1 + scenarios)` bounds CPU and retained daily output |
| Soil count/order | Exactly five, IDs 1–5 | Coupled lateral-flow recurrence depends on row position |
| Scenario IDs | Unique safe IDs of 1–80 characters; `current` reserved | Stable exports and worker/result selection |

A ten-year input with nine scenarios is about 183,000 soil-day evaluations and
fits this budget. The budget is an application resource limit, not a new
scientific model parameter. Progress reports completed daily work. Worker
termination cancels CPU work; the pure synchronous kernel has no network job
to cancel.

## Verification and upstream R comparison

The local model suite covers calendar/CSV failures, leap days, exact class
boundaries, first-day and final-47-day snow behavior, dry-season depletion,
negative lateral-flow cases, unchanged input arrays, scenario validation,
weighted summaries, parameter export, reproducible year selection, and work
limits:

```sh
npx vitest run src/features/forest-drought/model
```

The reference harness executes the **original unmodified `asmrCalc.R`**, whose
Git blob is `df6c6f4bbe409f1085b314d0eae62455b1f01677`, using the original soils
and class RData. `upstream/manifest.json` records exact Git hashes, SHA256 and
byte sizes for every archived source file. `verify-upstream.mjs` checks them.

```sh
node scripts/forest-drought/reference/verify-upstream.mjs
node scripts/forest-drought/reference/create-inputs.mjs /tmp/drought-cases
Rscript scripts/forest-drought/reference/generate-reference.R \
  scripts/forest-drought/reference /tmp/drought-cases /tmp/drought-r-reference
node --import tsx scripts/forest-drought/reference/compare-reference.mjs \
  src/features/forest-drought/model/index.ts \
  /tmp/drought-cases /tmp/drought-r-reference
```

The final command can instead run in plain Node against a compiled ESM model
entry point; all three path arguments are explicit for standalone forks. R
needs `dplyr` and `tidyr`, only for development verification. They are never
needed by the browser application.

The 15 comparison cases combine three latitude tables with two-year seasonal
and lateral-flow cases, a fully frozen leap year, a rain-free warm leap year,
and intermittent heavy rain. They compare every returned daily temperature,
radiation, PET, snow, snowpack, potential balance and five ASMR values, plus
soil/class parameters, with relative-scaled tolerance
`abs(TS − R) / max(1, abs(R)) ≤ 1e-10`. This establishes parity for those cases;
it does not validate the later forDRAT methodology, the original data-cleaning
or scenario/year wrappers, or biological predictive performance. Results are
written to `comparison-report.json` beside R's daily CSVs and `R-session.txt`.

The actual R comparison passed in [the fork's reference workflow](https://github.com/ahzs645/forestDroughtTool/actions/runs/41406309038)
using R 4.5.2 and the compiled browser modules. The [recorded report](forest-drought-r-validation.json)
contains 15 cases, 7,680 daily rows and 84,501 scalar comparisons. Maximum
absolute difference was 5.542233338928781e-13; maximum scaled difference was
4.18554080283684e-14, below the 1e-10 tolerance. The report identifies the tested
port commit and the downloadable daily reference outputs. The workflow reruns
this comparison on fork changes. Internal storage/runoff arrays, which the R
kernel does not return, and the deliberately adapted wrappers are outside this
agreement claim. The tool remains a research model.

A synthetic ten-year run (2000–2009; 3,653 daily records, baseline plus nine
adjustments, 182,650 soil-day evaluations) completed in 274 ms under Node
v24.22.1 in the development executor. This is a local timing observation, not
a browser or mobile performance guarantee. It does not justify adding a Wasm
runtime for this workload; larger workloads should be profiled separately.

## Licensing

The model adaptation and archived reference sources are Apache-2.0, retaining
Province of British Columbia's 2019 attribution. These files do not become MIT
merely because the PGMaps host uses MIT. The upstream repository and commit are
linked in the UI and exports, and the fork preserves the upstream license.
