import { useMemo, useState } from 'react'
import { AppSelect } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { resolvePaletteScale, type PaletteClassification, type PaletteSampling } from '@/lib/paletteScale'
import { PalettePreview } from './PalettePreview'
import type { CatalogPalette } from './types'

const fieldClass = 'grid min-w-0 gap-2 text-sm'
function RangeField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <label className={fieldClass}>
      {label}: {value}
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-full accent-primary"
      />
    </label>
  )
}

export function ScaleLab({ palette, counterpart }: { palette: CatalogPalette; counterpart?: CatalogPalette }) {
  const lightPalette = palette.theme.variant === 'dark' && counterpart ? counterpart : palette
  const darkPalette = palette.theme.variant === 'light' && counterpart ? counterpart : palette
  const [classes, setClasses] = useState(5)
  const [start, setStart] = useState(0),
    [end, setEnd] = useState(100)
  const [darkStart, setDarkStart] = useState(0),
    [darkEnd, setDarkEnd] = useState(100)
  const [separateDark, setSeparateDark] = useState(false)
  const [reverse, setReverse] = useState(false)
  const [opacity, setOpacity] = useState(100)
  const [classification, setClassification] = useState<PaletteClassification>('equal-interval')
  const [interpolation, setInterpolation] = useState<'rgb' | 'lab'>('rgb')
  const [domainMode, setDomainMode] = useState('fixed')
  const [minText, setMinText] = useState('0'),
    [maxText, setMaxText] = useState('100')
  const [valuesText, setValuesText] = useState('0, 1, 2, 2, 5, 8, 13, 21, 34, 55, 80, 100')
  const [breaksText, setBreaksText] = useState('20, 40, 60, 80')
  const canSample = ['ordered', 'heatmap'].includes(palette.kind)
  const parsed = useMemo(() => {
    try {
      const parse = (text: string) =>
        text.trim()
          ? text.split(/[\s,]+/).map((s) => {
              const v = Number(s)
              if (!Number.isFinite(v)) throw new Error('Use finite numeric values separated by commas.')
              return v
            })
          : []
      const values = parse(valuesText)
      if (domainMode === 'automatic' && !values.length) throw new Error('Automatic domain needs sample values.')
      if (!minText.trim() || !maxText.trim()) throw new Error('Enter both domain endpoints.')
      const domain: [number, number] =
        domainMode === 'automatic' ? [Math.min(...values), Math.max(...values)] : [Number(minText), Number(maxText)]
      const sampling: PaletteSampling = {
        colors: lightPalette.colors,
        positions: palette.positions,
        range: [start / 100, end / 100],
        reverse,
        interpolation,
      }
      const darkSampling: PaletteSampling = {
        ...sampling,
        colors: darkPalette.colors,
        range: separateDark ? [darkStart / 100, darkEnd / 100] : sampling.range,
      }
      const options = {
        ...sampling,
        domain,
        classes,
        classification,
        values,
        breaks: classification === 'manual' ? parse(breaksText) : undefined,
        missingColor: palette.missingColor ?? '#737373',
      }
      return {
        sampling,
        darkSampling,
        values,
        options,
        light: resolvePaletteScale(options),
        dark: resolvePaletteScale({ ...options, ...darkSampling }),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid scale' }
    }
  }, [
    palette,
    lightPalette,
    darkPalette,
    start,
    end,
    reverse,
    interpolation,
    separateDark,
    darkStart,
    darkEnd,
    domainMode,
    minText,
    maxText,
    classes,
    classification,
    valuesText,
    breaksText,
  ])
  const lightColors = canSample && parsed.light ? parsed.light.colors : lightPalette.colors
  const darkColors = canSample && parsed.dark ? parsed.dark.colors : darkPalette.colors
  const exportScale = () => {
    if (!parsed.light) return
    downloadText(
      JSON.stringify(
        {
          source: { file: palette.file, name: palette.name },
          classification,
          domain: parsed.light.domain,
          breaks: parsed.light.breaks,
          requestedClasses: classes,
          effectiveClasses: parsed.light.effectiveClasses,
          light: { range: parsed.sampling.range, colors: parsed.light.colors },
          dark: { range: parsed.darkSampling.range, colors: parsed.dark.colors },
          reverse,
          interpolation,
          opacity: opacity / 100,
          missingColor: parsed.options.missingColor,
          boundary: 'upper bin at threshold',
          outOfDomain: 'clamp',
          sampleValues: parsed.values,
        },
        null,
        2,
      ),
      'palette-scale.json',
      'application/json',
    )
  }
  return (
    <div className="space-y-5">
      {!canSample && (
        <InlineAlert>
          This is a {palette.kind} group. It is shown as authored; numeric resampling is disabled. Use an ordered
          palette to experiment with dynamic steps. Diverging scales also need an explicit neutral centre.
        </InlineAlert>
      )}
      {canSample && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <RangeField label="Steps" min={1} max={12} value={classes} onChange={setClasses} />
            <RangeField label="Palette start (%)" max={end} value={start} onChange={setStart} />
            <RangeField label="Palette end (%)" min={start} value={end} onChange={setEnd} />
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex min-h-10 items-center gap-2">
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              Reverse colours
            </label>
            <label className="flex min-h-10 items-center gap-2">
              <input type="checkbox" checked={separateDark} onChange={(e) => setSeparateDark(e.target.checked)} />
              Separate dark palette range
            </label>
          </div>
          {separateDark && (
            <div className="grid gap-4 sm:grid-cols-2">
              <RangeField label="Dark palette start (%)" max={darkEnd} value={darkStart} onChange={setDarkStart} />
              <RangeField label="Dark palette end (%)" min={darkStart} value={darkEnd} onChange={setDarkEnd} />
            </div>
          )}
          <label className={fieldClass}>
            Interpolation
            <AppSelect
              triggerAriaLabel="Interpolation"
              value={interpolation}
              onValueChange={(v) => setInterpolation(v as 'rgb' | 'lab')}
              options={[
                { value: 'rgb', label: 'RGB — preserve current interpolation' },
                { value: 'lab', label: 'Lab — perceptual lightness experiment' },
              ]}
            />
          </label>
        </>
      )}
      <RangeField label="Fill opacity (%)" value={opacity} onChange={setOpacity} />
      {canSample && parsed.error && <InlineAlert tone="error">{parsed.error}</InlineAlert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <PalettePreview
          title="Light surface"
          dark={false}
          colors={lightColors}
          sampling={canSample ? parsed.sampling : undefined}
          opacity={opacity / 100}
        />
        <PalettePreview
          title="Dark surface"
          dark
          colors={darkColors}
          sampling={canSample ? parsed.darkSampling : undefined}
          opacity={opacity / 100}
        />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Reference surfaces, not sampled basemap pixels. Ratios include fill opacity; they are diagnostic, not an
        accessibility pass. Selection/halo marks illustrate proposed shared roles. Changes here are local experiments.
      </p>
      {palette.missingColor && (
        <p className="flex items-center gap-2 text-xs">
          <span className="inline-block h-4 w-4 rounded border" style={{ background: palette.missingColor }} />
          Missing / fallback: <code>{palette.missingColor}</code> · kept outside the numeric ramp
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Authored colours ({palette.colors.length})</summary>
        <div className="mt-3 flex flex-wrap gap-3">
          {palette.colors.map((c, i) => (
            <code className="break-all text-xs" key={i}>
              {c}
            </code>
          ))}
        </div>
      </details>
      {canSample && (
        <div className="space-y-4 border-t pt-5">
          <h3 className="font-semibold">Data classification · illustrative values</h3>
          <p className="text-sm text-muted-foreground">
            Palette trimming changes colours. Classification changes numeric bins. Fixed domains and manual breaks
            support comparisons across dates.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldClass}>
              Classification
              <AppSelect
                triggerAriaLabel="Classification"
                value={classification}
                onValueChange={(v) => setClassification(v as PaletteClassification)}
                options={[
                  { value: 'equal-interval', label: 'Equal interval' },
                  { value: 'quantile', label: 'Quantile' },
                  { value: 'manual', label: 'Manual thresholds' },
                ]}
              />
            </label>
            <label className={fieldClass}>
              Data domain
              <AppSelect
                triggerAriaLabel="Data domain"
                value={domainMode}
                onValueChange={setDomainMode}
                options={[
                  { value: 'fixed', label: 'Fixed endpoints' },
                  { value: 'automatic', label: 'From sample values' },
                ]}
              />
            </label>
            {domainMode === 'fixed' && (
              <>
                <label className={fieldClass}>
                  Domain minimum
                  <SearchInput
                    aria-label="Domain minimum"
                    value={minText}
                    onChange={(e) => setMinText(e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Domain maximum
                  <SearchInput
                    aria-label="Domain maximum"
                    value={maxText}
                    onChange={(e) => setMaxText(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <label className={fieldClass}>
            Sample values
            <SearchInput
              aria-label="Sample values"
              value={valuesText}
              onChange={(e) => setValuesText(e.target.value)}
            />
          </label>
          {classification === 'manual' && (
            <label className={fieldClass}>
              Manual breaks
              <SearchInput
                aria-label="Manual breaks"
                value={breaksText}
                onChange={(e) => setBreaksText(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">Manual breaks determine the step count.</span>
            </label>
          )}
          {parsed.light && (
            <>
              <p className="text-sm" aria-live="polite">
                {parsed.light.effectiveClasses} effective steps · domain {parsed.light.domain.join(' to ')}
                {parsed.light.effectiveClasses !== classes && classification !== 'manual'
                  ? ' · repeated thresholds or constant values reduced the class count'
                  : ''}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2">Bin</th>
                      <th>Light</th>
                      <th>Dark</th>
                      <th>Values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.light.bins.map((b, i) => (
                      <tr className="border-b" key={i}>
                        <td className="py-2">
                          {Number(b.min.toPrecision(6))} {b.includesMax ? 'to' : 'to <'} {Number(b.max.toPrecision(6))}
                        </td>
                        <td>
                          <span className="inline-block h-5 w-8 rounded border" style={{ background: b.color }} />
                        </td>
                        <td>
                          <span
                            className="inline-block h-5 w-8 rounded border"
                            style={{ background: parsed.dark.colors[i] }}
                          />
                        </td>
                        <td>{parsed.values.filter((v) => parsed.light.indexForValue(v) === i).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Threshold values enter the upper bin. Values outside the domain clamp to the end bins; null and
                nonfinite values use the missing-data colour. Numeric labels are rounded for display; exported
                thresholds retain precision.
              </p>
              <Button variant="outline" onClick={exportScale}>
                Download resolved scale
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
