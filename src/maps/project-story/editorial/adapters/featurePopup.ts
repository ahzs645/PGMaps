import { record, sourceLayerId, type ArcgisRecord, type NativeWebMap } from './arcgisWebMap'

export interface PopupField {
  name: string
  label: string
  places?: number
  grouping: boolean
}
export interface FeaturePopupPlan {
  id: string
  url: string
  objectIdField: string
  title: string
  layerTitle: string
  fields: PopupField[]
  queryFields: string[]
}
const records = (value: unknown) => (Array.isArray(value) ? value.map(record) : [])

/** Authored labels, order and number formats remain source data. */
export function featurePopupPlans(document: Pick<NativeWebMap, 'layers' | 'features'>): FeaturePopupPlan[] {
  return document.features.flatMap((feature) => {
    const layer = document.layers.find((layer) => sourceLayerId(layer.id) === feature.id)
    if (!layer || layer.disablePopup === true || !layer.popupInfo) return []
    const popup = record(layer.popupInfo)
    const elements = records(popup.popupElements).filter((element) => element.type === 'fields')
    const authored = elements.length
      ? elements.flatMap((element) => records(element.fieldInfos))
      : records(popup.fieldInfos)
    const fields: PopupField[] = authored
      .filter((field) => field.visible !== false && typeof field.fieldName === 'string')
      .map((field) => {
        const format = record(field.format)
        return {
          name: String(field.fieldName),
          label: String(field.label || field.fieldName),
          grouping: format.digitSeparator === true,
          ...(typeof format.places === 'number'
            ? { places: Math.min(20, Math.max(0, Math.round(format.places))) }
            : {}),
        }
      })
    const title = typeof popup.title === 'string' ? popup.title : feature.title
    const titleFields = [...title.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
    return [
      {
        id: feature.id,
        url: feature.url,
        objectIdField: feature.fields[0],
        title,
        layerTitle: feature.title,
        fields,
        queryFields: [...new Set([feature.fields[0], ...fields.map((field) => field.name), ...titleFields])],
      },
    ]
  })
}

export function popupValue(value: unknown, field?: PopupField): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' && Number.isFinite(value))
    return value.toLocaleString('en-CA', {
      useGrouping: field?.grouping ?? false,
      ...(field?.places !== undefined
        ? { minimumFractionDigits: field.places, maximumFractionDigits: field.places }
        : { maximumFractionDigits: 20 }),
    })
  return typeof value === 'string' || typeof value === 'boolean' ? String(value) : '—'
}
export function popupContent(plan: FeaturePopupPlan, attributes: ArcgisRecord) {
  return {
    title: plan.title.replace(/\{([^}]+)\}/g, (_, name: string) =>
      popupValue(
        attributes[name],
        plan.fields.find((field) => field.name === name),
      ),
    ),
    rows: plan.fields.map((field) => ({
      key: field.name,
      label: field.label,
      value: popupValue(attributes[field.name], field),
    })),
  }
}
export function featurePopupUrl(plan: FeaturePopupPlan, objectId: unknown) {
  if (!['string', 'number'].includes(typeof objectId) || !/^\d+$/.test(String(objectId))) return undefined
  const query = new URLSearchParams({
    f: 'json',
    objectIds: String(objectId),
    outFields: plan.queryFields.join(','),
    returnGeometry: 'false',
  })
  return `${plan.url}/query?${query}`
}
