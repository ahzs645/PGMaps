import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { CalculationTable } from './calculation-results'
import { RobustnessTab } from '@/maps/scorebuilder/components/RobustnessTab'

it('preserves caller ordering, zero, signed values and unknown readings with named headers', () => {
  const rows = [
    { id: 'Later', value: 0 },
    { id: 'Earlier', value: null },
    { id: 'Alternate', value: -1 },
  ]
  const html = renderToStaticMarkup(
    <CalculationTable
      caption="Interval changes"
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { label: 'Case', render: (r) => r.id },
        { label: 'Change', render: (r) => r.value },
      ]}
    />,
  )
  expect(html).toContain('>Interval changes</caption>')
  expect(html).toContain('scope="col"')
  expect(html).toContain('scope="row">Later</th><td>0</td>')
  expect(html).toContain('scope="row">Earlier</th><td>Unknown</td>')
  expect(html).toContain('scope="row">Alternate</th><td>-1</td>')
  expect(html.indexOf('>Later</th>')).toBeLessThan(html.indexOf('>Earlier</th>'))
})

it('shows Index Lab stress-test ranges and labels in the shared results table', () => {
  const html = renderToStaticMarkup(
    <RobustnessTab
      scenarioComparison={null}
      robustnessResults={[
        {
          regionId: 'pg',
          regionName: 'Prince George',
          baseRank: 2,
          medianRank: 2.5,
          rankInterval: [1, 4],
          scoreInterval: [30, 65],
          stability: 'moderate',
          topDrivers: ['networkVariety'],
        },
      ]}
    />,
  )
  for (const value of ['#2 Prince George', '2.5', '#1–#4', 'moderate', 'Score interval', 'Drivers'])
    expect(html).toContain(value)
})
