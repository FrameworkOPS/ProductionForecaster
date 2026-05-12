import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Navigation from './components/Navigation'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Estimating from './pages/Estimating'
import EstimateDetail from './pages/EstimateDetail'

// Production Forecaster - Roofing Business Management
function App() {
  return (
    <Router>
      <Navigation />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/estimating" element={<Estimating />} />
        <Route path="/estimating/:id" element={<EstimateDetail />} />
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Router>
  )
}

export default App
