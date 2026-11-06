import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import type { LayerSwatchShape } from '@/components/ui/layer-list-item'
import type { ExplorerGeometryType, ExplorerItem } from './types'

/** Each dataset's detail rows are consistent, so the first few items name its columns. */
const LABEL_SAMPLE_SIZE = 100
const MAX_DETAIL_COLUMNS = 7
const NUMERIC_TEXT = /^-?[\d,]*\.?\d+$/

export const EXPLORER_TABLE_SHAPE: Record<ExplorerGeometryType, LayerSwatchShape> = {
  point: 'point',
  line: 'line',
  polygon: 'fill',
}

function readDetail(item: ExplorerItem, label: string): string | undefined {
  return item.details.find((detail) => detail.label === label)?.value
}

function detailColumn(label: string, sample: readonly ExplorerItem[]) {
  const id = `detail:${label}`
  const values = sample.map((item) => readDetail(item, label)).filter(Boolean)
  if (values.length === 0 || !values.every((value) => NUMERIC_TEXT.test(value ?? ''))) {
    return textColumn<ExplorerItem>(id, label, (item) => readDetail(item, label))
  }
  // Details hold display text; the number sorts and exports raw while the cell keeps that text.
  return {
    ...numberColumn<ExplorerItem>(id, label, (item) => {
      const value = readDetail(item, label)
      return value ? Number(value.replace(/,/g, '')) : null
    }),
    getValue: (item: ExplorerItem) => readDetail(item, label) ?? '',
  }
}

/** Name and relevance, then what this dataset's items carry in their detail rows. */
export function explorerTableColumns(items: readonly ExplorerItem[]) {
  const sample = items.slice(0, LABEL_SAMPLE_SIZE)
  const dated = sample.some((item) => item.timestamp != null)
  const labels = [...new Set(sample.flatMap((item) => item.details.map((detail) => detail.label)))]
    .filter((label) => !(dated && label === 'Date'))
    .slice(0, MAX_DETAIL_COLUMNS)
  return [
    textColumn<ExplorerItem>('name', 'Name', (item) => item.name, { width: 240 }),
    numberColumn<ExplorerItem>('relevance', 'Relevance', (item) => item.relevance, {
      format: (value) => String(Math.round(value)),
      width: 100,
    }),
    ...(dated ? [dateColumn<ExplorerItem>('timestamp', 'Date', (item) => item.timestamp)] : []),
    ...labels.map((label) => detailColumn(label, sample)),
  ]
}
