import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { API_BASE_URL } from '../utils/apiConfig'

interface InviteInfo {
  email: string
  firstName: string | null
  lastName: string | null
  role: string
}

export default function SetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token.')
      setLoading(false)
      return
    }
    fetch(`${API_BASE_URL}/api/auth/invite/${token}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'This invitation is invalid or has expired.')
        setInvite({
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
        })
      })
      .catch((e) => setError(e.message || 'This invitation is invalid or has expired.'))
      .finally(() => setLoading(false))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not set your password.')
      localStorage.setItem('token', data.token)
      // Force a fresh load so the auth store picks up the session.
      window.location.href = '/dashboard'
    } catch (e: any) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full border border-gray-300 rounded-md px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">Production Forecaster</h1>
        <p className="text-center text-gray-500 mb-6">Set your password to join</p>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
          </div>
        ) : !invite ? (
          <div className="space-y-4 text-center">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error || 'Invalid invitation.'}
            </div>
            <button onClick={() => navigate('/login')} className="text-blue-600 text-sm hover:underline">
              Go to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">{error}</div>
            )}
            {invite.firstName && (
              <p className="text-gray-600 text-sm">
                Welcome, <strong>{invite.firstName}</strong>! Create a password to activate your account.
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={invite.email} disabled className={`${inputCls} bg-gray-100 opacity-70`} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600 disabled:opacity-50"
            >
              {submitting ? 'Setting password…' : 'Set Password & Join'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
