import { useEffect, useState } from 'react'
import { listPrices, createPrice, updatePrice, deletePrice, Price, PriceKind } from '../services/pricesApi'

const UNITS = ['SQ', 'SF', 'LF', 'EA', 'LB', 'GAL', 'CY', 'LS']

export default function Prices() {
  const [kind, setKind] = useState<PriceKind>('material')
  const [items, setItems] = useState<Price[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState<Partial<Price>>({ material_key: '', category: '', description: '', unit: 'SQ', unit_cost: 0, vendor: '', notes: '' })
  const [editing, setEditing] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Price>>({})

  async function load() {
    setLoading(true)
    setError('')
    try {
      setItems(await listPrices(kind))
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [kind])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createPrice(kind, form)
      setAdding(false)
      setForm({ material_key: '', category: '', description: '', unit: 'SQ', unit_cost: 0, vendor: '', notes: '' })
      load()
    } catch (e: any) {
      setError(e.response?.data?.message || e.message)
    }
  }

  async function handleSaveEdit(id: string) {
    await updatePrice(kind, id, editForm)
    setEditing(null)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this price entry?')) return
    await deletePrice(kind, id)
    load()
  }

  const filtered = items.filter(it => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return [it.material_key, it.category, it.description, it.vendor].some(s => (s || '').toLowerCase().includes(f))
  })

  const categories = [...new Set(filtered.map(i => i.category))]

  function fmt(n: number | string) {
    const v = parseFloat(String(n || 0))
    return isNaN(v) ? '$0.00' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Database</h1>
          <p className="text-sm text-gray-500 mt-1">Material & labor unit costs used to auto-price line items when documents are parsed.</p>
        </div>
        <button onClick={() => setAdding(!adding)} className="bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-800 transition">
          + Add Price
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setKind('material')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${kind === 'material' ? 'bg-teal-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >Materials</button>
        <button
          onClick={() => setKind('labor')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${kind === 'labor' ? 'bg-teal-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >Labor</button>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by key, description, vendor…"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-md focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-teal-200 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Material Key (UPPER_SNAKE) *</label>
              <input required value={form.material_key} onChange={e => setForm(f => ({ ...f, material_key: e.target.value.toUpperCase() }))} placeholder="TPO_MEMBRANE_60MIL_WHITE_MECH" className="border rounded-lg px-3 py-1.5 text-sm w-full font-mono focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Category *</label>
              <input required value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Roofing - Membrane" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Description *</label>
            <input required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="TPO Membrane 60 mil white, mechanically fastened" className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">Unit *</label>
              <select required value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500">
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Unit Cost *</label>
              <input required type="number" step="any" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: parseFloat(e.target.value) }))} className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            {kind === 'material' && (
              <div className="col-span-2">
                <label className="text-xs text-gray-600 block mb-1">Vendor</label>
                <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex gap-3">
            <button type="submit" className="bg-teal-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-800 transition">Add</button>
            <button type="button" onClick={() => setAdding(false)} className="text-gray-400 text-sm hover:text-gray-600">Cancel</button>
          </div>
        </form>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm mb-4">{error}</div>}
      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No price entries{filter ? ' match the filter' : ''}.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-teal-700 text-white text-xs font-bold uppercase tracking-wider grid grid-cols-12 gap-2 px-4 py-2.5">
            <span className="col-span-3">Material Key</span>
            <span className="col-span-4">Description</span>
            <span className="col-span-1">Unit</span>
            <span className="col-span-2 text-right">Unit Cost</span>
            {kind === 'material' ? <span className="col-span-1">Vendor</span> : <span className="col-span-1"></span>}
            <span className="col-span-1"></span>
          </div>
          {categories.map(cat => (
            <div key={cat}>
              <div className="bg-gray-100 px-4 py-2 text-xs font-bold text-gray-600 uppercase tracking-wider">{cat}</div>
              {filtered.filter(it => it.category === cat).map((it, i) => (
                <div key={it.id} className={`grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm ${i % 2 === 0 ? '' : 'bg-gray-50'} border-t border-gray-100`}>
                  {editing === it.id ? (
                    <>
                      <div className="col-span-3">
                        <input value={editForm.material_key || ''} onChange={e => setEditForm(p => ({ ...p, material_key: e.target.value.toUpperCase() }))} className="border rounded px-2 py-1 text-sm w-full font-mono" />
                      </div>
                      <div className="col-span-4">
                        <input value={editForm.description || ''} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" />
                      </div>
                      <div className="col-span-1">
                        <input value={editForm.unit || ''} onChange={e => setEditForm(p => ({ ...p, unit: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" />
                      </div>
                      <div className="col-span-2">
                        <input type="number" step="any" value={editForm.unit_cost ?? ''} onChange={e => setEditForm(p => ({ ...p, unit_cost: parseFloat(e.target.value) }))} className="border rounded px-2 py-1 text-sm w-full text-right" />
                      </div>
                      <div className="col-span-1">
                        {kind === 'material' && (
                          <input value={editForm.vendor || ''} onChange={e => setEditForm(p => ({ ...p, vendor: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" />
                        )}
                      </div>
                      <div className="col-span-1 flex gap-1 justify-end">
                        <button onClick={() => handleSaveEdit(it.id)} className="text-teal-700 text-xs font-medium">Save</button>
                        <button onClick={() => setEditing(null)} className="text-gray-400 text-xs">✕</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-3 font-mono text-xs text-gray-700 truncate">{it.material_key}</div>
                      <div className="col-span-4 text-gray-800">{it.description}{it.notes && <p className="text-xs text-gray-400 mt-0.5">{it.notes}</p>}</div>
                      <div className="col-span-1 text-gray-500">{it.unit}</div>
                      <div className="col-span-2 text-right font-mono font-medium text-gray-900">{fmt(it.unit_cost)}</div>
                      <div className="col-span-1 text-gray-500 text-xs truncate">{kind === 'material' ? it.vendor : ''}</div>
                      <div className="col-span-1 flex gap-2 justify-end">
                        <button onClick={() => { setEditing(it.id); setEditForm({ material_key: it.material_key, description: it.description, unit: it.unit, unit_cost: it.unit_cost, vendor: it.vendor, notes: it.notes }) }} className="text-teal-600 hover:text-teal-800 text-xs">Edit</button>
                        <button onClick={() => handleDelete(it.id)} className="text-red-400 hover:text-red-600 text-xs">Del</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
