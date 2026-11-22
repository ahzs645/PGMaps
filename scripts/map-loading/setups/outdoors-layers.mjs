// The outdoors planner's optional layers, one at a time, named by its switch in the sidebar:
//   OUTDOORS_LAYER='Cutblocks' node scripts/map-loading/measure.mjs \
//     --url 'http://127.0.0.1:42320/dev/outdoors' --setup scripts/map-loading/setups/outdoors-layers.mjs \
//     --center -124.75,54.68 --zoom 12.5 --host delivery.maps.gov.bc.ca
// Forest roads (--zoom 11) and Cutblocks (12.5) read the road designer's ArcGIS layers; Rail lines,
// Limited entry zones and Lake depth charts (--zoom 10) and Sightlines (13.5) read openmaps.gov.bc.ca;
// Dated imagery steps back along the timeline strip as actions: OUTDOORS_FEED='esri-wayback'
// (--host wayback.maptiles.arcgis.com) or 'nasa-gibs-hls' (--host gibs.earthdata.nasa.gov).
// The layers' ids are generated when they mount, so the setup returns the ids that appeared.
const LAYER = process.env.OUTDOORS_LAYER ?? 'Cutblocks'
const FEED = process.env.OUTDOORS_FEED

export async function setup({ page, findMap }) {
  await page.waitForFunction(() => window.__m?.isStyleLoaded?.(), null, { timeout: 120_000 })
  if (FEED) {
    // The feed is a viewer's preference: set it, then load the page again with it.
    const view = await page.evaluate(() => ({ center: window.__m.getCenter().toArray(), zoom: window.__m.getZoom() }))
    await page.evaluate((id) => localStorage.setItem('pgmaps.bc-outdoors-imagery-feed.v1', id), FEED)
    await page.reload()
    await findMap()
    await page.waitForFunction(() => window.__m?.isStyleLoaded?.(), null, { timeout: 120_000 })
    await page.evaluate((view) => window.__m.jumpTo(view), view)
  }
  const before = new Set(await page.evaluate(() => window.__m.getLayersOrder()))
  const toggle = page.getByRole('button', { name: new RegExp(`^${LAYER}`) })
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  await page.waitForFunction(
    (known) => window.__m.getLayersOrder().some((id) => !known.includes(id)),
    [...before],
    { timeout: 90_000, polling: 250 },
  )
  // A hand-off's other id appears on the first change of date; follow it from the start.
  const ids = (await page.evaluate(() => window.__m.getLayersOrder())).filter((id) => !before.has(id))
  const handoffs = ids.filter((id) => id.startsWith('outdoors-dated')).map((id) => `${id}-handoff`)
  return { layers: [...ids, ...handoffs] }
}

const step = (key) => async ({ page }) => {
  const slider = page.getByRole('region', { name: 'Historical imagery timeline' }).getByRole('slider')
  await slider.focus()
  await page.keyboard.press(key)
}

export const actions =
  LAYER === 'Dated imagery'
    ? ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight'].map((key, i) => ({
        name: `date-${i + 1}`,
        run: step(key),
        holdMs: 3000,
      }))
    : []
