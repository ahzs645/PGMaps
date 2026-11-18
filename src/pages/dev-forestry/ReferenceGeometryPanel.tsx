import { useEffect, useState } from 'react'
import { StyledSelect } from '@/components/ui/styled-select'
import { Map as PlanMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { AttachmentPreview } from './ProjectAttachments'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { featureName, toFeatures } from './shapeImport'
import { polygonBounds, polygonAreaMeters, type PolygonGeometry } from './visibility'
import type { ProjectAttachment } from './projectArchive'
import { referenceLabels, chosenValues, type ReferenceRow } from './referenceMeasurements'

const roles = {
  landscape: 'Landform for this view',
  block: 'Study-date proposal boundary',
  treatment: 'Mapped treatment unit within proposal',
  retained: 'Retention patch',
  natural: 'Natural exclusion (numerical green area)',
  rock: 'Rock exclusion (numerical and image area)',
  private: 'Private land exclusion',
  permanent: 'Permanent alteration',
}
export type CandidateRole = keyof typeof roles
export type OutlineChoice = { name: string; geometry: PolygonGeometry; source: string }
export type ReferenceGeometryActions = {
  blocks: Array<{ id: string; name: string }>
  onAdopt: (row: ReferenceRow, choice: OutlineChoice, role: CandidateRole, blockId: string) => void
}
function validPolygon(g: GeoJSON.Geometry | null): g is PolygonGeometry {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return false
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return (
    polygons.length > 0 &&
    polygons.every(
      (p) =>
        p.length > 0 &&
        p.every(
          (r) =>
            r.length >= 4 &&
            r.every(
              (c) =>
                Array.isArray(c) &&
                Number.isFinite(c[0]) &&
                Number.isFinite(c[1]) &&
                Math.abs(c[0]) <= 180 &&
                Math.abs(c[1]) <= 90,
            ) &&
            r[0][0] === r[r.length - 1][0] &&
            r[0][1] === r[r.length - 1][1],
        ),
    )
  )
}
export function ReferenceGeometryPanel({
  row,
  attachments,
  actions,
  onChange,
}: {
  row: ReferenceRow
  attachments: ProjectAttachment[]
  actions: ReferenceGeometryActions
  onChange: (r: ReferenceRow) => void
}) {
  const values = chosenValues(row)
  const [file, setFile] = useState<ProjectAttachment | null>(null),
    [choices, setChoices] = useState<OutlineChoice[]>([]),
    [index, setIndex] = useState(''),
    [role, setRole] = useState<CandidateRole>('landscape'),
    [block, setBlock] = useState('')
  const [error, setError] = useState(''),
    [showFit, setShowFit] = useState(false),
    [fits, setFits] = useState<Array<Record<string, unknown>>>([])
  const [fitError, setFitError] = useState('')
  const [imageName, setImageName] = useState<string | null>(null)
  const images = attachments.filter((a) => /\.(?:jpe?g|png|webp)$/i.test(a.name))
  const sourceImage =
    images.find((a) => a.name === (imageName ?? values.source)) ??
    (imageName === null && /^\d+$/.test(values.page ?? '')
      ? images.find((a) => a.name.startsWith('Figure ') && a.name.endsWith(' - p' + values.page + '.jpg'))
      : undefined)
  const options = attachments.filter((a) => a.name.toLowerCase().endsWith('.geojson'))
  const fitFile = attachments.find((a) => /registration results\.json$/i.test(a.name))
  useEffect(() => {
    let active = true
    if (file)
      void (async () => {
        if (file.blob.size > 32 * 1024 * 1024) throw Error('Geometry attachment exceeds 32 MiB.')
        const features = toFeatures(JSON.parse(await file.blob.text()))
        const candidates = features.flatMap((f, i) =>
          validPolygon(f.geometry)
            ? [
                {
                  name: [f.properties?.kind, featureName(f.properties, i)].filter(Boolean).join(' · '),
                  geometry: f.geometry,
                  source: file.name + ' · feature ' + (i + 1),
                },
              ]
            : [],
        )
        if (active) {
          setChoices(candidates)
          if (!candidates.length) setError('No closed WGS84 polygons found.')
        }
      })().catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [file])
  useEffect(() => {
    let active = true
    if (showFit && fitFile)
      void (async () => {
        if (fitFile.blob.size > 8 * 1024 * 1024) throw Error('Registration results exceed 8 MiB.')
        const data: unknown = JSON.parse(await fitFile.blob.text())
        if (!Array.isArray(data)) throw Error('Invalid registration results.')
        if (active)
          setFits(
            data.filter(
              (f) =>
                f &&
                f.case === row.caseId &&
                f.vp === row.printed.viewpoint &&
                (!row.printed.landform || f.landform === row.printed.landform),
            ),
          )
      })().catch((e) => {
        if (active) setFitError(String(e))
      })
    return () => {
      active = false
    }
  }, [fitFile, showFit, row.caseId, row.printed.viewpoint, row.printed.landform])
  const choice = choices[Number(index)]
  return (
    <details className="space-y-2 rounded-md border p-3">
      <summary className="cursor-pointer font-medium">Study geometry and registration</summary>
      {fitFile && (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowFit(true)}>
            Read registration candidates for this row
          </Button>
          {showFit && !fits.length && <p>{fitError || 'No matching fit loaded.'}</p>}
          {fits.map((f, i) => (
            <div key={i} className="space-y-1">
              <p>
                {String(f.landform)} · {String(f.projection)} · span {String(f.spanDeg)}° · yaw {String(f.yaw)}°
              </p>
              <p>
                Fit grade {String(f.grade)} · median {String(f.medianPx)} px · 90th percentile {String(f.p90Px)} px.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const fields = {
                    projection: String(f.projection),
                    span: String(f.spanDeg),
                    heading: String(f.yaw),
                    pose: 'Yaw ' + String(f.yaw) + '°',
                    cameraEvidence:
                      fitFile.name +
                      ' · ' +
                      String(f.slug) +
                      ' · fit ' +
                      String(f.grade) +
                      ', median ' +
                      String(f.medianPx) +
                      ' px, p90 ' +
                      String(f.p90Px) +
                      ' px',
                  }
                  onChange({
                    ...row,
                    corrections: { ...row.corrections, ...fields },
                    useSource: row.useSource?.filter((k) => !(k in fields)),
                  })
                }}
              >
                Use fit values in review
              </Button>
            </div>
          ))}
        </>
      )}
      <label className="grid gap-1">
        Candidate geometry file
        <StyledSelect
          className={FORM_INPUT_CLASS}
          value={file ? options.indexOf(file) : ''}
          onChange={(e) => {
            setFile(e.target.value === '' ? null : options[Number(e.target.value)])
            setChoices([])
            setIndex('')
            setError('')
          }}
        >
          <option value="">Choose a project GeoJSON</option>
          {options.map((a, i) => (
            <option key={i} value={i}>
              {a.name}
            </option>
          ))}
        </StyledSelect>
      </label>
      {!!choices.length && (
        <>
          <label className="grid gap-1">
            Polygon
            <StyledSelect className={FORM_INPUT_CLASS} value={index} onChange={(e) => setIndex(e.target.value)}>
              <option value="">Choose a feature</option>
              {choices.map((c, i) => (
                <option key={i} value={i}>
                  {c.name}
                </option>
              ))}
            </StyledSelect>
          </label>
          <label className="grid gap-1">
            Apply as
            <StyledSelect
              className={FORM_INPUT_CLASS}
              value={role}
              onChange={(e) => setRole(e.target.value as CandidateRole)}
            >
              {Object.entries(roles).map(([k, s]) => (
                <option key={k} value={k}>
                  {s}
                </option>
              ))}
            </StyledSelect>
          </label>
          {(role === 'block' || role === 'treatment') && (
            <label className="grid gap-1">
              Proposal to update
              <StyledSelect className={FORM_INPUT_CLASS} value={block} onChange={(e) => setBlock(e.target.value)}>
                <option value="">Choose a block</option>
                {role === 'block' && <option value="new">Add a separate proposal</option>}
                {actions.blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </StyledSelect>
            </label>
          )}
          {(role === 'block' || role === 'treatment') && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  [
                    'boundaryType',
                    ['Gross tenure', 'Original design', 'As-built', 'Reconstructed', 'Reviewer drawing'],
                  ],
                  ...(role === 'treatment' ? [['harvestSystem', ['clearcut', 'retention', 'partial']]] : []),
                ] as Array<[keyof typeof values, string[]]>
              ).map(([k, opts]) => (
                <label key={k}>
                  {k === 'boundaryType' ? 'Boundary type' : 'Harvest system'}
                  <StyledSelect
                    className={FORM_INPUT_CLASS}
                    value={values[k] ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...row,
                        corrections: { ...row.corrections, [k]: e.target.value },
                        useSource: row.useSource?.filter((f) => f !== k),
                      })
                    }
                  >
                    <option value="">Choose</option>
                    {opts.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </StyledSelect>
                </label>
              ))}
              {(
                [
                  'boundaryDate',
                  ...(role === 'treatment' ? ['residualStems', 'treesRemoved', 'volumeRemoved', 'residualHeight'] : []),
                ] as const
              ).map((key) => {
                const k = key as keyof typeof values
                return (
                  <label key={k}>
                    {referenceLabels[k]}
                    <input
                      className={FORM_INPUT_CLASS}
                      defaultValue={values[k] ?? ''}
                      key={values[k] ?? ''}
                      onBlur={(e) => {
                        if (e.target.value !== (values[k] ?? ''))
                          onChange({
                            ...row,
                            corrections: { ...row.corrections, [k]: e.target.value },
                            useSource: row.useSource?.filter((f) => f !== k),
                          })
                      }}
                    />
                  </label>
                )
              })}
            </div>
          )}
          {choice && index !== '' && (
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <label>
                  Source figure
                  <StyledSelect
                    className={FORM_INPUT_CLASS}
                    value={sourceImage?.name ?? ''}
                    onChange={(e) => setImageName(e.target.value)}
                  >
                    <option value="">Choose an image</option>
                    {images.map((img, i) => (
                      <option key={i}>{img.name}</option>
                    ))}
                  </StyledSelect>
                </label>
                {sourceImage && <AttachmentPreview file={sourceImage} />}
              </div>
              <div className="min-w-0">
                <p>Candidate on the plan map</p>
                <div className="relative h-56 overflow-hidden rounded-md border">
                  <PlanMap
                    key={choice.source}
                    bounds={polygonBounds(choice.geometry)}
                    fitBoundsOptions={{ padding: 18, maxZoom: 16 }}
                    containerProps={{ 'aria-label': 'Candidate polygon on plan map' }}
                  >
                    <MapFillLayer
                      interactive={false}
                      data={{
                        type: 'FeatureCollection',
                        features: [{ type: 'Feature', geometry: choice.geometry, properties: {} }],
                      }}
                      fillColor="#257d72"
                      fillOpacity={0.35}
                      lineColor="#174a43"
                      lineWidth={2}
                    />
                  </PlanMap>
                </div>
              </div>
            </div>
          )}
          {choice && index !== '' && (
            <p>
              {(polygonAreaMeters(choice.geometry) / 10000).toFixed(2)} ha · {choice.source} · study date{' '}
              {values.studyDate || 'unspecified'}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            disabled={
              index === '' ||
              !choice ||
              (role === 'landscape' && !row.viewId) ||
              ((role === 'block' || role === 'treatment') &&
                (!block || (role === 'treatment' && (block === 'new' || !values.harvestSystem))))
            }
            onClick={() => {
              try {
                actions.onAdopt(row, choice, role, block)
                setIndex('')
                setError('')
              } catch (e) {
                setError(String(e))
              }
            }}
          >
            Adopt selected polygon
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
