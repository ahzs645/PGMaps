// The outdoors planner's optional layers, one at a time, named by its switch in the sidebar:
//   OUTDOORS_LAYER='Cutblocks' node scripts/map-loading/measure.mjs \
//     --url 'http://127.0.0.1:42320/dev/outdoors' --setup scripts/map-loading/setups/outdoors-layers.mjs \
//     --center -124.75,54.68 --zoom 12.5 --host delivery.maps.gov.bc.ca
// Forest roads (--zoom 11) and Cutblocks (12.5) read the road designer's ArcGIS layers; Rail lines,
// Limited entry zones and Lake depth charts (--zoom 10) and Sightlines (13.5) read openmaps.gov.bc.ca;
// Recent satellite passes steps a day at a time as actions (--host gibs.earthdata.nasa.gov).
// The layers' ids are generated when they mount, so the setup returns the ids that appeared.
const LAYER = process.env.OUTDOORS_LAYER ?? 'Cutblocks'

export async function setup({ page }) {
  await page.waitForFunction(() => window.__m?.isStyleLoaded?.(), null, { timeout: 120_000 })
  const before = new Set(await page.evaluate(() => window.__m.getLayersOrder()))
  const toggle = page.getByRole('button', { name: new RegExp(`^${LAYER}`) })
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  await page.waitForFunction(
    (known) => window.__m.getLayersOrder().some((id) => !known.includes(id)),
    [...before],
    { timeout: 90_000, polling: 250 },
  )
  // Give a two-layer hand-off its second slot's id too: it appears on the first change of day.
  const ids = (await page.evaluate(() => window.__m.getLayersOrder())).filter((id) => !before.has(id))
  const handoffs = ids.filter((id) => id.startsWith('outdoors-recent-')).map((id) => `${id}-handoff`)
  return { layers: [...ids, ...handoffs] }
}

const step = (name) => async ({ page }) => {
  await page.getByRole('button', { name, exact: true }).click()
}

export const actions =
  LAYER === 'Recent satellite passes'
    ? ['Previous day', 'Previous day', 'Previous day', 'Next day'].map((name, i) => ({
        name: `day-${i + 1}`,
        run: step(name),
        holdMs: 3000,
      }))
    : []
