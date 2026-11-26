import { expect, test } from '@playwright/test'
import { openWorkbench } from './road-workbench'
import { openRoadPanel } from './road-sidebar'
import { choose, optionLabels } from './styled-select'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 } })

test('a bad sibling does not block a mixed file, and its polygon is available for access planning', async ({
  page,
}) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({ timeout: 60_000 })
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['{"title":"not a map"}'], 'manifest.json'))
    const mixed = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Mixed QA harvest block' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.719, 53.891],
                [-122.717, 53.891],
                [-122.717, 53.892],
                [-122.719, 53.891],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'Mixed QA survey line' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-122.719, 53.89],
              [-122.717, 53.89],
            ],
          },
        },
      ],
    }
    data.items.add(new File([JSON.stringify(mixed)], 'mixed.geojson'))
    return data
  })
  await page.getByTestId('road-workspace').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()

  const review = page.getByRole('dialog', { name: 'Import layers', exact: true })
  await expect(review.getByText('1 file was skipped.', { exact: false })).toBeVisible()
  await expect(review.getByText(/Could not read manifest.json/)).toBeVisible()
  const polygons = review.getByRole('combobox', { name: 'Import role for mixed.geojson/Polygons', exact: true })
  const lines = review.getByRole('combobox', { name: 'Import role for mixed.geojson/Lines', exact: true })
  await expect(lines).toHaveText('Reference')
  await choose(polygons, 'planned-block')
  await review.getByRole('checkbox', { name: 'Prepare 1 m DEM download boxes after import' }).uncheck()
  await review.getByRole('button', { name: 'Import layers', exact: true }).click()
  await expect(review).toBeHidden()

  await page.getByRole('tab', { name: 'Design', exact: true }).click()
  await openRoadPanel(page, 'Access from FSR')
  const blocks = page.getByTestId('road-access-review').getByRole('combobox', { name: 'Harvest block', exact: true })
  expect(await optionLabels(blocks)).toContain('Mixed QA harvest block')
})
