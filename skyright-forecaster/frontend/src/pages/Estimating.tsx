import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listProjects, createProject, deleteProject, EstimateProject, EstimateStage } from '../services/estimatingApi'

const TYPE_COLORS: Record<string, string> = {
  roofing: 'bg-teal-100 text-teal-800',
  siding: 'bg-blue-100 text-blue-800',
  both: 'bg-purple-100 text-purple-800',
}

// Estimate workflow stages — order matters (displayed L→R)
const STAGES: { key: EstimateStage; label: string; description: string; accent: string }[] = [
  { key: 'new', label: 'New', description: 'Awaiting initial review', accent: 'bg-blue-500' },
  { key: 'plans_reviewed', label: 'Plans Reviewed', description: 'Docs uploaded, takeoffs underway', accent: 'bg-amber-500' },
  { key: 'quote_built', label: 'Quote Built', description: 'Bid package ready', accent: 'bg-emerald-500' },
]

function fmtCurrency(n: number | string | undefined): string {
  const v = parseFloat(String(n || 0))
  return isNaN(v) ? '$0' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function Estimating() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<EstimateProject[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '', project_address: '', gc_name: '', bid_date: '', project_type: 'roofing', notes: ''
  })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setProjects(await listProjects())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const proj = await createProject(form)
      navigate(`/estimating/${proj.id}`)
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    await deleteProject(id)
    setProjects(p => p.filter(x => x.id !== id))
  }

  // Group projects by stage; legacy 'draft' / unknown stages → 'new'
  const grouped: Record<EstimateStage, EstimateProject[]> = {
    new: [],
    plans_reviewed: [],
    quote_built: [],
  }
  for (const p of projects) {
    const stage: EstimateStage = (STAGES.some(s => s.key === p.stage) ? p.stage : 'new') as EstimateStage
    grouped[stage].push(p)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Commercial Estimating</h1>
            <p className="text-gray-500 mt-1">Upload plans &amp; specs → AI extracts takeoffs → generate bid packages</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-teal-700 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-teal-800 transition"
          >
            + New Estimate
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-4 mb-6">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20 text-gray-400">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-lg font-medium">No estimates yet</p>
            <p className="text-sm mt-1">Create your first estimate to get started</p>
          </div>
        ) : (
          <div className="space-y-10">
            {STAGES.map(stage => {
              const items = grouped[stage.key]
              return (
                <section key={stage.key}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`w-2.5 h-2.5 rounded-full ${stage.accent}`} />
                    <h2 className="text-lg font-semibold text-gray-900">{stage.label}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 font-medium">
                      {items.length}
                    </span>
                    <span className="text-xs text-gray-400">— {stage.description}</span>
                  </div>

                  {items.length === 0 ? (
                    <div className="bg-white/60 rounded-xl border border-dashed border-gray-300 px-6 py-8 text-center text-sm text-gray-400">
                      No estimates in this stage
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {items.map(p => (
                        <div
                          key={p.id}
                          className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition cursor-pointer group"
                          onClick={() => navigate(`/estimating/${p.id}`)}
                        >
                          <div className="p-5">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <h3 className="font-semibold text-gray-900 text-lg leading-tight group-hover:text-teal-700 transition">
                                {p.name}
                              </h3>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${TYPE_COLORS[p.project_type] || 'bg-gray-100 text-gray-600'}`}>
                                {p.project_type}
                              </span>
                            </div>

                            {p.project_address && (
                              <p className="text-sm text-gray-500 mb-1">📍 {p.project_address}</p>
                            )}
                            {p.gc_name && (
                              <p className="text-sm text-gray-500 mb-1">🏗 {p.gc_name}</p>
                            )}
                            {p.bid_date && (
                              <p className="text-sm text-gray-500 mb-3">
                                📅 Bid: {new Date(p.bid_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </p>
                            )}

                            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                              <div className="flex gap-4 text-xs text-gray-400">
                                <span>{p.doc_count || 0} docs</span>
                                <span>{p.line_item_count || 0} items</span>
                              </div>
                              <div className="text-lg font-bold text-teal-700">{fmtCurrency(p.total_bid)}</div>
                            </div>
                          </div>

                          <div className="px-5 pb-4 flex justify-end" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => handleDelete(p.id, p.name)}
                              className="text-xs text-red-400 hover:text-red-600 transition"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">New Estimate Project</h2>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project Name *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Super 1 Foods – Post Falls, ID"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project Address</label>
                <input
                  value={form.project_address}
                  onChange={e => setForm(f => ({ ...f, project_address: e.target.value }))}
                  placeholder="123 Main St, Post Falls, ID"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">General Contractor</label>
                <input
                  value={form.gc_name}
                  onChange={e => setForm(f => ({ ...f, gc_name: e.target.value }))}
                  placeholder="Ginno Construction"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bid Date</label>
                  <input
                    type="date"
                    value={form.bid_date}
                    onChange={e => setForm(f => ({ ...f, bid_date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
                  <select
                    value={form.project_type}
                    onChange={e => setForm(f => ({ ...f, project_type: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="roofing">Roofing</option>
                    <option value="siding">Siding</option>
                    <option value="both">Roofing + Siding</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Scope of Work</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="General scope description…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-teal-700 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 transition"
                >
                  {creating ? 'Creating…' : 'Create & Open'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
