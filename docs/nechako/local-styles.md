# Browser-local vector styles

Implemented on 21 October 2026 for the native Nechako portal. This contract
supplements the [current parity audit](2026-10-21-parity-audit.md). It describes
the local renderer and portable style workflow, independently of source-portal
server permissions.

## Use

Open **Map Tools → Vectors, drawing and processing → Style [layer]**. The
advanced editor stages changes until **Apply style to layer**. A style changes
display only: feature IDs, attributes, geometry, source provenance and map
camera remain unchanged.

| Mode                     | Behavior                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single symbol            | One fill/stroke color, polygon fill opacity, stroke opacity/width, point radius, point fill opacity and point border width.                                                                                           |
| Ordered comparison rules | Enabled rules are evaluated in displayed order; the first match supplies the complete symbol. Move rules up/down, disable or remove them. Unmatched values use the fallback symbol.                                   |
| Numeric color gradient   | Two to 24 strictly increasing numeric stops interpolate linearly in RGB. Choose fill, stroke or both. Out-of-range values clamp to the nearest end stop; null, missing and nonnumeric values use the fallback symbol. |

Comparisons support equals, not equals, less than, less than or equal, greater
than, greater than or equal, and inclusive between. Values retain their types:
numeric zero, text `"0"`, `false` and an empty string are different values.
Non-null comparisons match only properties of the same type. For example,
numeric `not equals 0` does not classify text or null as a different number.
Null and missing attributes share the explicit missing/null class. Ordered
text comparisons are case sensitive.

**Add unique categories** appends equality rules for distinct typed property
values without changing existing rule order. The category generator accepts up
to 40 distinct values; the full editor accepts up to 64 rules. Numeric controls
preserve zero rather than replacing it with a default. Invalid ranges, duplicate
stops, nonfinite values and unknown style fields are rejected before application.

Geometry can be all geometries, points, lines or polygons. An explicit geometry
draws only that geometry within a mixed layer. Source GeometryCollections are
flattened only for rendering and retain their original representation in
workspace exports. Applied legends and composed map-image legends use the same
rule order, colors, opacities and gradient stops as the renderer.

## Local style library and defaults

**Save style in browser** saves the staged definition to the IndexedDB local
workbench. **Local style library** imports SLD/XML or versioned style JSON,
shows import diagnostics before saving, applies a saved style to a selected map
layer, downloads definitions/originals, deletes saved styles and manages
defaults. File imports are limited to 2 MiB.

Geometry defaults apply to newly added homogeneous point, line or polygon
layers. An explicit schema-ID default takes precedence when a map-add workflow
supplies that schema ID. Existing explicit styles and legacy category styles are
preserved. Mixed geometries do not choose an arbitrary geometry default. Removing
a library style removes its default assignments but leaves already applied map
styles intact.

These records are browser-local. Sharing is by exported SLD, style JSON or a
portable workbench package; this feature does not publish styles to the source
portal. Browser data can be cleared by the user or browser, so exported files are
the portable backup. Saving an edited imported style retains its original SLD as
provenance, separately from the current typed definition.

## SLD support and explicit limits

The importer conservatively supports:

- One named layer, one user style and one feature-type style.
- Circle point marks, plain line strokes and solid polygon fills/strokes.
- The seven comparisons above, null/not-null and inclusive ranges over direct
  feature properties.
- Disjoint external comparison rules and an optional ElseFilter fallback.
- Linear SE 1.1 color interpolation with explicit numeric stops and fallback
  colors.

SLD 1.0 is emitted for single symbols and comparison rules. Continuous gradients
use SLD/SE 1.1 `Interpolate`. Each export has one explicitly selected geometry.
For mixed GIS exports, create a separate sidecar for each actual geometry allowed by the style's explicit geometry scope. A point-only style does not gain line or polygon symbolizers during export. When an otherwise valid local style cannot be represented safely in SLD, retain its typed/original metadata and export the GIS data with an explicit sidecar-omission diagnostic.

OGC SLD can draw every matching rule, while the local style model uses the first
matching rule. Exports therefore exclude preceding matches in each subsequent
filter. External rules that could overlap are retained as originals and rejected
for automatic rendering; silently converting them would change their appearance.
Unsupported text/raster symbolizers, external graphics, non-circle marks, scale
constraints, geometry overrides, XPath properties, dash patterns, units,
unrecognized parameters or dynamic expressions are also retained with an
explicit error. Such records can be saved and downloaded, but cannot be applied
or assigned as defaults. The importer does not partially apply the remaining
supported parts of a rejected style.

