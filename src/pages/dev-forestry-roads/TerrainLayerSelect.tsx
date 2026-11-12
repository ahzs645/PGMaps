import { RoadSelect } from './Controls'

const layers = [
  { value: 'hillshade', label: 'Hillshade' },
  { value: 'slope', label: 'Slope' },
  { value: 'aspect', label: 'Aspect' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'none', label: 'Basemap' },
] as const
export type TerrainLayer = (typeof layers)[number]['value']

export function TerrainLayerSelect({
  value,
  onChange,
}: {
  value: TerrainLayer
  onChange: (layer: TerrainLayer) => void
}) {
  return (
    <RoadSelect
      value={value}
      onValueChange={(value) => onChange(value as TerrainLayer)}
      ariaLabel="Terrain display"
      className="h-8 w-24 min-w-0 bg-background/95 sm:w-32"
      options={layers}
    />
  )
}
