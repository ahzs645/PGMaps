import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { insetBox } from '@/components/ui/inset-box'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { ReferenceHeading, referenceMoney } from './CostReferenceControls'
import {
  COAST_ALLOWANCE_SCOPES,
  COAST_CULVERT_ROWS,
  INTERIOR_ALLOWANCE_SCOPES,
  INTERIOR_APPRAISAL_FUEL,
  INTERIOR_CULVERT_ROWS,
  INTERIOR_EQUIPMENT_RATES,
  INTERIOR_LABOUR_RATES,
  type AllowanceScope,
} from './appraisalScope'

const tableClass = '[&_td]:bg-background [&_th]:bg-background'
const rate = (value: number) => '$' + value.toFixed(2)

function ScopeColumn({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-2xs font-medium text-foreground">{title}</p>
      {items.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-2xs leading-4 text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-2xs italic leading-4 text-muted-foreground">None listed</p>
      )}
    </div>
  )
}

/** One allowance as a folded row: its name, unit and manual section show; its three lists open. */
function ScopeRow({ scope }: { scope: AllowanceScope }) {
  return (
    <CollapsibleSection
      label={<span>{scope.title}</span>}
      summary={`${scope.unit} · ${scope.locator}`}
      className="bg-transparent"
      contentClassName="px-3 pb-3"
      toggleProps={{ 'data-testid': `road-allowance-scope-toggle-${scope.id}` }}
    >
      <div className="space-y-1.5" data-testid={`road-allowance-scope-${scope.id}`}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ScopeColumn title="Covers" items={scope.covers} />
          <ScopeColumn title="Leaves out" items={scope.excludes} />
          <ScopeColumn title="Priced separately" items={scope.separate} />
        </div>
        {scope.note && <p className="text-2xs leading-4 text-muted-foreground">{scope.note}</p>}
      </div>
    </CollapsibleSection>
  )
}

/**
 * What the selected method's allowances cover, leave out and price elsewhere, with the published
 * drainage and equipment tables that the road comparison does not include.
 */
export function AppraisalScopePanel({ method }: { method: 'interior' | 'coast' }) {
  const interior = method === 'interior'
  return (
    <section className="space-y-2" aria-label="What each allowance covers">
      <ReferenceHeading info="An activity an allowance covers must not be priced again beside it. An activity it leaves out is not free: it needs its own rate or estimate. Both manuals are effective 2026 on a 2024 cost base.">
        What each allowance covers
      </ReferenceHeading>
      <div className={cn(insetBox({ padding: 'none', hoverRows: true }), 'overflow-hidden')}>
        {(interior ? INTERIOR_ALLOWANCE_SCOPES : COAST_ALLOWANCE_SCOPES).map((scope) => (
          <ScopeRow key={scope.id} scope={scope} />
        ))}
        <CollapsibleSection
          label={<span>Culvert allowances</span>}
          summary={interior ? 'IAM Table 4-3, selected diameters' : 'CAM Table 5-4, selected diameters'}
          className="bg-transparent last:border-b-0"
          contentClassName="space-y-1.5 px-3 pb-3"
          toggleProps={{ 'data-testid': 'road-appraisal-culverts-toggle' }}
        >
          {interior ? (
            <div className="overflow-x-auto">
              <EngineeringTable rowHeaders compact className={tableClass} data-testid="road-appraisal-culverts">
                <thead>
                  <tr>
                    <ColumnHeader label="Diameter" unit="m" />
                    <ColumnHeader label="Part A, installed 12 m culvert" unit="CAD" />
                    <ColumnHeader label="Part B, supply and delivery" unit="CAD/m" />
                    <ColumnHeader label="In tabular subgrade" className="text-left" />
                  </tr>
                </thead>
                <tbody>
                  {INTERIOR_CULVERT_ROWS.map((row) => (
                    <tr key={row.diameterM}>
                      <td>{row.diameterM.toFixed(2)}</td>
                      <td>{referenceMoney(row.installed12mCad)}</td>
                      <td>{referenceMoney(row.supplyPerMCad)}</td>
                      <td className="text-left">{row.inSubgrade ? 'Yes, already covered' : 'No, add Part A'}</td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <EngineeringTable rowHeaders compact className={tableClass} data-testid="road-appraisal-culverts">
                <thead>
                  <tr>
                    <ColumnHeader label="Diameter" unit="m" />
                    <ColumnHeader label="Column A, materials and installation" unit="CAD/m" />
                    <ColumnHeader label="Column B, materials only" unit="CAD/m" />
                  </tr>
                </thead>
                <tbody>
                  {COAST_CULVERT_ROWS.map((row) => (
                    <tr key={row.diameterM}>
                      <td>{row.diameterM.toFixed(2)}</td>
                      <td>{referenceMoney(row.installedPerMCad)}</td>
                      <td>{referenceMoney(row.materialsPerMCad)}</td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            </div>
          )}
          <p className="text-2xs leading-4 text-muted-foreground">
            {interior
              ? 'Part A changes with length (9 m to 20 m in the table); 12 m is shown. Use Part A or Part B, never both. The table is not interpolated.'
              : 'Coast tabular road costs leave culverts out, so the chosen column is added. Use Column A or Column B, never both.'}
          </p>
        </CollapsibleSection>
        {interior && (
          <CollapsibleSection
            label={<span>Equipment and labour rates</span>}
            summary="IAM Appendix I, selected rows"
            className="bg-transparent last:border-b-0"
            contentClassName="space-y-1.5 px-3 pb-3"
            toggleProps={{ 'data-testid': 'road-appraisal-equipment-toggle' }}
          >
            <div className="overflow-x-auto">
              <EngineeringTable rowHeaders compact className={tableClass}>
                <thead>
                  <tr>
                    <ColumnHeader label="Equipment, operator included" className="text-left" />
                    <ColumnHeader label="Rate" unit="CAD/hour" />
                    <ColumnHeader label="Appraisal fuel allowance" unit="CAD/hour" />
                  </tr>
                </thead>
                <tbody>
                  {INTERIOR_EQUIPMENT_RATES.map((row) => (
                    <tr key={row.item}>
                      <th scope="row">{row.item}</th>
                      <td>{rate(row.ratePerHour)}</td>
                      <td>
                        {rate(
                          row.fuel === 'on-road'
                            ? INTERIOR_APPRAISAL_FUEL.onRoadPerHour
                            : INTERIOR_APPRAISAL_FUEL.offRoadPerHour,
                        )}{' '}
                        {row.fuel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            </div>
            <div className="overflow-x-auto">
              <EngineeringTable rowHeaders compact className={tableClass}>
                <thead>
                  <tr>
                    <ColumnHeader label="Labour, 50% payroll loading included" className="text-left" />
                    <ColumnHeader label="Rate" unit="CAD/hour" />
                  </tr>
                </thead>
                <tbody>
                  {INTERIOR_LABOUR_RATES.map((row) => (
                    <tr key={row.role}>
                      <th scope="row">{row.role}</th>
                      <td>{rate(row.ratePerHour)}</td>
                    </tr>
                  ))}
                </tbody>
              </EngineeringTable>
            </div>
            <p className="text-2xs leading-4 text-muted-foreground">
              2024–2025 Blue Book basis; wages effective 15 June 2024. Equipment rates already carry the operator, so a
              wage is not added to them. These are appraisal rates, not a contractor&apos;s current quote.
            </p>
          </CollapsibleSection>
        )}
      </div>
    </section>
  )
}
