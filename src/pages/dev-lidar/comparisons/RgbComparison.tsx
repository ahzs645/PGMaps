import { NativeSelect } from '@/components/ui/form-field'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import type { Basemap } from '../basemaps'
import { ComparisonMap, sameCamera, type ComparisonCamera } from './ComparisonMap'
import { ComparisonPane } from './ComparisonPane'
import { ComparisonPreference } from './ComparisonPreference'
import { boxDiagnostics, rgbFeatures, EMPTY_FEATURES, type ComparisonData } from './data'
import { modelById } from './registry'

export function RgbComparison({
  data,
  basemap,
  selectedModel,
}: {
  data: ComparisonData
  basemap: Basemap
  selectedModel?: string
}) {
  const [sampleId, setSampleId] = useState('osbs'),
    [a, setA] = useState('deepforest'),
    [b, setB] = useState('canopy-maskrcnn'),
    [threshold, setThreshold] = useState(0.25),
    [masks, setMasks] = useState(true),
    [truth, setTruth] = useState(true),
    [opacity, setOpacity] = useState(0.25),
    [linked, setLinked] = useState(true),
    [camera, setCamera] = useState<ComparisonCamera | null>(null),
    [reset, setReset] = useState(0)
  useEffect(() => {
    if (selectedModel) {
      setA(selectedModel)
      setB(selectedModel === 'deepforest' ? 'canopy-maskrcnn' : 'deepforest')
    }
  }, [selectedModel])
  const sample = data.rgb.samples.find((s) => s.id === sampleId) ?? data.rgb.samples[0]
  const fa = useMemo(() => rgbFeatures(sample, a, threshold, masks), [sample, a, threshold, masks]),
    fb = useMemo(() => rgbFeatures(sample, b, threshold, masks), [sample, b, threshold, masks])
  const refs = useMemo(
    () =>
      truth
        ? {
            type: 'FeatureCollection' as const,
            features: sample.truth_geometries.map((geometry, i) => ({
              type: 'Feature' as const,
              geometry,
              properties: { id: `reference-${i}`, colour: '#06b6d4' },
            })),
          }
        : EMPTY_FEATURES,
    [sample, truth],
  )
  const image = useMemo(() => ({ url: sample.image, coordinates: sample.coordinates }), [sample])
  const onCamera = useCallback(
    (next: ComparisonCamera) => setCamera((previous) => (sameCamera(previous, next) ? previous : next)),
    [],
  )
  const ma = boxDiagnostics(sample.models[a].predictions, sample.truth, threshold),
    mb = boxDiagnostics(sample.models[b].predictions, sample.truth, threshold)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b p-2 text-xs">
        <label>
          RGB sample
          <NativeSelect
            aria-label="RGB comparison sample"
            className="ml-1 rounded border bg-background p-1.5"
            value={sample.id}
            onChange={(e) => {
              setSampleId(e.target.value)
              setCamera(null)
            }}
          >
            {data.rgb.samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {[
          [a, setA, 'A'],
          [b, setB, 'B'],
        ].map(([id, set, label]) => (
          <label key={String(label)}>
            {String(label)}
            <NativeSelect
              aria-label={`RGB model ${label}`}
              className="ml-1 max-w-[185px] rounded border bg-background p-1.5"
              value={String(id)}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
            >
              {Object.keys(sample.models).map((id) => (
                <option key={id} value={id}>
                  {modelById(id)?.name ?? id}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
        <label>
          Score ≥ {threshold.toFixed(2)}
          <input
            className="ml-1 w-20 align-middle"
            aria-label="RGB score threshold"
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
          />
        </label>
        <label>
          <input type="checkbox" checked={masks} onChange={(e) => setMasks(e.target.checked)} />
          Masks when available
        </label>
        <label>
          <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} />
          Reference boxes
        </label>
        <label>
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          Link cameras
        </label>
        <label>
          Fill
          <input
            aria-label="RGB mask opacity"
            className="ml-1 w-16 align-middle"
            type="range"
            min={0}
            max={0.8}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(+e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCamera(null)
            setReset((n) => n + 1)
          }}
        >
          Fit image
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <div className="flex h-full min-h-[400px] flex-col gap-2 lg:min-h-[300px] lg:flex-row">
          {[
            [a, fa, ma, 'A'],
            [b, fb, mb, 'B'],
          ].map(([id, features, metrics, label]) => {
            const model = String(id),
              m = metrics as typeof ma,
              run = sample.models[model]
            return (
              <ComparisonPane
                key={String(label)}
                label={String(label)}
                title={modelById(model)?.name ?? model}
                metrics={[
                  { label: 'Predictions / box matches', value: `${m.predictions} / ${m.matched}` },
                  { label: 'False positives / missed', value: `${m.falsePositives} / ${m.missed}` },
                  {
                    label: 'Precision / recall',
                    value: `${m.precision === null ? '—' : (100 * m.precision).toFixed(1) + '%'} / ${m.recall === null ? '—' : (100 * m.recall).toFixed(1) + '%'}`,
                  },
                  { label: 'CPU inference', value: run.inference_seconds.toFixed(2) + ' s' },
                ]}
              >
                <ComparisonMap
                  label={`RGB comparison map ${label}`}
                  centre={sample.centre}
                  focusKey={`${sample.id}-${reset}`}
                  zoom={20.6}
                  view="top"
                  basemap={basemap}
                  image={image}
                  features={features as typeof fa}
                  references={refs}
                  camera={linked ? camera : null}
                  onCamera={linked ? onCamera : undefined}
                  overlayOpacity={opacity}
                />
              </ComparisonPane>
            )
          })}
        </div>
      </div>
      <div className="max-h-[24dvh] shrink-0 overflow-y-auto overscroll-contain border-t p-3 text-xs">
        <p>
          <strong>
            {sample.truth.length} reference boxes · actual {sample.source_crs} image location.
          </strong>{' '}
          The raster and model output share verified pixels and TIFF georeferencing. Cyan outlines are reference boxes.
        </p>
        <p className="mt-1 text-muted-foreground">
          Public development fixtures in the USA, separate from the BC LiDAR tile. Box matching uses IoU ≥ 0.50; these
          diagnostics are not independent validation, mask accuracy or point-instance labels. Scores filter saved
          predictions; no model is rerun in the browser. Masks use display contours of saved binary outputs.
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">Choose a result, inspect provenance and export</summary>
          <div className="mt-2">
            <ComparisonPreference
              scope={`rgb/${sample.id}/${sample.image_sha256}`}
              left={{ id: a, name: modelById(a)!.name }}
              right={{ id: b, name: modelById(b)!.name }}
              onExport={(review) =>
                downloadText(
                  JSON.stringify(
                    {
                      sample: { ...sample, image: undefined },
                      threshold,
                      masks,
                      a: { id: a, diagnostics: ma },
                      b: { id: b, diagnostics: mb },
                      review,
                    },
                    null,
                    2,
                  ),
                  'rgb-model-comparison.json',
                  'application/json',
                )
              }
            />
            <p className="mt-2 break-all text-[10px]">
              Image SHA-256: {sample.image_sha256}
              <br />A weights: {sample.models[a].weights_sha256}
              <br />B weights: {sample.models[b].weights_sha256}
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}
