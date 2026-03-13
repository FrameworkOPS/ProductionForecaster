import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import ProtectedRoute from './components/ProtectedRoute'
import Navigation from './components/Navigation'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

function App() {
  const { isAuthenticated, loading } = useAuthStore()

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  return (
    <Router>
      {isAuthenticated && <Navigation />}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} />
      </Routes>
    </Router>
  )
}

export default App
