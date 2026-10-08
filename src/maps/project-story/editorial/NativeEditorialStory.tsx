import { useTheme } from 'next-themes'
import { WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace/workspace-context'
import { useEffect, useState, useMemo, useRef } from 'react'
import type MapLibre from 'maplibre-gl'
import type { ProjectPackage } from '@/lib/projectPackages'
import { useStorySources } from '../useStorySources'
import { MapSwipe } from '@/components/ui/map-swipe'
import { EditorialShell } from './EditorialShell'
import { NativeStoryMap } from './NativeStoryMap'
import { parseEditorialDocument } from './model/validate.mjs'
import type { NativeEditorialDocument } from './model/types'
import {
  EditorialDocumentRenderer,
  type EditorialComparisonRenderProps,
} from '@pgmaps/geo-toolkit/stories/EditorialDocumentRenderer'
import './NativeEditorialStory.css'
function PGComparison({
  document: doc,
  media,
  selectedCategory: selected,
  onSelect: select,
}: EditorialComparisonRenderProps) {
  const [left, setLeft] = useState<MapLibre.Map | null>(null),
    [right, setRight] = useState<MapLibre.Map | null>(null)
  const position = useRef(50)
  useEffect(() => {
    if (!left || !right) return
    const mirror = () =>
      right.jumpTo({
        center: left.getCenter(),
        zoom: left.getZoom(),
        bearing: left.getBearing(),
        pitch: left.getPitch(),
        roll: 0,
      })
    const pick = (event: MapLibre.MapMouseEvent) => {
      const source = (event.point.x / left.getCanvas().clientWidth) * 100 < position.current ? left : right
      const property = doc.maps[media.mapId].categoryProperty
      if (!property) return
      const found = source
        .queryRenderedFeatures(event.point)
        .find((f) => doc.categories.some((c) => c.id === String(f.properties?.[property])))
      if (found) select(String(found.properties[property]))
    }
    mirror()
    left.on('click', pick)
    left.on('move', mirror)
    left.on('resize', mirror)
    return () => {
      left.off('click', pick)
      left.off('move', mirror)
      left.off('resize', mirror)
    }
  }, [left, right, doc, media.mapId, select])
  const layerIds = [
    ...doc.views[media.leftViewId].visibleLayerIds,
    ...doc.views[media.rightViewId].visibleLayerIds,
  ].join(',')
  const queryLayers = useMemo(
    () => doc.maps[media.mapId].layers.filter((l) => l.format !== 'pmtiles' && layerIds.split(',').includes(l.id)),
    [doc, media.mapId, layerIds],
  )
  const shared = useStorySources(queryLayers)
  const common = {
    sharedSources: shared.sources,
    retrySources: shared.retry,
    definition: doc.maps[media.mapId],
    categories: doc.categories,
    selectedCategory: selected,
    onSelect: () => {},
  }
  return (
    <MapSwipe
      leftLabel={media.leftLabel}
      rightLabel={media.rightLabel}
      onPositionChange={(p) => {
        position.current = p
      }}
      left={<NativeStoryMap {...common} view={doc.views[media.leftViewId]} onReady={setLeft} />}
      right={<NativeStoryMap {...common} view={doc.views[media.rightViewId]} onReady={setRight} passive />}
    />
  )
}

export default function NativeEditorialStory({
  project,
  onBack,
  documentUrl,
}: {
  project: ProjectPackage
  onBack: () => void
  documentUrl: string
}) {
  const { resolvedTheme } = useTheme()
  const [doc, setDoc] = useState<NativeEditorialDocument | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch(documentUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Story returned HTTP ${response.status}`)
        return response.json()
      })
      .then(parseEditorialDocument)
      .then(setDoc)
      .catch((failure) => {
        if (failure.name !== 'AbortError') setError(failure.message)
      })
    return () => controller.abort()
  }, [documentUrl])
  if (!doc)
    return (
      <div className="p-6" role={error ? 'alert' : 'status'}>
        {error || 'Loading story…'}
      </div>
    )
  return (
    <WorkspaceProvider theme={resolvedTheme === 'dark' ? 'dark' : 'light'} placement="viewport" responsive="viewport">
      <EditorialDocumentRenderer
        document={doc}
        renderMap={(props) => <NativeStoryMap {...props} />}
        renderComparison={(props) => <PGComparison {...props} />}
        renderShell={(props) => (
          <EditorialShell
            {...props}
            title={project.title}
            onBack={onBack}
            sectionUrl={project.workspace?.type === 'story-map' && project.workspace.options.sectionUrl}
          />
        )}
      />
    </WorkspaceProvider>
  )
}
