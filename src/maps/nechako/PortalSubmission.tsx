import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { NECHAKO_PORTAL, errorText } from '@/lib/nechakoPortal'
import { downloadText } from '@/lib/download'
import { CheckState, useReadCheck } from './PortalChecks'

const SECTIONS = [
  ['Metadata', 'getSubmissionMetadata.php', 'submissionId'],
  ['Spatial layers', 'getSubmissionLayers.php', 'submissionId'],
  ['Linked layers', 'getSubmissionLinkedLayers.php', 'submissionId'],
  ['Attachments', 'getSubmissionAttachments.php', 'submissionId'],
  ['Allowed users', 'getSubmissionPermissions.php', 'submissionId'],
  ['History', 'getHistory.php', 'sub_id'],
  ['Child submissions', 'getChildren.php', 'parentId'],
] as const

function Resource({
  id,
  name,
  endpoint,
  parameter,
}: {
  id: string
  name: string
  endpoint: string
  parameter: string
}) {
  const check = useReadCheck()
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">{name}</summary>
      <div className="mt-3 space-y-3">
        <Button
          variant="outline"
          size="sm"
          disabled={check.loading}
          onClick={() => void check.run(`rest/portal/${endpoint}`, { [parameter]: id })}
        >
          Load {name.toLowerCase()}
        </Button>
        <CheckState {...check} />
        {check.data !== undefined && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(
                JSON.stringify(check.data, null, 2),
                `submission-${id}-${endpoint.replace('.php', '')}.json`,
                'application/json',
              )
            }
          >
            Export returned {name.toLowerCase()}
          </Button>
        )}
      </div>
    </details>
  )
}

export function PortalSubmission({ submissionId }: { submissionId?: string }) {
  const [entered, setEntered] = useState(submissionId || ''),
    [loaded, setLoaded] = useState(submissionId || '')
  const [error, setError] = useState(''),
    [file, setFile] = useState<unknown>()
  useEffect(() => {
    setEntered(submissionId || '')
    setLoaded(submissionId || '')
  }, [submissionId])
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">Submission resources</h3>
      <p className="text-sm text-muted-foreground">
        Load resources for a known portal submission ID. Each section asks the portal independently and respects its
        returned access errors. This connection is anonymous; protected resources, schema-rendered form previews and
        editing use the original portal.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!/^[1-9]\d*$/.test(entered)) {
            setError('Enter a positive numeric portal submission ID.')
            return
          }
          setLoaded(entered)
          setError('')
        }}
      >
        <label className="text-sm">
          Portal submission ID
          <input
            aria-label="Portal submission ID"
            value={entered}
            onChange={(event) => setEntered(event.target.value)}
            className="ml-2 w-36 rounded-md border bg-background p-2"
            inputMode="numeric"
          />
        </label>
        <Button size="sm" type="submit">
          Open submission resources
        </Button>
      </form>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {loaded && (
        <div key={loaded} className="space-y-3">
          {SECTIONS.map(([name, endpoint, parameter]) => (
            <Resource key={endpoint} id={loaded} name={name} endpoint={endpoint} parameter={parameter} />
          ))}
        </div>
      )}
      <a href={NECHAKO_PORTAL} target="_blank" rel="noreferrer" className="inline-block text-sm text-primary underline">
        Open portal for authorized previews, downloads, edits and sharing
      </a>
      <label className="block text-sm">
        Review an exported submission JSON
        <input
          aria-label="Exported submission JSON"
          type="file"
          accept=".json"
          className="mt-1 max-w-full"
          onChange={async (event) => {
            const source = event.target.files?.[0]
            if (!source) return
            try {
              if (source.size > 20 * 1024 * 1024) throw new Error('Submission export exceeds 20 MB.')
              const data = JSON.parse(await source.text())
              if (!data || typeof data !== 'object') throw new Error('Expected a submission JSON object or array.')
              setFile(data)
              setError('')
            } catch (reason) {
              setFile(undefined)
              setError(errorText(reason))
            }
          }}
        />
      </label>
      {file !== undefined && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(file, null, 2)}
        </pre>
      )}
    </div>
  )
}
