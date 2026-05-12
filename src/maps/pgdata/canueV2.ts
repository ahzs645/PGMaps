export const CANUE_V2_CATALOG_URL =
  'https://data.map.ahmad.sh/canue/pmtiles-v2/canue-bc-grid-v2-app-catalog.json'

export const CANUE_V2_ENABLED = true

export interface CanueV2Catalog {
  version: 2
  view: string
  mode: 'grid'
  gridKm: number
  vectorLayer: 'canue'
  r2Prefix: string
  metadataLookup: string
  families: CanueV2Family[]
}

export interface CanueV2Family {
  id: string
  label: string
  years: number[]
  datasetCount: number
  layerCount: number
  variableCount: number
  layers: CanueV2Layer[]
}

export interface CanueV2Layer {
  year: number
  pmtiles: {
    path: string
    url: string
    bytes: number
  }
  datasets: string[]
  variables: CanueV2Variable[]
  features: number
  sourceRows: number
}

export interface CanueV2Variable {
  property: string
  dataset: string
  variable: string
  metadataRef: string
  count?: number | null
  min?: number | null
  max?: number | null
}

export type CanueVariableSelection = {
  family: string
  familyLabel: string
  year: number
  dataset: string
  variable: string
  property: string
  pmtilesUrl: string
  min: number | null
  max: number | null
}

export function listCanueV2Selections(catalog: CanueV2Catalog): CanueVariableSelection[] {
  return catalog.families.flatMap((family) =>
    family.layers.flatMap((layer) =>
      layer.variables.map((variable) => ({
        family: family.id,
        familyLabel: family.label,
        year: layer.year,
        dataset: variable.dataset,
        variable: variable.variable,
        property: variable.property,
        pmtilesUrl: layer.pmtiles.url,
        min: variable.min ?? null,
        max: variable.max ?? null,
      })),
    ),
  )
}

export function getCanueV2PaintProperty(selection: CanueVariableSelection) {
  return ['get', selection.property] as const
}
