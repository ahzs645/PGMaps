import { useMemo } from 'react'

import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { areaSymbolPaint, lineSymbolPaint, PX_PER_PT } from '@/lib/mapSheet/mapSymbols'

import {
  photoCameraCollections,
  photoPairCollection,
  type PlanPhotoCamera,
  type PlanPhotoPair,
} from './photoCamerasGeometry'
import { PHOTO_PLAN_SYMBOLS } from './photoPlanStyle'
import type { PlanShow } from './planLayers'

export type { PlanPhotoCamera, PlanPhotoPair } from './photoCamerasGeometry'

const CONE = areaSymbolPaint(PHOTO_PLAN_SYMBOLS.cone)
/** The track's casing and its dashes, bottom first. */
const TRACK = lineSymbolPaint(PHOTO_PLAN_SYMBOLS.track)
const RESIDUAL = lineSymbolPaint(PHOTO_PLAN_SYMBOLS.solvedPair)[0]
const CAMERA = PHOTO_PLAN_SYMBOLS.camera
const CAMERA_RADIUS = (CAMERA.size / 2) * PX_PER_PT
/** The camera's halo; the catalogue's entry carries one, and the plan reads it from there. */
const CAMERA_HALO = CAMERA.halo ?? { color: '#ffffff', width: 1.5 }
const PAIR_RADIUS = (PHOTO_PLAN_SYMBOLS.pair.size / 2) * PX_PER_PT

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Own photos' cameras on the plan: each camera's cone out to its frame's far hit, a point at each camera (the
 * active photo's larger, with a ring), and a dashed track joining each flight's cameras in time order. The
 * active photo's paired points and reference point are drawn with it, each pair's residual on the ground as a
 * thin line to where the solved camera puts it.
 *
 * A click on a camera opens that photo (`onOpen`). The page passes `onOpen={null}` while the road view is open,
 * when a plain plan click moves the road view (`PlanClickToMove`), and while something else is being drawn or
 * picked: the layer then takes no clicks and the click reaches the plan. Cones, track and pairs never take one.
 */
export function PhotoCamerasLayer({
  cameras,
  activeId,
  pairs = [],
  reference = null,
  hidden,
  visible = true,
  onOpen,
}: {
  cameras: readonly PlanPhotoCamera[]
  activeId: string | null
  pairs?: readonly PlanPhotoPair[]
  reference?: { lng: number; lat: number } | null
  hidden: PlanShow['hidden']
  visible?: boolean
  onOpen: ((id: string) => void) | null
}) {
  const { cones, eyes, tracks } = useMemo(() => photoCameraCollections(cameras, activeId), [cameras, activeId])
  const marks = useMemo(() => photoPairCollection(pairs, reference), [pairs, reference])
  const camerasShown = visible && !hidden.has('photo:camera') && eyes.features.length > 0
  const trackShown = visible && !hidden.has('photo:track') && tracks.features.length > 0
  const pairsShown = visible && !hidden.has('photo:pair') && marks.features.length > 0
  return (
    <>
      <MapFillLayer
        data={cones}
        visible={camerasShown}
        interactive={false}
        fillColor={CONE.fill?.['fill-color'] ?? CAMERA.color}
        fillOpacity={['case', ['==', ['get', 'active'], 1], 0.18, CONE.fill?.['fill-opacity'] ?? 0.08] as never}
        lineColor={CONE.outline[0]['line-color']}
        lineWidth={['case', ['==', ['get', 'active'], 1], 1.5, CONE.outline[0]['line-width']] as never}
        lineOpacity={(CONE.outline[0]['line-opacity'] as number | undefined) ?? 1}
      />
      {TRACK.map((paint, i) => (
        <MapLineLayer
          key={i}
          data={tracks}
          interactive={false}
          visible={trackShown}
          color={paint['line-color']}
          width={paint['line-width']}
          opacity={paint['line-opacity'] ?? 1}
          dashArray={paint['line-dasharray']}
          lineCap={paint['line-dasharray'] ? 'butt' : 'round'}
        />
      ))}
      <MapLineLayer
        data={marks}
        interactive={false}
        visible={pairsShown}
        filter={['==', ['get', 'kind'], 'residual'] as never}
        color={RESIDUAL['line-color']}
        width={RESIDUAL['line-width']}
        opacity={RESIDUAL['line-opacity'] ?? 1}
        dashArray={RESIDUAL['line-dasharray']}
      />
      <MapCircleLayer
        data={marks}
        visible={pairsShown}
        filter={['in', ['get', 'kind'], ['literal', ['pair', 'reference']]] as never}
        color={
          [
            'match',
            ['get', 'kind'],
            'reference',
            PHOTO_PLAN_SYMBOLS.reference.color,
            PHOTO_PLAN_SYMBOLS.pair.color,
          ] as never
        }
        // A pair left out of the solve stays drawn, hollow, as a check point.
        opacity={['case', ['==', ['get', 'off'], 1], 0, 1] as never}
        radius={PAIR_RADIUS}
        strokeColor={['case', ['==', ['get', 'off'], 1], PHOTO_PLAN_SYMBOLS.pair.color, CAMERA_HALO.color] as never}
        strokeWidth={2}
      />
      {/* Keyed by whether it takes clicks: a layer with a click handler keeps the click from the plan. */}
      <MapCircleLayer
        key={onOpen ? 'opens' : 'still'}
        data={eyes}
        visible={camerasShown}
        color={CAMERA.color}
        radius={['case', ['==', ['get', 'active'], 1], CAMERA_RADIUS + 2, CAMERA_RADIUS] as never}
        strokeColor={CAMERA_HALO.color}
        strokeWidth={['case', ['==', ['get', 'active'], 1], 3, CAMERA_HALO.width * PX_PER_PT] as never}
        hoverHtml={(properties) => {
          const label = String(properties.label ?? '')
          return label ? `<span>${escapeHtml(label)}${onOpen ? ' · click to open' : ''}</span>` : null
        }}
        onFeatureClick={onOpen ? (id) => onOpen(String(id)) : undefined}
      />
    </>
  )
}

/**
 * The plan end of the photo ↔ plan linked cursor: a crosshair where the ray through the hovered photo pixel
 * meets the ground (`hitAt`). It takes no pointer input, so hovering the plan under it is unaffected and it needs
 * nothing from `PlanClickToMove`. `point={null}` hides it.
 */
export function LinkedCursorMarker({ point }: { point: { lng: number; lat: number } | null }) {
  if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return null
  const [casing, line] = PHOTO_PLAN_SYMBOLS.cursor.layers
  return (
    <MapMarker longitude={point.lng} latitude={point.lat} className="pointer-events-none">
      <MarkerContent className="pointer-events-none">
        <svg
          viewBox="-12 -12 24 24"
          width={24}
          height={24}
          aria-hidden="true"
          data-testid="photo-linked-cursor"
          className="pointer-events-none"
        >
          {[casing, line].map((stroke, i) => (
            <g key={i} stroke={stroke.color} strokeWidth={stroke.width * PX_PER_PT} fill="none">
              <circle r={5} />
              <path d="M-11 0h6M5 0h6M0-11v6M0 5v6" />
            </g>
          ))}
        </svg>
      </MarkerContent>
    </MapMarker>
  )
}
