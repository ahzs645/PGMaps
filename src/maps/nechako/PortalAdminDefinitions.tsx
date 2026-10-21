import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { errorText } from '@/lib/nechakoPortal'
import { AdminDataTable, AdminOriginal, AdminReadResource } from './PortalAdminResource'
import { CheckState, useReadCheck } from './PortalChecks'
import { PortalSourceSubmissionDialog } from './PortalSourceSubmissionDialog'
import { adminId, adminRows, type AdminRow } from './data/adminInspection'
import { parseReviewForm, reviewObject } from './data/submissionReview'

const linkedSchemas = (input: unknown) => adminRows(input).map((row, index) => ({ ...row, source_order: index + 1 }))
const visibleGroups = (input: unknown) => {
  if (!reviewObject(input)) throw new Error('Expected the source visible and not-visible group lists.')
  return [
    ...adminRows(input.visible).map((row) => ({ ...row, visibility: 'Visible' })),
    ...adminRows(input.not).map((row) => ({ ...row, visibility: 'Not visible' })),
  ]
}
const formUsers = (input: unknown) => {
  if (!reviewObject(input)) throw new Error('Expected the source allowed and disallowed user lists.')
  return [
    ...adminRows(input.allowed).map((row) => ({ ...row, access: 'Allowed' })),
    ...adminRows(input.disallowed).map((row) => ({ ...row, access: 'Disallowed' })),
  ]
}

