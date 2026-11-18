import { useEffect, useRef, useState } from 'react'
import { Layers, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DisclosureCard, DisclosureRow } from '@/components/ui/disclosure'
import { CheckboxField, SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'

import { sameCamera } from './photoAcceptance'
import { cameraCueContributions } from './photoCombined'
import type { CombinedCandidate, CombinedResult, CombinedSettings } from './photoCombinedSearch'
import { ownAcceptancePose } from './PhotoOptionsCard'
import type { FieldPhotoState } from './useFieldPhoto'

function CameraScoreDetails({ candidate }: { candidate: CombinedCandidate }) {
  const terms = cameraCueContributions(candidate.cues)
  const rows = [
    ['Relative depth', terms.depth],
    ['Ground appearance', terms.appearance],
    ['Skyline', terms.skyline],
    ['Feature geometry', terms.geometry],
  ] as const
  const check = candidate.geometryCheck
  return (
    <DisclosureRow
      title={`Score ${candidate.score.toFixed(3)}`}
      summary="evidence breakdown"
      className="w-full border-t border-border/60"
      contentClassName="space-y-1"
    >
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-muted-foreground">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="text-right tabular-nums">{value == null ? '—' : value.toFixed(3)}</dd>
          </div>
        ))}
      </dl>
      {candidate.cues.depth && (
        <p className="text-muted-foreground">
          Depth correlation · overall {candidate.cues.depth.global.toFixed(3)} · side to side{' '}
          {candidate.cues.depth.lateral.toFixed(3)}
        </p>
      )}
      {check && (
        <p className="text-muted-foreground">
          {check.kind === 'overlap' ? 'Photo overlap p90' : 'Worst held-out paired point'} {check.errorPx.toFixed(1)} px
          at 1,050 px image width
        </p>
      )}
    </DisclosureRow>
  )
}

export function PhotoCombinedPanel({ photo }: { photo: FieldPhotoState }) {
  const [settings, setSettings] = useState<CombinedSettings>({ useSkyline: true, depthModel: null })
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ownResult, setResult] = useState<CombinedResult | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const own = photo.own
  const current = ownAcceptancePose(own)
  if (!current || !own) return null
  // The queue's own comparison for a photo the skyline did not settle, until the reviewer runs one of their own.
  const queued = photo.workFor(own.id).combined?.result ?? null
  const result = ownResult ?? (progress ? null : queued)
  const best = result?.candidates[0]

  const run = async () => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setError(null)
    setResult(null)
    setProgress('Starting camera comparison…')
    try {
      const next = await photo.runCombinedCameraSearch(own.id, settings, controller.signal, setProgress)
      if (!controller.signal.aborted) {
        setResult(next)
        photo.keepCombined(own.id, next)
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      const stopped = controller.signal.aborted
      controller.abort()
      if (request.current === controller) {
        request.current = null
        if (!stopped) setProgress(null)
      }
    }
  }

  const cancel = () => {
    request.current?.abort()
    request.current = null
    setProgress(null)
  }

  return (
    <DisclosureCard
      title="Combined camera search"
      summary={
        progress
          ? 'Comparing…'
          : best
            ? `Best ${best.pose.bearing.toFixed(0)}° by ${best.cues.depth ? 'depth and ground' : 'ground'}${sameCamera(current, best.pose) ? ', in use' : ''}`
            : result
              ? `${result.tested} cameras compared`
              : 'Ground features, skyline and depth together'
      }
    >
      <>
        <p className="text-muted-foreground">
          Compare ground features and available camera evidence. When the skyline is weak, try coarse headings around
          the photo's position.
        </p>
        <CheckboxField
          label="Use the skyline when visible"
          checked={settings.useSkyline}
          disabled={!!progress}
          onCheckedChange={(useSkyline) => setSettings((previous) => ({ ...previous, useSkyline }))}
        />
        <SelectField
          label="Local depth model"
          value={settings.depthModel ?? ''}
          disabled={!!progress}
          onChange={(event) => {
            const model = event.currentTarget.value
            setSettings((previous) => ({
              ...previous,
              depthModel: model === 'da2-small' || model === 'da3-small' ? model : null,
            }))
          }}
        >
          <option value="">Skip model depth</option>
          <option value="da2-small">Depth Anything V2 Small · 27 MB</option>
          <option value="da3-small">Depth Anything 3 Small · 105 MB</option>
        </SelectField>
        {settings.depthModel && (
          <p className="text-muted-foreground">
            The first run downloads the model and runtime. The browser can cache them, and the photo stays on this
            device.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={!!progress}
            onClick={() => void run()}
          >
            {progress ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
            Compare camera cues
          </Button>
          {progress && (
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Cancel search
            </Button>
          )}
        </div>
        {progress && (
          <p className="text-muted-foreground" role="status">
            {progress}
          </p>
        )}
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
        {result && (
          <div className="space-y-2" aria-label="Combined camera results">
            {!ownResult && (
              <p className="text-muted-foreground">
                Compared by itself when the skyline did not settle this photo
                {result.depthModel ? '' : ', without depth: choose a depth model and compare again to add it'}.
              </p>
            )}
            <p className="text-muted-foreground" role="status">
              Compared {result.tested} cameras
              {result.depthSamples ? ` with ${result.depthSamples.toLocaleString()} common depth samples` : ''}.
            </p>
            {result.depthModel && (
              <p className="text-muted-foreground">
                {result.depthModel === 'da3-small' ? 'Depth Anything 3 Small' : 'Depth Anything V2 Small'}
              </p>
            )}
            {result.depthIssue && <InlineAlert>{result.depthIssue}</InlineAlert>}
            {result.candidates.length === 0 ? (
              <p>There was too little terrain evidence. Pair a visible landmark or check the photo's position.</p>
            ) : (
              <>
                <ol className="space-y-2">
                  {result.candidates.map((candidate) => {
                    const { pose, cues } = candidate
                    const selected = sameCamera(current, pose)
                    const evidence = [
                      cues.depth && 'Relative depth',
                      cues.appearance != null && 'Ground appearance',
                      cues.skyline != null && 'Skyline',
                      cues.geometry != null && 'Paired points or photo overlap',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <li
                        key={`${candidate.label}-${pose.bearing}-${pose.pitch}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
                      >
                        <div>
                          <p className="font-medium">
                            {pose.bearing.toFixed(1)}° heading · {pose.pitch.toFixed(1)}° pitch
                          </p>
                          <p className="text-muted-foreground">
                            {candidate.label} · {evidence}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={selected}
                          onClick={() => {
                            const option = photo
                              .optionsFor(own.id)
                              .find((row) => row.id === candidate.rowId && sameCamera(row.pose, pose))
                            if (!option || !photo.chooseOption(own.id, option.id)) photo.setOwnPose(pose)
                          }}
                        >
                          {selected ? 'Current camera' : 'Use as starting camera'}
                        </Button>
                        <CameraScoreDetails candidate={candidate} />
                      </li>
                    )
                  })}
                </ol>
                <p className="text-muted-foreground">
                  Scores are comparable within this run. A dash means that cue was unavailable. Check close candidates
                  against a distinct mapped feature.
                </p>
              </>
            )}
          </div>
        )}
      </>
    </DisclosureCard>
  )
}
