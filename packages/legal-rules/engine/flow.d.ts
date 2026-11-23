import type { assess } from './evaluate'
import type { FactSet, Pack } from '../src/contract'
export type RuleFinding = ReturnType<typeof assess>['releases'][number]['findings'][number]
interface Check {
  group: number
  label: string
  actual: string
  comparison: string
  truth: string
  difference: string | null
  evidence: string
}
export interface FlowNode {
  id: string
  title: string
  active: boolean
  detail: string
  lines: Check[]
}
export function makeFlow(
  pack: Pack,
  rule: Pack['rules'][number],
  finding: RuleFinding,
  facts: FactSet,
  date: string,
): FlowNode[]
export function drawFlow(host: HTMLElement, nodes: FlowNode[], onSelect: (n: FlowNode) => void): void
export function toMermaid(nodes: FlowNode[]): string