SLD property references in this subset must be direct XML names. Field names
containing spaces or requiring namespace/XPath syntax still work in local map
styles and style JSON, but SLD export reports that limitation rather than writing
an invalid or differently interpreted reference.

External SLD literals have no complete JSON scalar-type annotation. When a target
layer is supplied, its actual attribute types resolve numeric/boolean literals.
Mixed attribute types are reported as ambiguous. Without a supplied field type,
literals remain text with a warning; the importer does not guess numeric values.
PGMaps exports include versioned typed metadata in an XML comment, allowing
zero, empty text, booleans, disabled rules and local precedence to round-trip.
That metadata is accepted only when regenerated XML has the same semantic
structure as the supplied XML. Edited or mismatched metadata is ignored and
the actual XML is parsed conservatively. External renderers use their dataset
schema for literal types and may have different supported SE functions.

XML declarations are parsed locally; DTDs/entities, unsupported namespaces and
attributes, excessive elements, malformed XML and invalid symbol values are
rejected. Original imported bytes remain available for download.

## Implementation contract

| File                                                      | Responsibility                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/maps/nechako/data/vectorRules.ts`                    | Versioned model, validation, typed comparisons, pure symbol resolution, guarded MapLibre expressions, gradients and legend definition. |
| `src/maps/nechako/data/sldStyle.ts`                       | Conservative XML parsing, SLD/SE serialization, type resolution and explicit diagnostics.                                              |
| `src/maps/nechako/data/styleLibrary.ts`                   | Validated local style documents, original retention, application, geometry/schema defaults and deletion.                               |
| `src/maps/nechako/PortalVectorStyleEditor.tsx`            | Staged editor and applied legend, explicit save and downloads.                                                                         |
| `src/maps/nechako/PortalStyleLibrary.tsx`                 | Reviewed file imports, local records, default assignments and original downloads.                                                      |
| `src/maps/nechako/PortalVectors.tsx`                      | Native MapLibre polygon/line/point painting and defaults for locally drawn/processed layers.                                           |
| `src/maps/nechako/data/workspace.ts`                      | Workspace style validation and provenance round-trip.                                                                                  |
| `src/maps/nechako/data/mapImage.ts`, `composeMapImage.ts` | Matching composed-image symbols, fallback labels and gradient stops.                                                                   |

`applyLocalDefaultStyle(vector, schemaId?)` is asynchronous and preserves a
vector's data reference and source ID. A caller should surface cache or
incompatible-default errors; the helper does not silently replace an invalid
default. `applyStyleRecord(vector, record)` rejects unsupported originals and
incompatible geometries.

The local cache contract is:

- `kind: "style"` with data
  `{ schema: "nechako-local-style-v1", style?, originalSld?, diagnostics }`.
- `kind: "style-defaults"`, ID `nechako-style-defaults-v1`, with data
  `{ schema: "nechako-style-defaults-v1", assignments }`. Keys are `point`,
  `line`, `polygon` or `schema:<id>`; values reference saved style record IDs.

## Verification

The unit suite uses the installed MapLibre expression compiler/evaluator to
compare actual expression results with the pure rule/gradient resolver,
including typed zero/text/false/null, first-match precedence, disabled rules,
range boundaries and interpolated RGB. It also verifies workspace/source
preservation, exact legend definitions, original SLD retention and persistent
default/deletion relationships using IndexedDB fixtures.

The browser suite is `tests/e2e/nechako-local-styles.spec.ts`. It tests staged
rules, actual map pixels, gradient midpoint colors, library persistence through
reload, default application to a new drawing, deletion without changing applied
styles, SLD export and source-data preservation at desktop and phone widths.
A browser XML-parser test covers supported external rules, typed round-trips,
metadata tampering and explicit unsupported/ambiguous imports. See the execution
report for run results; this document does not assert external GIS application
acceptance.

## Primary specifications

- [MapLibre expression reference](https://maplibre.org/maplibre-style-spec/expressions/):
  strict comparison types, first-match `case`, and linear `interpolate`.
- [OGC Styled Layer Descriptor](https://www.ogc.org/standards/sld/).
- [OGC SLD 1.0 schema](https://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd).
- [OGC Symbology Encoding 1.1](https://docs.ogc.org/is/05-077r4/05-077r4.pdf):
  symbolizers and color interpolation.
