import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getProject, updateProject, exportBidPdf,
  uploadDocument, parseDocument, deleteDocument,
  createLineItem, updateLineItem, deleteLineItem,
  createSpec, deleteSpec,
  createConcern, deleteConcern,
  createTakeoff, updateTakeoff, deleteTakeoff,
  EstimateDetail as Detail,
  EstimateLineItem, EstimateSpec, EstimateConcern, EstimateTakeoff, EstimateDocument,
} from '../services/estimatingApi'
import { repriceProject } from '../services/pricesApi'

type Tab = 'documents' | 'takeoffs' | 'specs' | 'line-items' | 'concerns'

const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-red-50 border-red-300 text-red-800',
  medium: 'bg-yellow-50 border-yellow-300 text-yellow-800',
  low: 'bg-green-50 border-green-300 text-green-800',
}
const SPEC_TYPE_COLORS: Record<string, string> = {
  material: 'bg-blue-100 text-blue-700',
  warranty: 'bg-green-100 text-green-700',
  approved_product: 'bg-purple-100 text-purple-700',
  standard: 'bg-gray-100 text-gray-600',
  note: 'bg-orange-100 text-orange-700',
}

export default function EstimateDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Detail | null>(null)
  const [tab, setTab] = useState<Tab>('documents')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [savingProject, setSavingProject] = useState(false)
  const [editProjectOpen, setEditProjectOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    try {
      const data = await getProject(id!)
      setProject(data)
      setEditForm({
        name: data.name, project_address: data.project_address,
        gc_name: data.gc_name, bid_date: data.bid_date?.split('T')[0] || '',
        project_type: data.project_type, status: data.status, notes: data.notes,
      })
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  async function saveProject() {
    setSavingProject(true)
    try {
      await updateProject(id!, editForm)
      setEditProjectOpen(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setSavingProject(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try { exportBidPdf(id!) }
    finally { setTimeout(() => setExporting(false), 2000) }
  }

  function fmtCurrency(n: number | string) {
    const v = parseFloat(String(n || 0))
    return isNaN(v) ? '$0.00' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  function fmtNum(n: number | string) {
    const v = parseFloat(String(n || 0))
    return isNaN(v) ? '0' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  const total = project?.lineItems?.reduce((s, li) => s + (parseFloat(String(li.quantity || 0)) * parseFloat(String(li.unit_price || 0))), 0) || 0

  if (loading) return <div className="flex justify-center py-20 text-gray-400">Loading…</div>
  if (error) return <div className="p-8 text-red-600">{error}</div>
  if (!project) return null

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'documents', label: 'Documents', count: project.documents?.length },
    { key: 'takeoffs', label: 'Takeoffs', count: project.takeoffs?.length },
    { key: 'specs', label: 'Div 7 Specs', count: project.specs?.length },
    { key: 'line-items', label: 'Line Items', count: project.lineItems?.length },
    { key: 'concerns', label: 'Areas of Concern', count: project.concerns?.length },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <button onClick={() => navigate('/estimating')} className="text-sm text-teal-600 hover:text-teal-800 mb-1">
                ← All Estimates
              </button>
              <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
              <div className="flex gap-3 mt-1 text-sm text-gray-500 flex-wrap">
                {project.project_address && <span>📍 {project.project_address}</span>}
                {project.gc_name && <span>🏗 {project.gc_name}</span>}
                {project.bid_date && (
                  <span>📅 Bid: {new Date(project.bid_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Total Bid</div>
                <div className="text-2xl font-bold text-teal-700">{fmtCurrency(total)}</div>
              </div>
              <button
                onClick={() => setEditProjectOpen(true)}
                className="border border-gray-300 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                Edit
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 transition"
              >
                {exporting ? 'Generating…' : '⬇ Export Bid PDF'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition whitespace-nowrap ${
                  tab === t.key
                    ? 'bg-teal-700 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-teal-600' : 'bg-gray-200 text-gray-600'}`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'documents' && (
          <DocumentsTab projectId={id!} docs={project.documents || []} onRefresh={load} />
        )}
        {tab === 'takeoffs' && (
          <TakeoffsTab projectId={id!} takeoffs={project.takeoffs || []} onRefresh={load} />
        )}
        {tab === 'specs' && (
          <SpecsTab projectId={id!} specs={project.specs || []} onRefresh={load} />
        )}
        {tab === 'line-items' && (
          <LineItemsTab projectId={id!} items={project.lineItems || []} onRefresh={load} />
        )}
        {tab === 'concerns' && (
          <ConcernsTab projectId={id!} concerns={project.concerns || []} onRefresh={load} />
        )}
      </div>

      {/* Edit Project Modal */}
      {editProjectOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Edit Project</h2>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: 'Project Name', key: 'name', type: 'text' },
                { label: 'Address', key: 'project_address', type: 'text' },
                { label: 'General Contractor', key: 'gc_name', type: 'text' },
                { label: 'Bid Date', key: 'bid_date', type: 'date' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={editForm[f.key] || ''}
                    onChange={e => setEditForm((p: any) => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
                  <select
                    value={editForm.project_type || 'roofing'}
                    onChange={e => setEditForm((p: any) => ({ ...p, project_type: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="roofing">Roofing</option>
                    <option value="siding">Siding</option>
                    <option value="both">Roofing + Siding</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={editForm.status || 'draft'}
                    onChange={e => setEditForm((p: any) => ({ ...p, status: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="draft">Draft</option>
                    <option value="in_progress">In Progress</option>
                    <option value="submitted">Submitted</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Scope of Work</label>
                <textarea
                  value={editForm.notes || ''}
                  onChange={e => setEditForm((p: any) => ({ ...p, notes: e.target.value }))}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setEditProjectOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition">Cancel</button>
                <button
                  onClick={saveProject}
                  disabled={savingProject}
                  className="bg-teal-700 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 transition"
                >
                  {savingProject ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS TAB
// ─────────────────────────────────────────────────────────────────────────────
function DocumentsTab({ projectId, docs, onRefresh }: { projectId: string; docs: EstimateDocument[]; onRefresh: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState<string | null>(null)
  const [docType, setDocType] = useState('roofscope')
  const [error, setError] = useState('')
  const [parseResult, setParseResult] = useState<{ docId: string; summary: string } | null>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await uploadDocument(projectId, file, docType)
      onRefresh()
    } catch (err: any) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleParse(docId: string) {
    setParsing(docId)
    setError('')
    setParseResult(null)
    try {
      const result = await parseDocument(projectId, docId)
      setParseResult({ docId, summary: result.summary || 'Parsing complete. Data added to takeoffs, specs, line items, and concerns.' })
      onRefresh()
    } catch (err: any) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setParsing(null)
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm('Delete this document?')) return
    await deleteDocument(projectId, docId)
    onRefresh()
  }

  const DOC_TYPES = [
    { value: 'roofscope', label: 'RoofScope Report' },
    { value: 'sidingscope', label: 'SidingScope Report' },
    { value: 'spec_sheet', label: 'Project Specs / Manual' },
    { value: 'plan_set', label: 'Architectural Plan Set' },
    { value: 'unknown', label: 'Other' },
  ]

  return (
    <div className="space-y-5">
      {/* Upload card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Upload Document</h3>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Document Type</label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">PDF File</label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              onChange={handleUpload}
              disabled={uploading}
              className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-teal-700 file:text-white file:font-medium hover:file:bg-teal-800 file:cursor-pointer"
            />
          </div>
          {uploading && <span className="text-sm text-teal-600 animate-pulse">Uploading…</span>}
        </div>
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </div>

      {/* Parse result */}
      {parseResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
          <strong>Parse complete:</strong> {parseResult.summary}
        </div>
      )}

      {/* Doc list */}
      {docs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No documents yet. Upload a RoofScope, SidingScope, or spec sheet above.</div>
      ) : (
        <div className="space-y-3">
          {docs.map(doc => (
            <div key={doc.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-2xl">📄</div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{doc.file_name}</p>
                  <div className="flex gap-2 mt-1">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{doc.doc_type}</span>
                    {doc.parsed ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Parsed {doc.parsed_at ? new Date(doc.parsed_at).toLocaleDateString() : ''}</span>
                    ) : (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Not parsed</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => handleParse(doc.id)}
                  disabled={parsing === doc.id}
                  className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-teal-800 disabled:opacity-50 transition whitespace-nowrap"
                >
                  {parsing === doc.id ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      Parsing…
                    </span>
                  ) : '🤖 Parse with AI'}
                </button>
                <button onClick={() => handleDelete(doc.id)} className="text-red-400 hover:text-red-600 text-xs px-2 transition">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TAKEOFFS TAB
// ─────────────────────────────────────────────────────────────────────────────
function TakeoffsTab({ projectId, takeoffs, onRefresh }: { projectId: string; takeoffs: EstimateTakeoff[]; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ label: '', value: '', unit: 'SF', category: 'roof', source: 'Manual' })
  const [editing, setEditing] = useState<string | null>(null)
  const [editVals, setEditVals] = useState<any>({})

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    await createTakeoff(projectId, { ...form, value: parseFloat(form.value) || 0 })
    setForm({ label: '', value: '', unit: 'SF', category: 'roof', source: 'Manual' })
    setAdding(false)
    onRefresh()
  }

  async function handleSaveEdit(id: string) {
    await updateTakeoff(projectId, id, editVals)
    setEditing(null)
    onRefresh()
  }

  async function handleDelete(id: string) {
    await deleteTakeoff(projectId, id)
    onRefresh()
  }

  const categories = [...new Set(takeoffs.map(t => t.category).filter(Boolean))]

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-900">Material Takeoffs</h3>
        <button onClick={() => setAdding(true)} className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">
          + Add Row
        </button>
      </div>

      {takeoffs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No takeoff data yet. Upload and parse a RoofScope or SidingScope to populate automatically.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {categories.length > 0 ? categories.map(cat => (
            <div key={cat}>
              <div className="bg-teal-700 px-4 py-2 text-white text-xs font-bold uppercase tracking-wider">{cat}</div>
              <table className="w-full text-sm">
                <tbody>
                  {takeoffs.filter(t => t.category === cat).map((t, i) => (
                    <tr key={t.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      {editing === t.id ? (
                        <>
                          <td className="px-4 py-2"><input value={editVals.label || ''} onChange={e => setEditVals((p: any) => ({ ...p, label: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" /></td>
                          <td className="px-4 py-2 text-right"><input value={editVals.value || ''} onChange={e => setEditVals((p: any) => ({ ...p, value: e.target.value }))} className="border rounded px-2 py-1 text-sm w-24 text-right" /></td>
                          <td className="px-4 py-2"><input value={editVals.unit || ''} onChange={e => setEditVals((p: any) => ({ ...p, unit: e.target.value }))} className="border rounded px-2 py-1 text-sm w-16" /></td>
                          <td className="px-4 py-2 text-right">
                            <button onClick={() => handleSaveEdit(t.id)} className="text-teal-700 font-medium text-xs mr-3">Save</button>
                            <button onClick={() => setEditing(null)} className="text-gray-400 text-xs">Cancel</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 text-gray-800">{t.label}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-medium text-gray-900">{parseFloat(String(t.value || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                          <td className="px-4 py-2.5 text-gray-500">{t.unit}</td>
                          <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                            {t.source && <span className="mr-3 text-gray-300">{t.source}</span>}
                            <button onClick={() => { setEditing(t.id); setEditVals({ label: t.label, value: t.value, unit: t.unit }) }} className="text-teal-600 hover:text-teal-800 mr-2">Edit</button>
                            <button onClick={() => handleDelete(t.id)} className="text-red-400 hover:text-red-600">Del</button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : (
            <table className="w-full text-sm">
              <thead className="bg-teal-700 text-white text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">Measurement</th>
                  <th className="px-4 py-2 text-right">Value</th>
                  <th className="px-4 py-2 text-left">Unit</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {takeoffs.map((t, i) => (
                  <tr key={t.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 text-gray-800">{t.label}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{parseFloat(String(t.value || 0)).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-gray-500">{t.unit}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{t.source}</td>
                    <td className="px-4 py-2.5 text-right text-xs">
                      <button onClick={() => handleDelete(t.id)} className="text-red-400 hover:text-red-600">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Add form */}
      {adding && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-teal-200 p-4 flex gap-3 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Label</label>
            <input required value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Total Roof Area" className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Value</label>
            <input required type="number" step="any" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="588.66" className="border rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Unit</label>
            <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              {['SQ','SF','LF','EA','LS','CY','GAL'].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Category</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              {['roof','siding','flashing','linear','other'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <button type="submit" className="bg-teal-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">Add</button>
          <button type="button" onClick={() => setAdding(false)} className="text-gray-400 text-sm hover:text-gray-600 transition">Cancel</button>
        </form>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SPECS TAB
// ─────────────────────────────────────────────────────────────────────────────
function SpecsTab({ projectId, specs, onRefresh }: { projectId: string; specs: EstimateSpec[]; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ section: '', spec_type: 'material', description: '', value: '' })

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    await createSpec(projectId, form)
    setForm({ section: '', spec_type: 'material', description: '', value: '' })
    setAdding(false)
    onRefresh()
  }

  const sections = [...new Set(specs.map(s => s.section).filter(Boolean))]

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-900">Division 7 Specifications</h3>
        <button onClick={() => setAdding(!adding)} className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">
          + Add Spec
        </button>
      </div>

      {specs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No specs extracted yet. Parse a project manual/spec sheet to populate Division 7 specs automatically.</div>
      ) : (
        <div className="space-y-6">
          {sections.map(section => (
            <div key={section} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-gray-800 px-4 py-2.5 text-white text-sm font-semibold">{section || 'General'}</div>
              <div className="divide-y divide-gray-100">
                {specs.filter(s => s.section === section).map(spec => (
                  <div key={spec.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${SPEC_TYPE_COLORS[spec.spec_type] || 'bg-gray-100 text-gray-600'}`}>
                        {spec.spec_type}
                      </span>
                      <div>
                        <p className="text-sm text-gray-800">{spec.description}</p>
                        {spec.value && <p className="text-sm font-medium text-gray-900 mt-0.5">{spec.value}</p>}
                      </div>
                    </div>
                    <button onClick={async () => { await deleteSpec(projectId, spec.id); onRefresh() }} className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">Delete</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {specs.filter(s => !s.section).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-gray-800 px-4 py-2.5 text-white text-sm font-semibold">General</div>
              <div className="divide-y divide-gray-100">
                {specs.filter(s => !s.section).map(spec => (
                  <div key={spec.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SPEC_TYPE_COLORS[spec.spec_type] || 'bg-gray-100 text-gray-600'}`}>{spec.spec_type}</span>
                      <div>
                        <p className="text-sm text-gray-800">{spec.description}</p>
                        {spec.value && <p className="text-sm font-medium text-gray-900 mt-0.5">{spec.value}</p>}
                      </div>
                    </div>
                    <button onClick={async () => { await deleteSpec(projectId, spec.id); onRefresh() }} className="text-red-400 hover:text-red-600 text-xs">Delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {adding && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-teal-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Section (e.g. 07 50 00)</label>
              <input value={form.section} onChange={e => setForm(f => ({ ...f, section: e.target.value }))} placeholder="07 50 00 - Membrane Roofing" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Type</label>
              <select value={form.spec_type} onChange={e => setForm(f => ({ ...f, spec_type: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500">
                {['material','warranty','approved_product','standard','note'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Description</label>
            <input required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="TPO Membrane" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Value / Detail</label>
            <input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="60 mil, white, mechanically fastened" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-teal-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">Add Spec</button>
            <button type="button" onClick={() => setAdding(false)} className="text-gray-400 text-sm hover:text-gray-600 transition">Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LINE ITEMS TAB
// ─────────────────────────────────────────────────────────────────────────────
function LineItemsTab({ projectId, items, onRefresh }: { projectId: string; items: EstimateLineItem[]; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ category: 'Roofing', description: '', quantity: '', unit: 'SF', unit_price: '', waste_factor: '0', notes: '' })
  const [editing, setEditing] = useState<string | null>(null)
  const [editVals, setEditVals] = useState<any>({})
  const [repricing, setRepricing] = useState(false)
  const [repriceMsg, setRepriceMsg] = useState('')
  const flaggedCount = items.filter(li => li.price_flagged).length

  async function handleReprice() {
    setRepricing(true)
    setRepriceMsg('')
    try {
      const result = await repriceProject(projectId)
      setRepriceMsg(`Re-priced ${result.updated} item(s). ${result.stillFlagged} still need prices.`)
      onRefresh()
    } catch (e: any) {
      setRepriceMsg(e.response?.data?.message || e.message)
    } finally {
      setRepricing(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    await createLineItem(projectId, {
      ...form,
      quantity: parseFloat(form.quantity) || 0,
      unit_price: parseFloat(form.unit_price) || 0,
      waste_factor: parseFloat(form.waste_factor) || 0,
    })
    setForm({ category: 'Roofing', description: '', quantity: '', unit: 'SF', unit_price: '', waste_factor: '0', notes: '' })
    setAdding(false)
    onRefresh()
  }

  async function handleSaveEdit(id: string) {
    await updateLineItem(projectId, id, editVals)
    setEditing(null)
    onRefresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this line item?')) return
    await deleteLineItem(projectId, id)
    onRefresh()
  }

  const total = items.reduce((s, li) => s + (parseFloat(String(li.quantity || 0)) * parseFloat(String(li.unit_price || 0))), 0)
  const categories = [...new Set(items.map(li => li.category).filter(Boolean))]

  function fmtCurrency(n: number | string) {
    const v = parseFloat(String(n || 0))
    return isNaN(v) ? '$0.00' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-gray-900">Bid Line Items</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {items.length} items
            {flaggedCount > 0 && (
              <span className="ml-2 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-xs font-medium">
                ⚠ {flaggedCount} need price review
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Total</div>
            <div className="text-xl font-bold text-teal-700">{fmtCurrency(total)}</div>
          </div>
          <button
            onClick={handleReprice}
            disabled={repricing}
            className="bg-white border border-teal-700 text-teal-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-50 disabled:opacity-50 transition"
            title="Re-run price lookup against the price database"
          >
            {repricing ? 'Re-pricing…' : 'Re-price'}
          </button>
          <button onClick={() => setAdding(true)} className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">
            + Add Item
          </button>
        </div>
      </div>
      {repriceMsg && <div className="bg-teal-50 border border-teal-200 text-teal-800 rounded-lg px-3 py-2 text-sm">{repriceMsg}</div>}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No line items yet. Parse documents to auto-populate, or add items manually.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="bg-teal-700 text-white text-xs font-bold uppercase tracking-wider grid grid-cols-12 gap-2 px-4 py-2.5">
            <span className="col-span-4">Description</span>
            <span className="col-span-2 text-right">Qty</span>
            <span className="col-span-1">Unit</span>
            <span className="col-span-2 text-right">Unit Price</span>
            <span className="col-span-2 text-right">Line Total</span>
            <span className="col-span-1"></span>
          </div>

          {categories.map(cat => (
            <div key={cat}>
              <div className="bg-gray-100 px-4 py-2 text-xs font-bold text-gray-600 uppercase tracking-wider">{cat}</div>
              {items.filter(li => li.category === cat).map((li, i) => {
                const lineTotal = parseFloat(String(li.quantity || 0)) * parseFloat(String(li.unit_price || 0))
                const rowBg = li.price_flagged ? 'bg-amber-50' : (i % 2 === 0 ? '' : 'bg-gray-50')
                return (
                  <div key={li.id} className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm ${rowBg} border-t border-gray-100`}>
                    {editing === li.id ? (
                      <>
                        <div className="col-span-4">
                          <input value={editVals.description || ''} onChange={e => setEditVals((p: any) => ({ ...p, description: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" />
                        </div>
                        <div className="col-span-2">
                          <input type="number" step="any" value={editVals.quantity || ''} onChange={e => setEditVals((p: any) => ({ ...p, quantity: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full text-right" />
                        </div>
                        <div className="col-span-1">
                          <input value={editVals.unit || ''} onChange={e => setEditVals((p: any) => ({ ...p, unit: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" />
                        </div>
                        <div className="col-span-2">
                          <input type="number" step="any" value={editVals.unit_price || ''} onChange={e => setEditVals((p: any) => ({ ...p, unit_price: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full text-right" />
                        </div>
                        <div className="col-span-2 text-right text-gray-500 font-mono text-xs">
                          {fmtCurrency((parseFloat(editVals.quantity || 0) * parseFloat(editVals.unit_price || 0)))}
                        </div>
                        <div className="col-span-1 flex gap-1 justify-end">
                          <button onClick={() => handleSaveEdit(li.id)} className="text-teal-700 text-xs font-medium">Save</button>
                          <button onClick={() => setEditing(null)} className="text-gray-400 text-xs">✕</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="col-span-4 text-gray-800">
                          {li.price_flagged && (
                            <span className="text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded text-xs font-bold mr-2" title="Not found in price database — review unit price">
                              ⚠ NO PRICE
                            </span>
                          )}
                          {li.description}
                          {li.material_key && <p className="text-xs text-gray-400 font-mono mt-0.5">{li.material_key}</p>}
                          {li.notes && <p className="text-xs text-gray-400 mt-0.5">{li.notes}</p>}
                        </div>
                        <div className="col-span-2 text-right font-mono text-gray-700">
                          {parseFloat(String(li.quantity || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </div>
                        <div className="col-span-1 text-gray-500">{li.unit}</div>
                        <div className="col-span-2 text-right font-mono text-gray-700">{fmtCurrency(li.unit_price)}</div>
                        <div className="col-span-2 text-right font-mono font-medium text-gray-900">{fmtCurrency(lineTotal)}</div>
                        <div className="col-span-1 flex gap-2 justify-end">
                          <button onClick={() => { setEditing(li.id); setEditVals({ description: li.description, quantity: li.quantity, unit: li.unit, unit_price: li.unit_price, category: li.category }) }} className="text-teal-600 hover:text-teal-800 text-xs">Edit</button>
                          <button onClick={() => handleDelete(li.id)} className="text-red-400 hover:text-red-600 text-xs">Del</button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ))}

          {/* Total row */}
          <div className="bg-teal-700 text-white grid grid-cols-12 gap-2 px-4 py-3">
            <div className="col-span-9 text-right font-bold text-sm uppercase tracking-wide">Total</div>
            <div className="col-span-2 text-right font-bold font-mono">{fmtCurrency(total)}</div>
            <div className="col-span-1"></div>
          </div>
        </div>
      )}

      {/* Add form */}
      {adding && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-teal-200 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Category</label>
              <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Roofing" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-600 block mb-1">Description *</label>
              <input required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="TPO Membrane – 60 mil mechanically fastened" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Quantity</label>
              <input type="number" step="any" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="588.66" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Unit</label>
              <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500">
                {['SF','SQ','LF','EA','LS','CY','GAL'].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Unit Price</label>
              <input type="number" step="any" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} placeholder="185.00" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Waste %</label>
              <input type="number" step="any" value={form.waste_factor} onChange={e => setForm(f => ({ ...f, waste_factor: e.target.value }))} placeholder="10" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Per spec 07 50 00" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-teal-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">Add Item</button>
            <button type="button" onClick={() => setAdding(false)} className="text-gray-400 text-sm hover:text-gray-600 transition">Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCERNS TAB
// ─────────────────────────────────────────────────────────────────────────────
function ConcernsTab({ projectId, concerns, onRefresh }: { projectId: string; concerns: EstimateConcern[]; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ description: '', severity: 'medium' as const })

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    await createConcern(projectId, form)
    setForm({ description: '', severity: 'medium' })
    setAdding(false)
    onRefresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-900">Areas of Concern</h3>
        <button onClick={() => setAdding(!adding)} className="bg-teal-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">
          + Add Concern
        </button>
      </div>

      {concerns.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No concerns flagged. Parse documents to auto-detect issues.</div>
      ) : (
        <div className="space-y-3">
          {concerns.map(c => (
            <div key={c.id} className={`rounded-xl border p-4 flex items-start justify-between gap-3 ${SEVERITY_STYLES[c.severity] || 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">{c.severity === 'high' ? '🔴' : c.severity === 'medium' ? '🟡' : '🟢'}</span>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wide">{c.severity}</span>
                  <p className="text-sm mt-0.5">{c.description}</p>
                </div>
              </div>
              <button onClick={async () => { await deleteConcern(projectId, c.id); onRefresh() }} className="text-current opacity-40 hover:opacity-80 text-xs flex-shrink-0">Delete</button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-teal-200 p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Description *</label>
            <textarea required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the concern or risk…" className="border rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Severity</label>
            <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value as any }))} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-teal-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">Add Concern</button>
            <button type="button" onClick={() => setAdding(false)} className="text-gray-400 text-sm hover:text-gray-600 transition">Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
