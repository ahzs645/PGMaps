import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob } from '@/lib/download'
import { errorText, PORTAL_CONNECTION_EVENT } from '@/lib/nechakoPortal'
import { composeMapImage, type ComposedMapImage } from './data/composeMapImage'
import { DEFAULT_MAP_IMAGE_OPTIONS, MAP_IMAGE_SIZES, type MapImageOptions } from './data/mapImage'
import type { Workspace } from './data/workspace'

export function PortalMapExport({
  map,
  workspace,
  mapWarning = '',
}: {
  map: RefObject<MapLibreMap | null>
  workspace: Workspace
  mapWarning?: string
}) {
  const [options, setOptions] = useState<MapImageOptions>(DEFAULT_MAP_IMAGE_OPTIONS)
  const [customSize, setCustomSize] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ComposedMapImage & { url: string; optionsKey: string; workspace: Workspace }>()
  const request = useRef<AbortController>()
  const widthInput = useRef<HTMLInputElement>(null)
  const optionsKey = JSON.stringify(options)
  const stale = preview && (preview.optionsKey !== optionsKey || preview.workspace !== workspace)
  useEffect(() => {
    const clear = () => {
      request.current?.abort()
      setBusy(false)
      setPreview(undefined)
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, clear)
    return () => {
      request.current?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, clear)
    }
  }, [])
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url)
    },
    [preview],
  )
  const update = <K extends keyof MapImageOptions>(key: K, value: MapImageOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }))
  const prepare = async () => {
    if (!map.current) {
      setError('The map is not ready yet. Close this window, wait for the map, and try again.')
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const image = await composeMapImage(map.current, workspace, options, controller.signal)
      if (!controller.signal.aborted)
        setPreview({ ...image, url: URL.createObjectURL(image.blob), optionsKey, workspace })
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const preset = MAP_IMAGE_SIZES.find((size) => size.width === options.width && size.height === options.height)
  const inputClass = 'mt-1 block w-full rounded border bg-background p-2 text-base'
  return (
    <div className="space-y-4" data-nechako-map-export>
      <p className="text-sm text-muted-foreground">
        Compose a PNG from the current map view with a title, north arrow, scale bar, legend and source credits. The
        complete visible extent keeps its proportions; unused space appears as a margin.
      </p>
      <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <legend className="mb-3 font-semibold">Map image options</legend>
          <label className="block text-sm font-medium">
            Title
            <input
              aria-label="Map image title"
              className={inputClass}
              maxLength={160}
              value={options.title}
              onChange={(event) => update('title', event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Image size
            <select
              aria-label="Map image size"
              className={inputClass}
              value={customSize ? 'custom' : (preset?.label ?? 'custom')}
              onChange={(event) => {
                const size = MAP_IMAGE_SIZES.find((size) => size.label === event.target.value)
                setCustomSize(!size)
                if (size) setOptions((current) => ({ ...current, width: size.width, height: size.height }))
                else {
                  widthInput.current?.focus()
                  widthInput.current?.select()
                }
              }}
            >
              {MAP_IMAGE_SIZES.map((size) => (
                <option key={size.label} value={size.label}>
                  {size.label} pixels
                </option>
              ))}
              <option value="custom">Custom dimensions</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Width (px)
              <input
                ref={widthInput}
                aria-label="Map image width"
                className={inputClass}
                type="number"
                min={240}
                max={4096}
                step={1}
                value={Number.isFinite(options.width) ? options.width : ''}
                onChange={(event) => {
                  setCustomSize(true)
                  update('width', event.target.valueAsNumber)
                }}
              />
            </label>
            <label className="text-sm font-medium">
              Height (px)
              <input
                aria-label="Map image height"
                className={inputClass}
                type="number"
                min={240}
                max={4096}
                step={1}
                value={Number.isFinite(options.height) ? options.height : ''}
                onChange={(event) => {
                  setCustomSize(true)
                  update('height', event.target.valueAsNumber)
                }}
              />
            </label>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const canvas = map.current?.getCanvas()
              if (!canvas) return
              setCustomSize(true)
              setOptions((current) => ({ ...current, width: canvas.clientWidth, height: canvas.clientHeight }))
            }}
          >
            Same as Map
          </Button>
          <p className="text-xs text-muted-foreground">
            240–4096 pixels per side. Higher output sizes scale the current rendered image.
          </p>
          <label className="block text-sm font-medium">
            North arrow
            <select
              aria-label="Map image north arrow"
              className={inputClass}
              value={options.northArrow ? options.northArrowStyle : 'none'}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  northArrow: event.target.value !== 'none',
                  northArrowStyle: event.target.value === 'compass' ? 'compass' : 'arrow',
                }))
              }
            >
              <option value="none">No Arrow</option>
              <option value="arrow">Arrow Style 1 · simple</option>
              <option value="compass">Arrow Style 2 · compass</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.scaleBar}
              onChange={(event) => update('scaleBar', event.target.checked)}
            />
            Scale bar
          </label>
          {options.scaleBar && (
            <div className="space-y-2 rounded border p-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options.scaleDistanceKm === null}
                  onChange={(event) => update('scaleDistanceKm', event.target.checked ? null : 20)}
                />
                Automatic scale distance
              </label>
              {options.scaleDistanceKm !== null && (
                <label className="block text-sm">
                  Scale distance (km)
                  <input
                    aria-label="Map image scale distance"
                    className={inputClass}
                    type="number"
                    min={0.001}
                    max={20000}
                    step="any"
                    value={Number.isFinite(options.scaleDistanceKm) ? options.scaleDistanceKm : ''}
                    onChange={(event) => update('scaleDistanceKm', event.target.valueAsNumber)}
                  />
                </label>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.legend}
              onChange={(event) => update('legend', event.target.checked)}
            />
            Legend
          </label>
          {options.legend && (
            <label className="block text-sm">
              Legend scale
              <input
                aria-label="Map image legend scale"
                className={inputClass}
                type="number"
                min={0.5}
                max={3}
                step={0.1}
                value={Number.isFinite(options.legendScale) ? options.legendScale : ''}
                onChange={(event) => update('legendScale', event.target.valueAsNumber)}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.attribution}
              onChange={(event) => update('attribution', event.target.checked)}
            />
            Attribution
          </label>
          {options.attribution && (
            <label className="block text-sm">
              Additional attribution
              <input
                aria-label="Map image attribution"
                className={inputClass}
                maxLength={240}
                value={options.attributionText}
                onChange={(event) => update('attributionText', event.target.value)}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Included alongside the map provider credits.
              </span>
            </label>
          )}
        </fieldset>
        <div className="min-w-0 space-y-3">
          <h3 className="font-semibold">Image preview</h3>
          {mapWarning && (
            <InlineAlert tone="warning" title="Some map imagery reported an error">
              {mapWarning} The image will contain only the map content that rendered.
            </InlineAlert>
          )}
          {preview ? (
            <>
              <img
                src={preview.url}
                alt={`Map image preview: ${options.title || 'untitled map'}`}
                className="h-auto max-h-[65vh] w-full object-contain rounded border bg-white"
              />
              <p className="text-xs text-muted-foreground">
                PNG {preview.width} × {preview.height} pixels · rendered map {preview.sourceWidth} ×{' '}
                {preview.sourceHeight} pixels
              </p>
              {stale && (
                <InlineAlert tone="warning">
                  The map or image options changed. Update the preview before downloading.
                </InlineAlert>
              )}
              {preview.warnings.length > 0 && (
                <InlineAlert tone="warning" title="Image notes">
                  <ul className="list-disc space-y-1 pl-4">
                    {preview.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </InlineAlert>
              )}
            </>
          ) : (
            <div className="rounded border border-dashed p-8 text-sm text-muted-foreground">
              Choose the image options, then prepare a preview.
            </div>
          )}
          {busy && <InlineAlert loading>Preparing the rendered map and visible legends…</InlineAlert>}
          {error && (
            <InlineAlert tone="error" title="Image could not be prepared">
              {error}
            </InlineAlert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void prepare()}>
              {preview ? 'Update image preview' : 'Prepare image preview'}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !preview || !!stale}
              onClick={() => {
                if (preview && !stale) downloadBlob(preview.blob, 'nechako-map.png')
              }}
            >
              Download PNG
            </Button>
            {busy && (
              <Button
                variant="outline"
                onClick={() => {
                  request.current?.abort()
                  setBusy(false)
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            A rendered map image does not include editable geographic data. Use workspace JSON or a layer’s spatial
            export for those files.
          </p>
        </div>
      </div>
    </div>
  )
}
