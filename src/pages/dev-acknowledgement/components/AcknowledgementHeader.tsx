import type { FormEvent } from 'react'
import { Check, ChevronRight, Copy, MapPin, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { GeocodeStatus } from '../types'

type AcknowledgementHeaderProps = {
  address: string
  onAddressChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  geocodeStatus: GeocodeStatus
  geocodeError: string | null
  copied: boolean
  onCopy: () => void
}

export function AcknowledgementHeader({
  address,
  onAddressChange,
  onSubmit,
  geocodeStatus,
  geocodeError,
  copied,
  onCopy,
}: AcknowledgementHeaderProps) {
  return (
    <div className="border-b bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Acknowledgement Builder</h1>
          </div>
          <Button variant="outline" onClick={onCopy} className="w-full sm:w-auto">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy wording'}
          </Button>
        </div>

        <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <label className="flex min-h-12 items-center gap-3 rounded-lg border bg-white px-3 shadow-sm">
            <MapPin className="h-5 w-5 flex-none text-teal-700" />
            <input
              value={address}
              onChange={(event) => onAddressChange(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
              aria-label="Address"
            />
          </label>
          <Button type="submit" variant="outline" className="min-h-12 justify-center" disabled={geocodeStatus === 'loading'}>
            <Search className="h-4 w-4 lg:hidden" />
            <span>{geocodeStatus === 'loading' ? 'Geocoding address' : 'Run source comparison'}</span>
            <ChevronRight className="hidden h-4 w-4 lg:block" />
          </Button>
        </form>
        {geocodeStatus === 'error' && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {geocodeError}
          </div>
        )}
      </div>
    </div>
  )
}
