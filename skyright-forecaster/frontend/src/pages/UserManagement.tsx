import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../utils/apiConfig'
import { useAuthStore } from '../store/authStore'

interface User {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  role: string
  active: boolean
  invited: boolean
}

const ROLES = ['admin', 'manager', 'scheduler', 'viewer'] as const

const emptyForm = { email: '', first_name: '', last_name: '', role: 'viewer', invite: true }

export default function UserManagement() {
  const { token, user } = useAuthStore()
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/users`, { headers: authHeaders })
      if (res.status === 401 || res.status === 403) {
        setError('You need an admin account to manage users.')
        return
      }
      const data = await res.json()
      setUsers(data.users || [])
    } catch {
      setError('Failed to load users.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) {
      navigate('/login')
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create user.')
      setNotice(
        data.email_warning ||
          (form.invite ? `Invitation sent to ${form.email}.` : `User ${form.email} created.`)
      )
      setForm({ ...emptyForm })
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const updateUser = async (id: string, patch: Partial<User>) => {
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed.')
      load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const resendInvite = async (id: string, email: string) => {
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${id}/resend-invite`, {
        method: 'POST',
        headers: authHeaders,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Resend failed.')
      setNotice(`Invitation re-sent to ${email}.`)
      load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const removeUser = async (id: string, email: string) => {
    if (!window.confirm(`Delete ${email}? This cannot be undone.`)) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed.')
      load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Team & Access</h1>
      <p className="text-gray-500 mb-6">Invite people to the Production Forecaster and manage their roles.</p>

      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
      {notice && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">{notice}</div>}

      {/* Add / invite */}
      <form onSubmit={handleCreate} className="bg-white rounded-lg shadow p-5 mb-6 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            placeholder="name@skyright.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">First name</label>
          <input
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Last name</label>
          <input
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm capitalize"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Sending…' : 'Invite'}
        </button>
        <label className="md:col-span-6 flex items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={form.invite}
            onChange={(e) => setForm({ ...form, invite: e.target.checked })}
          />
          Send an email invitation to set their own password (uncheck to create with no email).
        </label>
      </form>

      {/* Roster */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Role</th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">Status</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">
                    {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => updateUser(u.id, { role: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 text-xs capitalize"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.invited ? (
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-amber-100 text-amber-800">Invited</span>
                    ) : u.active ? (
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-800">Active</span>
                    ) : (
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-gray-200 text-gray-600">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {u.invited && (
                      <button onClick={() => resendInvite(u.id, u.email)} className="text-blue-600 text-xs hover:underline">
                        Resend
                      </button>
                    )}
                    {!u.invited && (
                      <button
                        onClick={() => updateUser(u.id, { active: !u.active })}
                        className="text-gray-600 text-xs hover:underline"
                      >
                        {u.active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                    {user?.userId !== u.id && (
                      <button onClick={() => removeUser(u.id, u.email)} className="text-red-600 text-xs hover:underline">
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
