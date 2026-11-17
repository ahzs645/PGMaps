# Stand components in renderer-neutral scene v1

The additive stand fields preserve the native drawing's species, forms and
individual crown widths across a renderer switch or a final capture. They are
display data, outside `AnalysisInput` and the assessment's numerical rules.

## Tree records

The first seven numeric fields remain, in order:

`x, y, z, species, height, crownWidth, tone`

Component-aware packages append:

| Field       | Meaning                                                         |
| ----------- | --------------------------------------------------------------- |
| `crownBase` | Live crown base divided by height; `-1` unknown, `0` valid.     |
| `dbhCm`     | Supplied breast-height diameter in centimetres; `0` unknown.    |
| `expansion` | Recorded stems represented by this drawing, at least 1.         |
| `form`      | `0` mature, `1` young conifer, `2` tall shrub.                  |
| `source`    | `0` regional/generated, `1` inventory, `2` imported individual. |

Generated mature trees keep an unknown crown base and DBH unless supplied.
Inventory provenance describes the record that chose the drawing, not a claim
that the generated shape or every attribute was measured. The native placement
grid and all its random streams are unchanged.

`trees.ids`, when present, aligns one stable string with each record. Generated
IDs come from the fixed geographic cell, anchor latitude and seed. Imported IDs
use their supplied file ID, namespaced by the stand origin. They survive a row
reorder and the before/after treatment of that stand. The existing numeric
prescription keys are retained for saved-project compatibility: replacing a
source file in another order does not migrate old protected-key choices.

Before-harvest views always use imported individuals, independently of treatment
colouring. Marking changes their colours; it does not switch the source stand.
Generated stands retain their existing marking override.

Species keep the original six slots and append `hemlock`, `blackSpruce` and
`cottonwood`. The first six drawings/models and their seeds do not move.

Final stands use the same fields and IDs. They keep individual crown widths,
including supplied wide crowns and young/shrub crowns; there is no universal
width-to-height cap. Their numeric buffer remains a `Float32Array` for transfer.
IDs stay aligned when the stem budget shortens a complete final-stand radius.

## Resolved distant stands

Each terrain grid may carry:

```ts
stand: {
  cells: number[] // one palette index per height post; -1 missing or no stand
  records: Array<{
    heightMeters: number
    species: Array<{ species: string; share: number; heightMeters?: number }>
    source: 'regional' | 'inventory' | 'imported'
  }>
}
```

The palette uses the same first-match inventory/thinning priorities as native
placement. Species-specific recorded heights and regrowth fractions are resolved
before the field is sampled. Regional fallback is named explicitly. Imported
prescribed blocks use a crown-area-weighted summary of their kept trees; this is
a block summary, not a newly invented map of individual crowns.

The existing canopy closure and cover remain authoritative. Missing terrain,
cleared ground and water do not acquire a stand. The same field is carried by
inner, far and skyline grids; it does not change their terrain/curvature convention.

## Capability negotiation and old files

An engine advertises `stand-components-v1` for the extra species, forms and stand
palettes, and `stand-fields-v1` for appended tree fields/IDs. `sceneForEngine` and
`finalStandForEngine` in `sceneComponents.ts` adapt outgoing payloads without
mutating their source. Consumers advertising both receive the original object.
Older consumers receive their seven numeric fields and six species; hemlock maps
to fir, black spruce to spruce and cottonwood to aspen. Unsupported palettes/IDs
are omitted. The PGMaps parser accepts both old seven-field and modern records.

Packed scene transfer keeps the same double-precision numbers, palette records
and string IDs; it does not quantize new metadata or change a source package.

## Remaining limits and regression coverage

The 4 m near grid still saturates at about 587.5 drawn stems/ha. Denser inventory
is represented by expanded stems with calibrated crowns, now carrying its
expansion explicitly. A final stand is not an individual stem census above that
capacity. No automatic grid refinement or source repositioning was introduced.
TASS zero-crown-base parsing semantics are unchanged until its format establishes
whether zero is a valid source measurement or a sentinel.

`sceneComponents.test.ts` covers measured wide crowns/zero base/DBH and imported
IDs across ordinary, final, reordered and retained stands; young/shrub forms;
dense-stand expansion; legacy negotiation; and packed roundtrips.
`sceneStand.test.ts` covers the formerly identical 40 m hemlock versus 6 m
cottonwood far scenes, mixed composition, precedence and missing/cleared ground.
`stand/beforeHarvestCells.test.ts` exercises the phase-selection helper through
ordinary/final scenes, preserving imported identities and dimensions with marking
off or on and retaining the same source IDs after harvest.
