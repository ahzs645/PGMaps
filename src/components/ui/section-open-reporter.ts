import { createContext } from 'react'

/**
 * Hears which collapsible sections are open, by their label. A page provides it when something needs
 * to know (a live lesson's "expand Vertical alignment" step reads it); `CollapsibleSection` reports
 * to it on every change and on mount and unmount. Without a provider nothing is reported and every
 * section behaves as before.
 */
export type SectionOpenReporter = (label: string, open: boolean) => void
export const SectionOpenReporterContext = createContext<SectionOpenReporter | null>(null)
