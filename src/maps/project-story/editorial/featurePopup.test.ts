import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { featurePopupPlans, featurePopupUrl, popupContent, type FeaturePopupPlan } from './adapters/featurePopup'
import { sourceLayerId, type NativeWebMap } from './adapters/arcgisWebMap'

const folder = 'public/data/story-documents/prague/maps'
function authoredPlans() {
  return readdirSync(folder).flatMap((filename) => {
    const source = JSON.parse(readFileSync(`${folder}/${filename}`, 'utf8'))
    const layers = source.operationalLayers ?? []
    return featurePopupPlans({
      layers,
      features: layers
        .filter((layer: { layerType: string }) => layer.layerType === 'ArcGISFeatureLayer')
        .map((layer: { id: string; url: string; title: string }) => ({
          id: sourceLayerId(layer.id),
          url: layer.url,
          title: layer.title,
          fields: ['OBJECTID', 'cluster'],
          where: '1=1',
        })),
    } as NativeWebMap)
  })
}
describe('authored native feature popups', () => {
  it('preserves all seven original popup definitions and their visible field order', () => {
    const plans = authoredPlans()
    expect(plans).toHaveLength(7)
    expect(plans.map((plan) => plan.fields.length).sort()).toEqual([15, 15, 15, 15, 16, 16, 16])
    for (const plan of plans) {
      expect(plan.title).toBe('{POCET_PODL}')
      expect(plan.queryFields).toEqual(
        expect.arrayContaining(['POCET_PODL', 'HPP', 'cluster', 'simps_400', 'simps_1000', 'simps_2500']),
      )
      expect(plan.fields[1].name).toBe('POCET_PODL')
    }
  })
  it('retains source decimal formatting, zero, null and text without interpreting HTML', () => {
    const plan = authoredPlans()[0]
    const content = popupContent(plan, { POCET_PODL: 4, HPP: 0, cluster: null, GlobalID: '<script>payload</script>' })
    expect(content.title).toBe('4.000000')
    expect(content.rows.find((row) => row.key === 'HPP')?.value).toBe('0.000000')
    expect(content.rows.find((row) => row.key === 'cluster')?.value).toBe('—')
    expect(content.rows.find((row) => row.key === 'GlobalID')?.value).toBe('<script>payload</script>')
  })
  it('requests only one original feature and authored fields with no SQL interpolation', () => {
    const plan = authoredPlans()[0]
    const url = new URL(featurePopupUrl(plan, 42)!)
    expect(url.searchParams.get('objectIds')).toBe('42')
    expect(url.searchParams.get('returnGeometry')).toBe('false')
    expect(url.searchParams.get('outFields')?.split(',')).toEqual(plan.queryFields)
    expect(url.searchParams.has('where')).toBe(false)
    expect(featurePopupUrl(plan, '42 OR 1=1')).toBeUndefined()
  })
  it('honors disabled popups and hidden field rows', () => {
    const source: Pick<NativeWebMap, 'layers' | 'features'> = {
      layers: [{ id: 'a', disablePopup: true, popupInfo: { fieldInfos: [{ fieldName: 'a' }] } }],
      features: [
        {
          id: sourceLayerId('a'),
          fields: ['ID'],
          url: 'https://example.com/FeatureServer/0',
          where: '1=1',
          title: 'Example',
        },
      ],
    }
    expect(featurePopupPlans(source)).toEqual([])
    source.layers[0].disablePopup = false
    source.layers[0].popupInfo = {
      title: '{hidden}',
      fieldInfos: [
        { fieldName: 'hidden', visible: false },
        { fieldName: 'shown', label: 'Visible value', visible: true },
      ],
    }
    const [plan] = featurePopupPlans(source)
    expect(plan.fields.map((field) => field.name)).toEqual(['shown'])
    expect(plan.queryFields).toContain('hidden')
    expect(popupContent(plan as FeaturePopupPlan, { hidden: 'Title', shown: 1 }).title).toBe('Title')
  })
})
