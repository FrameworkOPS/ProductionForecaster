import { create } from 'zustand'
import { mockLogin, mockRegister } from '../services/mockApi'

interface User {
  userId: string
  email: string
  role: string
}

interface AuthStore {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  loading: boolean
  isMockMode: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, firstName?: string, lastName?: string) => Promise<void>
  logout: () => void
  setToken: (token: string) => void
  setUser: (user: User) => void
  checkAuth: () => void
}

import { API_BASE_URL as API_URL } from '../utils/apiConfig'
const USE_MOCK_API = import.meta.env.VITE_MOCK_API === 'true'

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem('token'),
  user: null,
  isAuthenticated: !!localStorage.getItem('token'),
  loading: true,
  isMockMode: USE_MOCK_API,

  login: async (email: string, password: string) => {
    try {
      if (USE_MOCK_API) {
        const data = await mockLogin(email, password)
        localStorage.setItem('token', data.data.token)
        set({
          token: data.data.token,
          user: data.data.user,
          isAuthenticated: true,
        })
      } else {
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json()
        if (res.ok) {
          localStorage.setItem('token', data.token)
          set({
            token: data.token,
            user: data.user,
            isAuthenticated: true,
          })
        } else {
          throw new Error(data.message || 'Login failed')
        }
      }
    } catch (error) {
      throw error
    }
  },

  register: async (email: string, password: string, firstName?: string, lastName?: string) => {
    try {
      if (USE_MOCK_API) {
        const data = await mockRegister(email, password, firstName, lastName)
        localStorage.setItem('token', data.data.token)
        set({
          token: data.data.token,
          user: data.data.user,
          isAuthenticated: true,
        })
      } else {
        const res = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, firstName, lastName }),
        })
        const data = await res.json()
        if (res.ok) {
          localStorage.setItem('token', data.token)
          set({
            token: data.token,
            user: data.user,
            isAuthenticated: true,
          })
        } else {
          throw new Error(data.message || 'Registration failed')
        }
      }
    } catch (error) {
      throw error
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    set({ token: null, user: null, isAuthenticated: false })
  },

  setToken: (token: string) => {
    localStorage.setItem('token', token)
    set({ token, isAuthenticated: !!token })
  },

  setUser: (user: User) => {
    set({ user })
  },

  checkAuth: () => {
    const token = localStorage.getItem('token')
    set({ isAuthenticated: !!token, token, loading: false })
    // Hydrate the current user (incl. role) so role-gated UI survives a refresh.
    if (token && !USE_MOCK_API) {
      fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.user) {
            set({
              user: {
                userId: data.user.id,
                email: data.user.email,
                role: data.user.role,
              },
            })
          }
        })
        .catch(() => {})
    }
  },
}))

// Check auth on app load
useAuthStore.getState().checkAuth()

// Global fetch interceptor: auto-logout on 401 "Invalid or expired token"
const _originalFetch = window.fetch
window.fetch = async (...args) => {
  const response = await _originalFetch(...args)
  if (response.status === 401) {
    // Clone so callers can still read the body
    const clone = response.clone()
    try {
      const data = await clone.json()
      if (data?.error === 'Invalid or expired token' || data?.message === 'Invalid or expired token') {
        console.warn('Session expired — logging out')
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    } catch {
      // ignore parse errors
    }
  }
  return response
}
