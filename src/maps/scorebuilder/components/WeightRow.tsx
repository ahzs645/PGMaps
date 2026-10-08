import { CompactWeightRow as ToolkitCompactWeightRow } from '@pgmaps/geo-toolkit/index-lab/WeightRow'
import type { ComponentProps } from 'react'
import type { ScoreDataSource } from '../types'
import { getCategoryTone } from './scoreBuilderPanelUtils'
export { InactiveTermNotice } from '@pgmaps/geo-toolkit/index-lab/WeightRow'

export function CompactWeightRow(props: ComponentProps<typeof ToolkitCompactWeightRow<ScoreDataSource>>) {
  return <ToolkitCompactWeightRow {...props} categoryTone={getCategoryTone(props.metric.category)} />
}
