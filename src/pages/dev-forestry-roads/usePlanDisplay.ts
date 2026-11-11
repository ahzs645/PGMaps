import { useState } from 'react'

export type FitRequest = { revision: number; target: 'roads' | 'active' | 'terrain' }

/** The map controls and any configured ribbon commands edit the same display state. */
export function usePlanDisplay() {
  const [showContours, setShowContours] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showEarthwork, setShowEarthwork] = useState(true)
  const [notesOpen, setNotesOpen] = useState(false)
  const [fitRequest, setFitRequest] = useState<FitRequest>({ revision: 0, target: 'roads' })
  const fit = (target: FitRequest['target']) =>
    setFitRequest((previous) => ({ revision: previous.revision + 1, target }))
  return {
    showContours,
    setShowContours,
    showLabels,
    setShowLabels,
    showEarthwork,
    setShowEarthwork,
    notesOpen,
    setNotesOpen,
    fitRequest,
    fit,
  }
}
