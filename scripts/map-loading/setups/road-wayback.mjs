// The road designer's Wayback timeline, stepped release by release: a change of source.
//   --url 'http://127.0.0.1:42320/dev/forestry/road-design?interface=ribbon&example=training'
//   --map '[data-testid="road-plan-view"] .maplibregl-map' --center -122.6,54.0 --zoom 14
//   --layer road-wayback --layer road-wayback-handoff --host wayback.maptiles.arcgis.com --journey none
export async function setup({ page }) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="road-map-ready"]')?.getAttribute('data-ready') === 'true',
    null,
    { timeout: 120_000 },
  )
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Historical imagery timeline' }).check()
  await page.getByRole('button', { name: 'Close map settings' }).click()
  await page.getByRole('region', { name: 'Historical imagery timeline' }).getByRole('slider').waitFor({ timeout: 60_000 })
}

const step = (key) => async ({ page }) => {
  const slider = page.getByRole('region', { name: 'Historical imagery timeline' }).getByRole('slider')
  await slider.focus()
  await page.keyboard.press(key)
}

export const actions = ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight'].map((key, i) => ({
  name: `release-${i + 1}`,
  run: step(key),
  holdMs: 2500,
}))
