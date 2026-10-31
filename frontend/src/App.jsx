import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import EnvBanner from './components/EnvBanner'
import { SendModeContext } from './envInfo'
import Dashboard from './pages/Dashboard'
import Contacts from './pages/Contacts'
import Leads from './pages/Leads'
import Timesheet from './pages/Timesheet'
import FollowupDrafts from './pages/FollowupDrafts'
import CustomEmail from './pages/CustomEmail'
import './index.css'

export default function App() {
  // Set by the email pages (useBannerSendMode) so the banner can show the
  // send mode they already fetched; null on every other page.
  const [pageSendMode, setPageSendMode] = useState(null)

  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1">
          <EnvBanner pageSendMode={pageSendMode} />
          <div className="p-8">
            <SendModeContext.Provider value={setPageSendMode}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/customers/followup-drafts" element={<FollowupDrafts />} />
                <Route path="/customers/custom-email" element={<CustomEmail />} />
                <Route path="/timesheet" element={<Timesheet />} />
              </Routes>
            </SendModeContext.Provider>
          </div>
        </main>
      </div>
    </BrowserRouter>
  )
}
