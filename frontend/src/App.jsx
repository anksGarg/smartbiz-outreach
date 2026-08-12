import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Contacts from './pages/Contacts'
import Leads from './pages/Leads'
import Campaigns from './pages/Campaigns'
import Customers from './pages/Customers'
import Timesheet from './pages/Timesheet'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 p-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/timesheet" element={<Timesheet />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
