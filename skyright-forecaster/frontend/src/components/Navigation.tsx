import { useAuthStore } from '../store/authStore'
import { useNavigate } from 'react-router-dom'

export default function Navigation() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <h1 className="text-xl font-bold">Production Forecaster</h1>
        <div className="flex items-center space-x-4">
          <span className="text-sm">{user?.email}</span>
          <button
            onClick={handleLogout}
            className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}
