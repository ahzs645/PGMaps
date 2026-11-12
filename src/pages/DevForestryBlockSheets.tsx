import { useState } from 'react'
import { Diff, Eye, LayoutTemplate, Map as MapIcon, Shapes } from 'lucide-react'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { Badge } from '@/components/ui/badge'
import { TabBar } from '@/components/ui/tab-bar'
import { ToolPageHeader } from '@/components/ui/tool-page-header'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { SYMBOL_CATALOGUE } from '@/lib/forestry/blockSheet/symbolCatalogue'
import { FigureStyleGallery } from './dev-forestry-block-sheets/FigureStyleGallery'
import { MismatchPanel } from './dev-forestry-block-sheets/MismatchPanel'
import { PresetGallery } from './dev-forestry-block-sheets/PresetGallery'
import { SymbolSheet } from './dev-forestry-block-sheets/SymbolSheet'

type View = 'presets' | 'symbols' | 'mismatches' | 'figures'

/**
 * The block map sheets' variants and symbols in one place: every preset at a few scales and papers,
 * a swatch sheet of every symbol beside its source values, and the legend-versus-map differences.
 * Linked from the block sheet setup. See docs/forestry-block-map-sheets.md.
 */
export default function DevForestryBlockSheets() {
  useDocumentTitle('Block sheet symbol gallery · PGMaps')
  const [view, setView] = useState<View>('presets')
  // A panel is drawn when first opened and kept, so switching back is instant.
  const [opened, setOpened] = useState<ReadonlySet<View>>(new Set(['presets']))
  const show = (next: View) => {
    setView(next)
    setOpened((previous) => new Set([...previous, next]))
  }
  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/25">
      <div className="mx-auto max-w-[1500px] px-4 pb-8 pt-20 sm:px-6 md:pt-6">
        <ToolPageHeader
          back={<ForestryBackLink variant="text" />}
          eyebrow="Block map sheets"
          eyebrowIcon={MapIcon}
          eyebrowClassName="text-amber-700 dark:text-amber-400"
          title="Block sheet symbol gallery"
          description="Every block sheet preset at several scales and papers, every map symbol beside the values it was drawn from, where the reference legends disagreed with their maps, and the VIA figure styles."
          aside={
            <Badge tone="neutral" variant="outline">
              {SYMBOL_CATALOGUE.length} symbols · synthetic data
            </Badge>
          }
        />
        <TabBar<View>
          value={view}
          onChange={show}
          idPrefix="block-sheets"
          label="Gallery view"
          options={[
            { value: 'presets', label: 'Sheet presets', icon: LayoutTemplate },
            { value: 'symbols', label: 'Symbols', icon: Shapes },
            { value: 'mismatches', label: 'Legend vs map', icon: Diff },
            { value: 'figures', label: 'VIA figure styles', icon: Eye },
          ]}
          className="mb-5"
        />
        {(['presets', 'symbols', 'mismatches', 'figures'] as const).map((id) => (
          <div
            key={id}
            role="tabpanel"
            id={`block-sheets-panel-${id}`}
            aria-labelledby={`block-sheets-tab-${id}`}
            hidden={view !== id}
          >
            {opened.has(id) &&
              (id === 'presets' ? (
                <PresetGallery />
              ) : id === 'symbols' ? (
                <SymbolSheet />
              ) : id === 'mismatches' ? (
                <MismatchPanel />
              ) : (
                <FigureStyleGallery />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
