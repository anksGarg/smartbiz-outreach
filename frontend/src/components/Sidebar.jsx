import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/leads', label: 'Leads' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/customers', label: 'Customers' },
  { to: '/timesheet', label: 'Timesheet' },
]

export default function Sidebar() {
  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="px-6 py-5 text-lg font-semibold border-b border-gray-700">
        Willamette Power Roofing
      </div>
      <nav className="flex flex-col gap-1 px-3 py-4">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
