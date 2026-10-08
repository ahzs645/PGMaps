import { useEffect, useState } from 'react'
import { useMap } from '@pgmaps/geo-toolkit/map'

// Observe actual map state so consumer smoke checks cannot pass on UI text alone.
export function MapReadyState() {
  const { map, isLoaded } = useMap()
  const [state, setState] = useState({
    layers: 0,
    visibleLayers: 0,
    background: '',
    width: 0,
    riversideScore: '',
    zoom: 0,
  })
  useEffect(() => {
    if (!isLoaded || !map) return
    const sample = () => {
      const style = map.getStyle()
      const layers = style.layers.filter((layer) => layer.type === 'fill')
      let riversideScore = ''
      for (const source of Object.values(style.sources)) {
        if (source.type !== 'geojson' || typeof source.data !== 'object' || source.data.type !== 'FeatureCollection')
          continue
        const district = source.data.features.find((feature) => feature.properties?.id === 'riverside')
        if (district) riversideScore = String(district.properties?.score)
      }
      setState({
        layers: layers.length,
        visibleLayers: layers.filter((layer) => layer.layout?.visibility !== 'none').length,
        background: String(map.getPaintProperty('background', 'background-color')),
        width: map.getContainer().clientWidth,
        riversideScore,
        zoom: map.getZoom(),
      })
    }
    sample()
    map.on('idle', sample)
    map.on('resize', sample)
    return () => {
      map.off('idle', sample)
      map.off('resize', sample)
    }
  }, [map, isLoaded])
  return (
    <span
      hidden
      data-testid="map-state"
      data-loaded={isLoaded}
      data-fill-layers={state.layers}
      data-visible-fill-layers={state.visibleLayers}
      data-background={state.background}
      data-map-width={state.width}
      data-riverside-score={state.riversideScore}
      data-map-zoom={state.zoom}
    />
  )
}