function FormDefinition({ id }: { id: string }) {
  const read = useReadCheck(),
    run = read.run
  useEffect(() => {
    void run('rest/portal/getForm.php', { id })
  }, [id, run])
  const parsed = useMemo(() => {
    if (read.data === undefined) return undefined
    try {
      return { form: parseReviewForm(read.data) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [read.data])
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <h3 className="font-semibold">Form definition · {id}</h3>
      <p className="text-sm text-muted-foreground">
        Inspecting this definition does not start a submission or allocate a draft.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={read.loading}
        onClick={() => void run('rest/portal/getForm.php', { id })}
      >
        Refresh form definition
      </Button>
      <CheckState {...read} showData={false} />
      {parsed?.error && <InlineAlert tone="error">{parsed.error}</InlineAlert>}
      {parsed?.form && (
        <>
          <h4 className="font-medium">{parsed.form.title}</h4>
          <AdminDataTable
            title="Form content fields"
            rows={parsed.form.fields.map((field) => ({
              ...field,
              required: reviewObject(field.source) ? field.source.required : undefined,
            }))}
            columns={[
              { key: 'id', label: 'Field ID' },
              { key: 'label', label: 'Label' },
              { key: 'type', label: 'Type' },
              { key: 'required', label: 'Required', boolean: true },
            ]}
          />
          <h4 className="font-medium">Other form elements</h4>
          {parsed.form.staticNodes.length ? (
            <ul className="list-inside list-disc text-sm">
              {parsed.form.staticNodes.map((node, index) => (
                <li key={index}>{node}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No static elements were returned.</p>
          )}
        </>
      )}
      {read.data !== undefined && <AdminOriginal title={`Form ${id} definition`} data={read.data} />}
    </section>
  )
}

function SchemaInspection({ id, name, isMonitor = false }: { id: string; name: string; isMonitor?: boolean }) {
  const [submission, setSubmission] = useState('')
  return (
    <section className="space-y-3" aria-label={`Schema ${id} inspection`}>
      <h3 className="text-lg font-semibold">
        {name} · schema {id}
      </h3>
      <AdminReadResource
        title="Schema fields and links"
        path="rest/portal/getSchemaFields.php"
        params={{ schemaId: id }}
        autoLoad
        columns={[
          { key: 'attr_id', label: 'Field ID' },
          { key: 'attr_name', label: 'Field name' },
          { key: 'attr_type', label: 'Native type' },
          { key: 'linked_to_name', label: 'Linked to' },
          { key: 'link_type', label: 'Link type' },
        ]}
      />
      {isMonitor && (
        <AdminReadResource
          title="Schema monitoring associations"
          path="rest/portal/getMonitorSchemaLayers.php"
          params={{ schemaId: id, getDraftSubmissions: 'true', getDisabled: 'true' }}
          description="Source relationships include draft and disabled records where your administrator account has access. Observation values load from the selected submission's monitoring tools."
          columns={[
            { key: 'form_submission_id', label: 'Submission ID' },
            { key: 'submission_state', label: 'Submission state' },
            { key: 'layer_id', label: 'Layer ID' },
            { key: 'layer_name', label: 'Layer' },
            { key: 'schema_rec_seq_id', label: 'Station record ID' },
            { key: 'monitor_status', label: 'Monitor status' },
          ]}
          onSelect={(row) => {
            const next = adminId(row.form_submission_id)
            if (next) setSubmission(next)
          }}
          selectLabel={(row) =>
            adminId(row.form_submission_id) ? `Open submission ${row.form_submission_id}` : 'No source submission ID'
          }
        />
      )}
      {submission && (
        <PortalSourceSubmissionDialog
          submissionId={submission}
          onClose={() => setSubmission('')}
          onOpenSubmission={setSubmission}
        />
      )}
    </section>
  )
}

export function PortalAdminForms({ isAdmin }: { isAdmin: boolean }) {
  const [selected, setSelected] = useState<AdminRow>(),
    [schema, setSchema] = useState<AdminRow>()
  const id = adminId(selected?.form_id),
    schemaId = adminId(schema?.id)
  return (
    <div className="space-y-4">
      <AdminReadResource
        title="Forms"
        path="rest/portal/getForms.php"
        description="Browse the source form catalogue, inspect dynamic fields, and follow original schema IDs. Form creation, copying and structural changes remain in the original Form Manager."
        columns={[
          { key: 'form_id', label: 'Form ID' },
          { key: 'form_name', label: 'Form name' },
        ]}
        onSelect={(row) => {
          setSelected(row)
          setSchema(undefined)
        }}
        selectLabel={(row) => `Inspect form ${row.form_id}`}
      />
      {selected && !id && <InlineAlert tone="error">The selected record has no valid source form ID.</InlineAlert>}
      {id && (
        <div key={id} className="space-y-4">
          <FormDefinition id={id} />
          <AdminReadResource
            title="Linked schemas"
            path="rest/portal/getFormsLinkedSchemas.php"
            params={{ formId: id }}
            autoLoad
            parse={linkedSchemas}
            description="Order follows the returned source array; it is not a calculated priority or a new schema rank."
            columns={[
              { key: 'source_order', label: 'Source order' },
              { key: 'id', label: 'Schema ID' },
              { key: 'schema', label: 'Schema' },
            ]}
            onSelect={setSchema}
            selectLabel={(row) => `Inspect linked schema ${row.id}`}
          />
          {schemaId && (
            <SchemaInspection
              key={`${id}:${schemaId}`}
              id={schemaId}
              name={String(schema?.schema ?? `Schema ${schemaId}`)}
            />
          )}
          {isAdmin && (
            <>
              <AdminReadResource
                title="Form group visibility"
                path="rest/portal/getFormVisibleGroups.php"
                params={{ formId: id }}
                parse={visibleGroups}
                columns={[
                  { key: 'gid', label: 'Group ID' },
                  { key: 'gname', label: 'Group' },
                  { key: 'visibility', label: 'Visibility' },
                ]}
              />
              <AdminReadResource
                title="Form user access"
                path="rest/portal/admin/getUserForms.php"
                params={{ form_id: id }}
                parse={formUsers}
                columns={[
                  { key: 'id', label: 'User ID' },
                  { key: 'name', label: 'User' },
                  { key: 'access', label: 'Access' },
                  { key: 'can_edit', label: 'Can edit', boolean: true },
                ]}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function PortalAdminSchemas({ isAdmin }: { isAdmin: boolean }) {
  const [selected, setSelected] = useState<AdminRow>()
  const id = adminId(selected?.attr_table_id)
  return (
    <div className="space-y-4">
      <AdminReadResource
        title="Schemas"
        path="rest/portal/getSchemas.php"
        description="Spatial and Monitor schemas retain their original table IDs, geometry types and field links. Creation, copying, deletion and default-style changes use the original Schema Manager."
        columns={[
          { key: 'attr_table_id', label: 'Schema ID' },
          { key: 'attr_table_name', label: 'Schema' },
          { key: 'schema_type', label: 'Schema type' },
          { key: 'geometry_type', label: 'Geometry type' },
        ]}
        onSelect={setSelected}
        selectLabel={(row) => `Inspect schema ${row.attr_table_id}`}
      />
      {selected && !id && <InlineAlert tone="error">The selected record has no valid source schema ID.</InlineAlert>}
      {id && (
        <SchemaInspection
          key={id}
          id={id}
          name={String(selected?.attr_table_name ?? `Schema ${id}`)}
          isMonitor={isAdmin && selected?.schema_type === 'Monitor'}
        />
      )}
    </div>
  )
}
