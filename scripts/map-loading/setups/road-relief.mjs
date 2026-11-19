// The road designer's relief through Map ↔ Satellite: a change of place in the stack, not of source.
//   --url 'http://127.0.0.1:42320/dev/forestry/road-design?interface=ribbon&example=training'
//   --map '[data-testid="road-plan-view"] .maplibregl-map' --center -122.6,54.0 --zoom 15
//   --layer road-hrdem-relief --host datacube.services.geo.ca --journey none
// (or --layer road-regional-hillshade for the regional relief). A switch should cost the host nothing.
export async function setup({ page }) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="road-map-ready"]')?.getAttribute('data-ready') === 'true',
    null,
    { timeout: 120_000 },
  )
}

const basemap = (value) => async ({ page }) => {
  const plan = page.getByTestId('road-plan-view')
  const radio = plan.locator(`input[type="radio"][value="${value}"]`)
  for (let i = 0; i < 3 && !(await radio.isVisible()); i++) {
    await plan.getByRole('button', { name: 'Basemap', exact: true }).click()
    await page.waitForTimeout(200)
  }
  await radio.click()
  await page.keyboard.press('Escape')
}

export const actions = ['satellite', 'map', 'satellite', 'map'].map((value, i) => ({
  name: `to-${value}-${i + 1}`,
  run: basemap(value),
  holdMs: 1500,
}))
