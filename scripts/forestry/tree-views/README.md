# Road view tree test views

Fixed cameras on the road view, each measured the same way, so a change to how the stand is drawn
can be compared with what was there before. For each view: the picture stopped and moving, the
share of the view the drawn stand covers in each, and the time a frame takes.

A tree's drawn shape is screening evidence, not styling (see `screenCoverage.test.ts`). Those unit
tests pin one tree side-on; these views show what the same change does to a whole stand from a road.

## Running them

1. Start the receiver, which also serves the measuring script to the page:

   ```sh
   node scripts/forestry/tree-views/receive.mjs tmp/tree-views
   ```

2. Open `/dev/forestry/visual-quality` in a visible tab, and in its console:

   ```js
   const views = await import('http://127.0.0.1:48731/views.js')
   await views.openSample('Hwy 16 · Purden Lake')
   // wait until the road view no longer says "Preparing forest" or "Preliminary forest"
   console.table(await views.measureViews('before', 'purden'))
   ```

   Each view writes `<tag>-<scene>-<view>-still.jpg`, `-moving.jpg` and `.json` into the folder.

3. Make the change, reload, and run it again under another tag.

## Reading the figures

- **coverStill, coverMoving**: the percentage of pixels the stand's layer changes, found by drawing
  the frame with and without it. Tree shadows are part of that layer, so switch *Tree shadows* off
  in *View options* for a figure that is trees alone.
- **stillMs, movingMs, bareMs**: the median time to draw one frame and read a pixel back, with the
  near trees in detail, as cards, and with no stand. They are this machine's, with whatever else it
  is doing: compare runs taken minutes apart, not days.
- The tab must be visible. A hidden one draws about one frame a second and the look never turns.

## 15 November 2026, Hwy 16 · Purden Lake, 0.45 km along

An 860 × 862 px view, shadows off. Cover as moving / stopped (%), frame as moving / stopped (ms).

| View | Before: cover | Before: frame | Default after: cover | Default after: frame | Baked: cover | Baked: frame |
|---|---|---|---|---|---|---|
| along the road | 13.7 / 13.9 | 11.5 / 18.7 | 13.7 / 13.6 | 10.9 / 12.3 | 14.2 / 13.8 | 8.5 / 12.6 |
| side-on to the stand | 64.4 / 63.5 | 8.0 / 23.5 | 70.5 / 69.9 | 7.1 / 10.3 | 70.2 / 69.9 | 7.0 / 10.4 |
| quartering | 57.6 / 56.9 | 9.3 / 26.7 | 59.5 / 58.1 | 8.8 / 11.9 | 58.8 / 58.1 | 9.1 / 11.6 |
| toward the block | 58.8 / 59.2 | 7.5 / 16.7 | 63.2 / 62.8 | 5.8 / 9.7 | 64.2 / 62.8 | 5.7 / 9.0 |
| 30° down at the road | 0 / 0 | 3.4 / 10.9 | 0 / 0 | 3.3 / 6.9 | 0 / 0 | 2.8 / 6.3 |

What they show:

- **The baked cards screen as the drawn ones do**: within a point and a half in every view, and
  within a point of the stopped trees.
- **Cover rose 2 to 6 points over what was there before, in both styles.** That is the new
  drawings, not the baking: mostly the tall shrub, which is leaves to the ground where a thicket
  was drawn as small aspens on bare stems, and the young conifers and hemlock.
- **A stopped frame takes about half the time**: a tree built of bough cards is 40 to 50% fewer
  triangles than one built of solid sprays.
- **Skipping stems outside the view would save little here.** The last row draws all 170,000 stems
  with none of them in view: about 3 ms a frame against a little over 2 ms for no stand at all.

## 16 November 2026, the far hillside: Purden Lake from 5 km along, facing the block

The block is 2 to 4 km off across the lake. This is the view the far forest was worked on
(`docs/forestry-visual-quality.md`, **The far forest**).

```js
await views.seek(5000)
await views.faceBlock()
// once the forest is ready; the region is the hillside between the lake and the skyline
console.table([await views.measure('far', 'purden-5km', [0.15, 0.39, 0.96, 0.585])])
```

Same camera and the same 168,904 stems in every column. *Far cover* is the stand's cover inside the
region; *cut ground shown* is, of the block's ground showing with the stand off, the share still
showing with it on.

| | Before (main) | Default now | Baked from 3D |
|---|---|---|---|
| Far cover | 53.6% | 61.1% | 60.3% |
| Cut ground shown | 76.4% | 76.9% | 75.6% |
| Frame, moving / stopped | 9.9 / 16.4 ms | 9.2 / 9.0 ms | 7.3 / 8.4 ms |

What they show:

- **The canopy tiles close the hillside and leave the block alone.** Cover on the hillside rose
  seven points; the cut ground showing moved by less than half a point in the default style.
- **The baked far cards hide about a point more of the block** than the drawn ones, along its lower
  edge.
- **The frame costs no more than it did.** The three columns were taken an hour or more apart on a
  machine doing other work, so read them as "no slower", not as a speed-up.

