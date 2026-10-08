# Colour audit and scale lab

The review page is `/dev/color-palettes`, linked from `/dev`. It inventories
authored palettes, source colour groups, CSS theme roles and the used shades of
Tailwind's installed palette. Existing map pages are not recoloured by this lab.

Shared scales/colors now live in `packages/geo-toolkit/src/scales`, and shared
map palettes in `packages/geo-toolkit/src/map/map-styles.ts`. Existing application
paths are compatibility exports. The audit follows those exports and scans the
package sources, preserving palette ownership and explicit member references.
`createScaleLegend` and the shared `ScaleLegend` use the resolved numeric scale;
adopting that contract across remaining application-specific legends is still
an incremental migration.

The light/dark filter separates **Same / single palette**, **Different light &
dark**, and **Needs theme review**. Explicit sibling `.light`/`.dark` or CSS
theme-role definitions are paired and compared in authored order; both entries
remain in the catalog, and their real variants appear in the two previews.
Single palettes mean no paired variant was found, not verified identical runtime
appearance. Mixed source groups, utilities, basemap presets and unpaired theme
definitions stay in review. The filter describes source definitions, not changes
made with the lab's experimental range controls.

## Findings

- `src/components/ui/map-styles.ts` already owns five sequential palettes, two
  heatmap ramps, selection blue, a dark border and a dark missing-data fill.
  The roles and palettes are fixed across themes. Blue's dark endpoint has only
  about 1.91:1 contrast against the lab's `#0a0a0a` reference surface at full
  opacity. A suitable outline or a reviewed alternative range is needed where
  distinguishing that mark from its background is essential.
- Index Lab owns five further palette profiles and separate RGB interpolation.
  Some red-to-green profiles have dark endpoints in both directions; changing
  the basemap alone does not make those colours readable.
- Food safety already provides explicit light/dark risk variants, preserving
  the same category identities. This is a useful model for reviewed variants.
- Assessment owns category colours, a nine-stop value scale and a seven-stop
  year-built scale. WARS adds heatmap alternatives. Project JSON repeats palette
  definitions and sometimes deliberately locks the light basemap.
- AQHI and walkability share their band definitions with legends. Keep their
  published/report-calibrated semantics explicit; do not globally replace their
  colours or thresholds with a generic ramp.
- CSS theme roles are centralized, but the five chart variables change hue
  between themes. Check consumers before using those as stable category IDs.
- `readableTextColor` is a weighted-channel heuristic, not a WCAG contrast-ratio
  calculation. The new lab computes sRGB luminance after alpha compositing.
- Shared gradient legends accept colour arrays; that alone cannot preserve
  unequal source stop positions, arbitrary classification breaks or alpha
  compositing. The eventual shared legend must consume the resolved scale.

## Dynamic scales

`src/lib/paletteScale.ts` is pure and reusable. It keeps these controls separate:

1. Authored colours and optional source stop coordinates.
2. Palette interval `[start, end]` within `[0, 1]`, reversal and interpolation.
3. Number of sampled colours/classes.
4. Numeric domain and equal-interval, quantile or manual classification.
5. Missing values and the documented out-of-domain clamp policy.

The lab can sample seven colours from 20–80% of a palette while preserving a
0–100 data domain. It can review a separate dark-theme interval using the same
numeric breaks. Each preview and its bin table come from the same resolved
scale. Export contains both theme variants, raw thresholds and the clamp rule.
This prepares a shared contract; adopting it in the existing renderers remains
a separate migration. Categorical, diverging, reference and unclassified groups
are displayed as authored, with numeric resampling disabled. Diverging scales
need an explicit neutral pivot before introducing asymmetric range controls.

Manual thresholds determine the effective class count. Quantiles exclude
nonfinite/missing observations and deduplicate repeated thresholds; constant
observations collapse to one class. Real zero remains a valid observation.
Changing class count resamples the selected interval rather than taking the
first colours. Fixed comparison domains/breaks must stay fixed between dates.
The UI's sample values are illustrative, not the LAEP dataset.

