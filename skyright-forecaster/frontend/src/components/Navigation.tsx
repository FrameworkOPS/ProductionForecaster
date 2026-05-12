import { useAuthStore } from '../store/authStore'
import { useNavigate, useLocation, Link } from 'react-router-dom'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/estimating', label: 'Estimating' },
]

export default function Navigation() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="bg-gray-900 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold text-teal-400 tracking-tight">SKYRIGHT</span>
          <div className="flex gap-1">
            {NAV_LINKS.map(link => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  location.pathname.startsWith(link.to)
                    ? 'bg-teal-700 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-400">{user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}
