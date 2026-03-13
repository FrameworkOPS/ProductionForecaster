import { create } from 'zustand'

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
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, firstName?: string, lastName?: string) => Promise<void>
  logout: () => void
  setToken: (token: string) => void
  setUser: (user: User) => void
  checkAuth: () => void
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001'

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem('token'),
  user: null,
  isAuthenticated: !!localStorage.getItem('token'),
  loading: true,

  login: async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (res.ok) {
      const data = await res.json()
      localStorage.setItem('token', data.data.token)
      set({
        token: data.data.token,
        user: data.data.user,
        isAuthenticated: true,
      })
    } else {
      throw new Error('Login failed')
    }
  },

  register: async (email: string, password: string, firstName?: string, lastName?: string) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
    })
    if (res.ok) {
      const data = await res.json()
      localStorage.setItem('token', data.data.token)
      set({
        token: data.data.token,
        user: data.data.user,
        isAuthenticated: true,
      })
    } else {
      throw new Error('Registration failed')
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
  },
}))

// Check auth on app load
useAuthStore.getState().checkAuth()