RGB remains the default to reproduce current interpolation. Lab interpolation
is available for comparison, without claiming every interpolated palette is
perceptually uniform or colour-blind safe. Heatmap alpha is preserved; the lab
does not simulate point density or raster compositing.

## Inventory and provenance

Run `node scripts/audit-map-colors.mjs` to regenerate the app-owned
`src/pages/dev-color-palettes/catalog.generated.json`. Run the same command with
`--check` to detect stale catalog content. JSON/CSV audit exports are also written
to ignored `tmp/color-audit/`. No scraper-owned datasets are involved.

The scan reads TypeScript string nodes (not comments), CSS literal colours and
theme HSL triples, project JSON excluding its generated index, and Tailwind
colour-class spellings. It discovers literal arrays/stops/keyed colour sets and
keeps remaining colours as explicitly labelled source collections. Counts are
literal spellings, not unique perceived colours or runtime usage. It includes
dev pages and current uncommitted files. Numeric RGB arrays, dynamic expressions,
external styles, images and generated datasets are not exhaustively resolved.
Tailwind previews show the used base shades; per-class opacity and state variants
remain in the downloadable inventory.

Project page links are exact package ownership. Explicit member references
follow named imports and `palette.member` uses into routed modules. The broader
candidate list follows static module imports and may include a route using
another export or a conditional layer. It is deliberately not labelled proven
runtime use. No reference found is not proof that a palette is unused.

## Standardization sequence

1. Establish shared theme-aware roles for boundaries, label halos, selection
   casing and missing-data treatment; preserve opt-in overrides.
2. Register authored palettes with IDs, semantic type, source/locked status,
   reviewed light/dark ranges and colour-blind review metadata.
3. Adopt one resolver and legend contract across generic numeric maps first.
   Keep data domain, breaks and zero/missing semantics unchanged during migration.
4. Add project-package palette references only with parser, renderer, schema
   documentation and audit coverage updated together; preserve inline palettes.
5. Review each affected map at actual opacity on both basemaps, including
   selection, labels, neighbouring fills, phone layout and exported legends.

Avoid a global colour inversion or automatic contrast repair applied separately
to each stop. That can change ordering and obscure the meaning of a scale.
Contrast ratios alone do not test neighbouring-category distinguishability or
colour-vision deficiencies. Required non-text cues generally need 3:1 against
adjacent colours; normal text generally needs 4.5:1, with the applicability and
exceptions described by W3C. Pair colour with labels or other cues.

## Validation

TypeScript compilation, focused ESLint, the production Vite build and 38 scale/
colour tests pass. The catalog freshness check passes after regeneration. Browser
checks covered desktop light/dark themes, a 390px mobile viewport without page
overflow, partial ranges, separate dark ranges, constant-value quantiles, invalid
manual thresholds and the downloaded resolved-scale JSON. No browser console
warnings or errors were observed. The production build reports dependency
externalization, outdated Browserslist data and large-chunk warnings; the lazy
dev gallery includes the complete audit catalog (about 78 KB gzipped).

## Research

The requested research subagent reviewed these primary sources:

- [D3 interpolation and sampling](https://d3js.org/d3-interpolate/value).
- [D3 quantize](https://d3js.org/d3-scale/quantize),
  [quantile](https://d3js.org/d3-scale/quantile) and
  [threshold](https://d3js.org/d3-scale/threshold) scales.
- [ColorBrewer scheme types and subsets](https://colorbrewer2.org/learnmore/schemes_full.html).
- [ArcGIS classification methods](https://doc.esri.com/en/arcgis-pro/latest/help/mapping/layer-properties/data-classification-methods.html).
- [Matplotlib lightness and colour-map guidance](https://matplotlib.org/stable/users/explain/colors/colormaps.html).
- [MapLibre step/interpolate expressions](https://maplibre.org/maplibre-style-spec/expressions/).
- [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html),
  [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  and [use of colour](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
