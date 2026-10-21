import type { InventoryPanel } from './portalInventory'
import type { PortalAdministrationView } from '../PortalAdministration'

export type PortalCapabilitySupport = 'local' | 'connected' | 'partial' | 'original'
export type PortalCapability = {
  id: string
  name: string
  group: string
  description: string
  sourcePath: string
  support: PortalCapabilitySupport
  panel?: InventoryPanel
  mapPane?: 'tools' | 'layers'
  administrationView?: PortalAdministrationView
}

export const PORTAL_SUPPORT_LABELS: Record<PortalCapabilitySupport, string> = {
  local: 'In PGMaps',
  connected: 'Source connection',
  partial: 'Partial support',
  original: 'Original portal',
}

// Build 6268M: public interface and client-definition audit, 2026-10-21.
// A source-menu entry is never evidence that its workflow is implemented here.
export const PORTAL_CAPABILITIES: readonly PortalCapability[] = [
  {
    id: 'research',
    name: 'Research records and citations',
    group: 'Read and explore',
    support: 'local',
    sourcePath: 'Search → research / literature',
    description:
      'Search the bundled research catalogue, including records without location tags; retain its own research IDs.',
    panel: 'inventory',
  },
  {
    id: 'search',
    name: 'Submission search and geographic selection',
    group: 'Read and explore',
    support: 'partial',
    sourcePath: 'Search → Normal / By Extent / By Area',
    description:
      'Search captured public submissions, use the visual expression builder, and intersect results with a permitted source extent or polygon search. Open live submissions for additional account-visible records.',
    panel: 'search',
  },
  {
    id: 'live-search',
    name: 'Live portal submissions',
    group: 'Read and explore',
    support: 'connected',
    sourcePath: 'Search → results → Submission Viewer',
    description:
      'Search the original service with its current permissions and open native records, independent attachments, children, history and monitoring links.',
    panel: 'submissions',
  },
  {
    id: 'expressions',
    name: 'Expression Builder and saved queries',
    group: 'Read and explore',
    support: 'partial',
    sourcePath: 'Search → Expression Builder / Simple Expression Builder',
    description:
      'Build nested AND/OR conditions and field comparisons. Queries saved in this browser are separate from the original portal’s shared query presets.',
    panel: 'search',
  },
  {
    id: 'browse',
    name: 'Browse submissions by form',
    group: 'Read and explore',
    support: 'local',
    sourcePath: 'Search → Switch to Submission Browser',
    description: 'Browse the captured public submissions by source form, then open the same source-ID record reader.',
    panel: 'search',
  },
  {
    id: 'details',
    name: 'Submission details, children and history',
    group: 'Read and explore',
    support: 'connected',
    sourcePath:
      'Search → submission → General / Preview / Spatial Data / Attachments / Allowed Users / Child Submissions / History',
    description:
      'Open source-defined forms and related resources. Resource denials stay separate from successful empty lists.',
    panel: 'submissions',
  },
  {
    id: 'learning',
    name: 'Stories and learning modules',
    group: 'Read and explore',
    support: 'local',
    sourcePath: 'Links → Learning Module',
    description:
      'Read the public watershed learning adaptation, imported story text and supported PGMaps story packages.',
    panel: 'stories',
  },
  {
    id: 'community',
    name: 'Community projects and saved maps',
    group: 'Read and explore',
    support: 'partial',
    sourcePath: 'Map Tools → Project / project-form submissions',
    description:
      'Browse nine captured public saved maps, original descriptions and retained source definitions; load supported map layers with explicit conversion warnings.',
    panel: 'collections',
  },
  {
    id: 'timeline',
    name: 'Map and publication timeline',
    group: 'Read and explore',
    support: 'local',
    sourcePath: 'Links → research map',
    description: 'Explore research by location, resource type and decade.',
    panel: 'research-map',
  },
  {
    id: 'catalogue',
    name: 'Add a WMS map layer',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Add Layer → WMS Service',
    description: 'Choose a service, advertised layer and style, then add it to the persistent map.',
    mapPane: 'tools',
  },
  {
    id: 'schema-layers',
    name: 'Schema layers and station relationships',
    group: 'Map tools',
    support: 'partial',
    sourcePath: 'Map Tools → Add Layer → Portal Schema',
    description:
      'Inspect schemas, fields and linked monitor associations. Adding arbitrary schema sources to the map remains in the original portal.',
    administrationView: 'schemas',
  },
  {
    id: 'submission-layers',
    name: 'Submission spatial layers',
    group: 'Map tools',
    support: 'partial',
    sourcePath: 'Map Tools → Add Layer → Portal Submission',
    description:
      'Inspect permitted submission layers and source Attributes records. The original portal owns arbitrary native layer creation and temporary mapfiles.',
    panel: 'submissions',
  },
  {
    id: 'shared-layers',
    name: 'Shared layer catalogue and review',
    group: 'Map tools',
    support: 'partial',
    sourcePath: 'Map Tools → Add Layer → Shared Layer / Admin Panel → Shared Layer Manager',
    description:
      'Inspect the source review queue and layer state with an administrator connection. Native Add To Map and shared-style publication remain source workflows.',
    administrationView: 'moderation',
  },
  {
    id: 'draw',
    name: 'Draw and inspect vectors',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Draw Vectors / Add Layer → Drawable Layer',
    description: 'Draw points, lines and polygons; select features, inspect attributes, edit GeoJSON and measure.',
    mapPane: 'tools',
  },
  {
    id: 'identify',
    name: 'Identify map features',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Identify Results',
    description: 'Inspect queryable WMS features and local vector attributes with the current map selection.',
    mapPane: 'layers',
  },
  {
    id: 'layer-controls',
    name: 'Layer visibility, order, names and basemaps',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map → layer context menu',
    description:
      'Change visibility and opacity, reorder or rename layers, select a basemap and fit layer bounds without changing source IDs.',
    mapPane: 'layers',
  },
  {
    id: 'styles',
    name: 'Single and categorized vector styling',
    group: 'Map tools',
    support: 'partial',
    sourcePath: 'Map → Stylize → Single / Categorized',
    description:
      'Style local vectors and attribute categories, or select server-advertised WMS styles. Full native symbolizer and gradient rules remain partial.',
    mapPane: 'tools',
  },
  {
    id: 'sld',
    name: 'SLD references and source style library',
    group: 'Map tools',
    support: 'partial',
    sourcePath: 'Map → Stylize → Load / Upload / Download SLD / Save SLD to Portal',
    description:
      'Apply an existing HTTPS SLD reference to a WMS layer. Source SLD upload, editing, saving, sharing and gallery management remain in the original.',
    mapPane: 'layers',
  },
  {
    id: 'buffer',
    name: 'Buffer',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Buffer',
    description: 'Create a bounded distance buffer in metres. Outputs remain local, with undo and export.',
    mapPane: 'tools',
  },
  {
    id: 'clip',
    name: 'Clip',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Clip',
    description:
      'Clip supported points, lines or polygons to a polygon boundary. Outputs remain local, with undo and export.',
    mapPane: 'tools',
  },
  {
    id: 'difference',
    name: 'Difference',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Difference',
    description: 'Subtract a polygon feature from another polygon. Outputs remain local, with undo and export.',
    mapPane: 'tools',
  },
  {
    id: 'split',
    name: 'Split lines or polygons',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Split',
    description:
      'Split a line or a topology-noded polygon using supported cutters. Outputs remain local, with undo and export.',
    mapPane: 'tools',
  },
  {
    id: 'intersection',
    name: 'Intersection',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Intersection',
    description: 'Keep the overlap of two polygon features. Outputs remain local, with undo and export.',
    mapPane: 'tools',
  },
  {
    id: 'union',
    name: 'Union',
    group: 'Map tools',
    support: 'local',
    sourcePath: 'Map Tools → Union',
    description: 'Combine two polygon features into a local output. Outputs remain local, with undo and export.',
    mapPane: 'tools',
  },
  {
    id: 'query',
    name: 'Native layer definition query',
    group: 'Map tools',
    support: 'original',
    sourcePath: 'Map → layer context menu → Query',
    description:
      'The source has attribute/value selection and a SQL-backed query. PGMaps does not submit arbitrary SQL or invent an equivalent source filter.',
  },
  {
    id: 'layer-share',
    name: 'Submit a layer for shared use',
    group: 'Map tools',
    support: 'original',
    sourcePath: 'Map → layer context menu → Share',
    description: 'Send a layer and reason for moderator consideration in the original portal.',
  },
  {
    id: 'spatial-import',
    name: 'Import spatial files',
    group: 'Files and submissions',
    support: 'partial',
    sourcePath: 'Map Tools → Add Layer → Upload File',
    description:
      'Read GeoJSON locally; an optional GDAL converter handles Shapefile, GeoPackage, SQLite, GML, GPX and KML/KMZ.',
    panel: 'files',
  },
  {
    id: 'media',
    name: 'Preview documents and media',
    group: 'Files and submissions',
    support: 'local',
    sourcePath: 'Submission → Attachments',
    description: 'Preview local images, PDFs, audio and video; retain the original download for unsupported formats.',
    panel: 'files',
  },
  {
    id: 'collection-import',
    name: 'Import project, submission and story JSON',
    group: 'Files and submissions',
    support: 'local',
    sourcePath: 'Project / submission export',
    description: 'Keep exported content in a browser collection, preserving original files, source types and IDs.',
    panel: 'collections',
  },
  {
    id: 'form-preview',
    name: 'Inspect forms without creating a draft',
    group: 'Files and submissions',
    support: 'connected',
    sourcePath: 'Admin Panel → Form Manager → View / Preview',
    description:
      'Read the source form definition, fields and linked schemas without opening the source New Submission action.',
    administrationView: 'forms',
  },
  {
    id: 'new-submission',
    name: 'Start a new submission',
    group: 'Files and submissions',
    support: 'original',
    sourcePath: 'Fill a Form → Start New Submission',
    description:
      'Select the original form and complete its submission workflow. Opening a new form immediately creates a source draft.',
  },
  {
    id: 'resume-submission',
    name: 'Resume or edit a draft submission',
    group: 'Files and submissions',
    support: 'original',
    sourcePath: 'Fill a Form → Resume a Draft Submission',
    description:
      'Resume a source draft, review parent links, attachments, spatial data, monitoring and permissions, then hold or submit it.',
  },
  {
    id: 'bulk-csv',
    name: 'Bulk CSV upload and field matching',
    group: 'Files and submissions',
    support: 'partial',
    sourcePath: 'Fill a Form → Open Bulk-Loader',
    description:
      'Map CSV columns to form fields, validate and export local drafts. Explicit source draft creation requires the development gateway; the hosted connection is read-only.',
    panel: 'files',
  },
  {
    id: 'zotero',
    name: 'Review Zotero and bibliographic CSV',
    group: 'Files and submissions',
    support: 'local',
    sourcePath: 'Fill a Form → Bulk-Loader → Zotero match preset',
    description: 'Retain all columns, map title/DOI and review repeated identifiers before publication.',
    panel: 'files',
  },
  {
    id: 'schema-upload',
    name: 'Schema-matched spatial upload',
    group: 'Files and submissions',
    support: 'partial',
    sourcePath: 'Submission → Spatial Data → Upload and Match to Schema',
    description:
      'Review spatial/schema mappings and local files. Source ingestion, key matching and publication require the original workflow.',
    panel: 'files',
  },
  {
    id: 'gpap',
    name: 'GeoPaparazzi notes, tracks and media',
    group: 'Files and submissions',
    support: 'partial',
    sourcePath: 'Fill a Form → Open GeoPaparazzi Loader',
    description:
      'PGMaps inventories the GPAP database. Match Forms, Match Fields, record selection, media ingestion and duplicate protection remain in the original.',
    panel: 'files',
  },
  {
    id: 'submission-workflow',
    name: 'Submission publication and parent permissions',
    group: 'Files and submissions',
    support: 'original',
    sourcePath: 'Submission → Parent / Permissions / Hold as Draft / Submit Form',
    description:
      'Use the original workflow for parent links, copy-parent permissions, status, assignee, publication and deletion.',
  },
  {
    id: 'monitor-local',
    name: 'Monitoring charts, tables and CSV',
    group: 'Monitoring and reports',
    support: 'local',
    sourcePath: 'Monitoring node → View → table / charts',
    description:
      'Match station, timestamp, value and units; inspect quality, filter, chart and export local observations.',
    panel: 'monitoring',
  },
  {
    id: 'monitor-linked',
    name: 'Station and schema-linked monitoring',
    group: 'Monitoring and reports',
    support: 'connected',
    sourcePath: 'Schema Manager → Monitors / submission → Monitoring',
    description:
      'Follow verified schema, station and submission IDs; page source observations and transfer a loaded page to charts or CSV.',
    panel: 'monitoring',
  },
  {
    id: 'monitor-full',
    name: 'Download all source monitoring records',
    group: 'Monitoring and reports',
    support: 'original',
    sourcePath: 'Schema Manager → Monitors → View Data → Download CSV (All Records)',
    description:
      'PGMaps exports each loaded source page. Use the original for a full-table export; page counts are not complete database sizes.',
  },
  {
    id: 'reports',
    name: 'Form statistics and report presets',
    group: 'Monitoring and reports',
    support: 'connected',
    sourcePath: 'Reports → For Form / Form Element / User Label / Generate',
    description:
      'Choose source form fields and labels, generate statistics, save local presets and export CSV, HTML, PDF or ZIP.',
    panel: 'reports',
  },
  {
    id: 'report-share',
    name: 'Shared reporting and matching presets',
    group: 'Monitoring and reports',
    support: 'original',
    sourcePath: 'Reports → Load Preset / Save Preset → Share Preset',
    description:
      'The source manages account and group access to saved matching and report presets; browser presets remain separate.',
  },
  {
    id: 'workspace',
    name: 'Save, restore and export this workspace',
    group: 'Projects and exports',
    support: 'local',
    sourcePath: 'Map Tools → Project → New / Save / Save As',
    description:
      'Save and restore browser workspaces or download JSON containing map camera, sources and local vectors.',
    panel: 'projects',
  },
  {
    id: 'source-projects',
    name: 'Server-saved projects, history and defaults',
    group: 'Projects and exports',
    support: 'connected',
    sourcePath: 'Map Tools → Project → Load / Load Default / History',
    description:
      'Read permitted source maps, history, owners, shares and defaults, then load supported data into the persistent map.',
    panel: 'saved-projects',
  },
  {
    id: 'project-writes',
    name: 'Source project save, rename, sharing and defaults',
    group: 'Projects and exports',
    support: 'partial',
    sourcePath: 'Map Tools → Project → Save / Rename / Share / Set As Default / Unset Default',
    description:
      'Existing reviewed adapters require the development gateway. Hosted source writes remain disabled; browser workspace save stays available.',
    panel: 'saved-projects',
  },
  {
    id: 'project-description',
    name: 'Edit source project description',
    group: 'Projects and exports',
    support: 'original',
    sourcePath: 'Map Tools → Project → Edit Project Description',
    description: 'The original editor owns project descriptions and their source permissions.',
  },
  {
    id: 'project-delete',
    name: 'Delete a source project',
    group: 'Projects and exports',
    support: 'original',
    sourcePath: 'Map Tools → Project → Delete',
    description: 'Project deletion remains in the original owner-authorized workflow.',
  },
  {
    id: 'project-gis',
    name: 'Original project spatial downloads and SMASH',
    group: 'Projects and exports',
    support: 'original',
    sourcePath: 'Map Tools → Project → Download Project Files',
    description:
      'Generate original GIS project files in the selected format, with the source SMASH option. A workspace JSON export is a different artifact.',
  },
  {
    id: 'vector-download',
    name: 'Download local vector layers',
    group: 'Projects and exports',
    support: 'partial',
    sourcePath: 'Map Tools → Download',
    description:
      'Export local GeoJSON or attributes CSV; optional GDAL conversion provides supported spatial formats. WMS imagery does not supply source vector geometry.',
    mapPane: 'tools',
  },
  {
    id: 'map-export',
    name: 'Map image composition',
    group: 'Projects and exports',
    support: 'local',
    sourcePath: 'Map Tools → Export',
    description:
      'Compose PNG with a title, dimensions, north arrow, scale bar, legend and attribution. Preview the result before downloading.',
    panel: 'map-export',
  },
  {
    id: 'submission-download',
    name: 'Submission PDF, HTML, CSV and file ZIP',
    group: 'Projects and exports',
    support: 'connected',
    sourcePath: 'Search → submission → Export',
    description:
      'Download original permitted submission exports through the connection; captured public archives remain a separate available option.',
    panel: 'submissions',
  },
  {
    id: 'users',
    name: 'Users and permission inspection',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'Admin Panel → User Manager',
    description:
      'Browse source users and inspect existing form, submission, matching-preset, style and project permissions with an administrator connection.',
    administrationView: 'permissions',
  },
  {
    id: 'permission-writes',
    name: 'Review changes to existing user permissions',
    group: 'Administration',
    support: 'partial',
    sourcePath: 'User Manager → Edit User → Permissions',
    description:
      'Stage and review changes using the existing development-gateway adapter. Hosted access remains read-only.',
    administrationView: 'permissions',
  },
  {
    id: 'identity',
    name: 'Create, edit, activate or remove accounts',
    group: 'Administration',
    support: 'original',
    sourcePath: 'User Manager → Add User / Edit User / Delete User',
    description:
      'Identity changes, account activation, primary group, submission/task settings, BOSS permission and account email stay in the original portal.',
  },
  {
    id: 'impersonate',
    name: 'Use portal as another user',
    group: 'Administration',
    support: 'original',
    sourcePath: 'User Manager → Use Portal As User',
    description: 'The source’s administrator impersonation workflow is not exposed through the PGMaps connection.',
  },
  {
    id: 'groups',
    name: 'Group membership',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'Admin Panel → Group Manager',
    description:
      'Inspect groups, members and primary-group status. Existing membership changes require the development gateway and explicit review.',
    administrationView: 'groups',
  },
  {
    id: 'group-create',
    name: 'Create, rename or remove a group',
    group: 'Administration',
    support: 'original',
    sourcePath: 'Group Manager → Add Group / Edit Group / Remove Group',
    description: 'Group lifecycle changes stay with the original administrator workflow.',
  },
  {
    id: 'forms',
    name: 'Forms, fields and visibility',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'Admin Panel → Form Manager → View',
    description:
      'Inspect form fields, safe previews, linked schemas, group visibility and permitted users without creating a submission.',
    administrationView: 'forms',
  },
  {
    id: 'form-edit',
    name: 'Create, copy or edit form definitions',
    group: 'Administration',
    support: 'original',
    sourcePath: 'Form Manager → Create Form / Copy Form / Available Elements / Email Templates',
    description:
      'Source form design, element settings, visibility writes, email-template assignment and form removal remain original workflows.',
  },
  {
    id: 'schemas',
    name: 'Schemas, field types and monitor links',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'Admin Panel → Schema Manager → Details / Monitors',
    description:
      'Inspect Spatial or Monitor schemas, geometry, field types, Linked To relationships and source monitoring associations.',
    administrationView: 'schemas',
  },
  {
    id: 'schema-edit',
    name: 'Create, copy or edit schemas and defaults',
    group: 'Administration',
    support: 'original',
    sourcePath: 'Schema Manager → New / Copy / Delete / Add Field / Default Style',
    description:
      'Source schema structure and default SLD writes remain in the original, preserving existing data relationships.',
  },
  {
    id: 'submission-manager',
    name: 'Submission Manager',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'Admin Panel → Submission Manager',
    description:
      'Browse original submission IDs, titles, names and states; filter and page the loaded catalogue, then open native record details.',
    administrationView: 'submissions',
  },
  {
    id: 'submission-admin',
    name: 'Edit submission access and assignments',
    group: 'Administration',
    support: 'original',
    sourcePath: 'Submission Manager → Edit Submission / Permissions / Match Permissions',
    description: 'Source record edits, assignment, matched permissions and deletion remain in the original workflow.',
  },
  {
    id: 'moderation',
    name: 'Shared-layer moderation',
    group: 'Administration',
    support: 'partial',
    sourcePath: 'Admin Panel → Shared Layer Manager → Grant / Toggle Active',
    description:
      'Inspect the source queue. Existing grant and active-state review adapters require the development gateway; the hosted bridge cannot apply them.',
    administrationView: 'moderation',
  },
  {
    id: 'retract',
    name: 'Retract shared layers or change default SLD',
    group: 'Administration',
    support: 'original',
    sourcePath: 'Shared Layer Manager → Retract / Default Style',
    description:
      'Retraction and default-style editing, copying or uploading remain in the source administrator workflow.',
  },
  {
    id: 'registry',
    name: 'System spatial source registry',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'Admin Panel → System Manager → Spatial Layers',
    description:
      'Inspect source type, URL, layer names, attribution, Auto-Add, Auto-On and Base flags. Registry edits stay with the source.',
    administrationView: 'system',
  },
  {
    id: 'statuses',
    name: 'Status flags and task priorities',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'System Manager → Status Flags / Task Statuses / Priorities',
    description:
      'Read configured status descriptions, colours, ranks and scheduling priorities, retaining unknown fields.',
    administrationView: 'system',
  },
  {
    id: 'holidays',
    name: 'Holidays and nonbusiness days',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'System Manager → Holidays',
    description: 'Inspect configured holiday records; date and scheduling changes remain in the original.',
    administrationView: 'system',
  },
  {
    id: 'content',
    name: 'Informational content and menu documents',
    group: 'Administration',
    support: 'connected',
    sourcePath: 'System Manager → Content Editor',
    description:
      'Read existing welcome/help documents as safe text. The existing reviewed edit adapter requires the development gateway.',
    administrationView: 'help',
  },
  {
    id: 'server-settings',
    name: 'Server variables and system configuration',
    group: 'Administration',
    support: 'original',
    sourcePath: 'System Manager → Server Variables / content / registry writes',
    description:
      'Server configuration, registration, email settings, content creation/deletion and registry publication remain original administrator responsibilities.',
  },
  {
    id: 'boss',
    name: 'BOSS processing, outputs and queue',
    group: 'Administration',
    support: 'original',
    sourcePath: 'Map Tools → BOSS / Add Layer → BOSS Output Layer',
    description:
      'Input/overlay processing, output layers, report and CSV exports, and queue management are present in the source. Execution and costs have not been validated for PGMaps.',
  },
  {
    id: 'connection',
    name: 'Sign in and disconnect',
    group: 'Account and workflow',
    support: 'connected',
    sourcePath: 'Login / Logout',
    description:
      'Connect using an original portal account for its permitted records; temporary connection state clears on disconnect.',
    panel: 'account',
  },
  {
    id: 'signup',
    name: 'Account sign-up and password changes',
    group: 'Account and workflow',
    support: 'original',
    sourcePath: 'Sign-Up / Dashboard → Change your password',
    description: 'Register or change credentials in the original portal.',
  },
  {
    id: 'dashboard',
    name: 'Dashboard calendar and daily tasks',
    group: 'Account and workflow',
    support: 'connected',
    sourcePath: 'Dashboard → Schedule',
    description:
      'Read the selected month’s marked dates and the selected day’s task details without creating or changing tasks.',
    administrationView: 'dashboard',
  },
  {
    id: 'notifications',
    name: 'Task notifications and approaching deadlines',
    group: 'Account and workflow',
    support: 'connected',
    sourcePath: 'Dashboard → Notifications',
    description: 'Inspect new-task and approaching-deadline lists supplied by the source for the current account.',
    administrationView: 'dashboard',
  },
  {
    id: 'schedule-writes',
    name: 'Scheduling, email notifications and problem reports',
    group: 'Account and workflow',
    support: 'original',
    sourcePath: 'Submission → Scheduling / Email Notification; Dashboard → Submit a problem report',
    description:
      'Create or alter source tasks, send source notifications, and submit problem reports in the original portal.',
  },
  {
    id: 'payments',
    name: 'Payment form elements',
    group: 'Account and workflow',
    support: 'original',
    sourcePath: 'Form Manager → Payment element',
    description:
      'The source includes payment elements; active use, transaction behavior and a PGMaps payment integration have not been established.',
  },
]
