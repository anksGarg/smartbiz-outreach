import { useState, useEffect } from 'react'

const API = 'https://smartbiz-outreach.onrender.com'

function fmtTime(isoStr) {
  if (!isoStr) return '—'
  try {
    // "HH:MM" stored from Sheets — convert to "9:30 AM"
    if (/^\d{1,2}:\d{2}$/.test(isoStr)) {
      const [h, m] = isoStr.split(':').map(Number)
      const ap = h >= 12 ? 'PM' : 'AM'
      const h12 = h % 12 || 12
      return `${h12}:${String(m).padStart(2, '0')} ${ap}`
    }
    const dt = new Date(isoStr)
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch { return isoStr }
}

function fmtHours(h, missing) {
  if (missing) return 'Still working'
  if (h == null) return '—'
  const hrs  = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`
}

function fmtMinutes(m) {
  if (m == null) return '—'
  const h = Math.floor(m / 60)
  const min = m % 60
  return h ? (min ? `${h}h ${min}m` : `${h}h`) : `${min}m`
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function Timesheet() {
  const [tab, setTab] = useState('employees')

  // Employees tab
  const [companyQR,  setCompanyQR]  = useState(null)
  const [loadingQR,  setLoadingQR]  = useState(true)
  const [employees,  setEmployees]  = useState([])
  const [loadingEmp, setLoadingEmp] = useState(true)
  const [newName,    setNewName]    = useState('')
  const [adding,     setAdding]     = useState(false)
  const [addError,   setAddError]   = useState(null)

  // Time log tab
  const [entries,    setEntries]    = useState([])
  const [loadingTs,  setLoadingTs]  = useState(true)
  const [filterFrom, setFilterFrom] = useState(todayStr())
  const [filterTo,   setFilterTo]   = useState('')
  const [filterEmp,  setFilterEmp]  = useState('')

  useEffect(() => { fetchCompanyQR(); fetchEmployees(); fetchTimesheet() }, [])
  useEffect(() => { if (tab === 'timelog') { fetchTimesheet(); fetchEmployees() } }, [tab])

  async function fetchCompanyQR() {
    setLoadingQR(true)
    try {
      const res  = await fetch(`${API}/timeclock/qr`)
      const data = await res.json()
      setCompanyQR(data)
    } catch {}
    setLoadingQR(false)
  }

  async function fetchEmployees() {
    setLoadingEmp(true)
    try {
      const res  = await fetch(`${API}/employees`)
      const data = await res.json()
      setEmployees(data.employees || [])
    } catch {}
    setLoadingEmp(false)
  }

  async function fetchTimesheet() {
    setLoadingTs(true)
    try {
      const res  = await fetch(`${API}/timesheet`)
      const data = await res.json()
      setEntries(data.entries || [])
    } catch {}
    setLoadingTs(false)
  }

  async function addEmployee() {
    if (!newName.trim()) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch(`${API}/employees`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not add employee.')
      }
      const emp = await res.json()
      setEmployees(prev => [...prev, emp])
      setNewName('')
    } catch (e) {
      setAddError(e.message)
    } finally {
      setAdding(false)
    }
  }

  function printCompanyQR() {
    if (!companyQR) return
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Time Clock QR</title>
  <style>
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;
         height:100vh;font-family:sans-serif;margin:0;background:#fff}
    img{width:260px;height:260px}
    h2{margin-top:18px;font-size:1.5rem;color:#1e293b;font-weight:700}
    p{color:#64748b;font-size:.95rem;margin-top:6px}
  </style>
</head>
<body onload="window.print()">
  <img src="data:image/png;base64,${companyQR.qr_code}" />
  <h2>Willamette Power Roofing</h2>
  <p>Scan to clock in / clock out</p>
</body>
</html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  function downloadCompanyQR() {
    if (!companyQR) return
    const a    = document.createElement('a')
    a.href     = `data:image/png;base64,${companyQR.qr_code}`
    a.download = 'timeclock-qr.png'
    a.click()
  }

  // Filtered + sorted entries for Time Log
  const empNames = [...new Set(entries.map(e => e.employee_name))].sort()
  const filtered = entries
    .filter(e => {
      if (filterFrom && e.date < filterFrom) return false
      if (filterTo   && e.date > filterTo)   return false
      if (filterEmp  && e.employee_name !== filterEmp) return false
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.employee_name.localeCompare(b.employee_name))

  const hasFilters = filterFrom || filterTo || filterEmp

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Time Tracking</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage employee time cards and view hours worked.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[['employees', 'Employees'], ['timelog', 'Time Log']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab 1: Employees ── */}
      {tab === 'employees' && (
        <div className="space-y-6">

          {/* Company QR Code */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col items-center gap-4">
            <div className="text-center">
              <h2 className="text-base font-semibold text-gray-800">Company QR Code</h2>
              <p className="text-xs text-gray-400 mt-1">Print this QR code and post it in your office</p>
            </div>
            {loadingQR ? (
              <div className="w-44 h-44 bg-gray-100 rounded-lg animate-pulse" />
            ) : companyQR ? (
              <>
                <img
                  src={`data:image/png;base64,${companyQR.qr_code}`}
                  alt="Company time clock QR code"
                  className="w-44 h-44 rounded-lg border border-gray-100"
                />
                <p className="text-xs text-gray-400 font-mono">{companyQR.url}</p>
                <div className="flex gap-2">
                  <button
                    onClick={printCompanyQR}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Print
                  </button>
                  <button
                    onClick={downloadCompanyQR}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    ↓ Download QR
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-red-500">Could not load QR code.</p>
            )}
          </div>

          {/* Add Employee */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Add Employee</h2>
            <div className="flex gap-3">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEmployee()}
                placeholder="Employee full name"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button
                onClick={addEmployee}
                disabled={adding || !newName.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {adding ? 'Adding…' : '+ Add Employee'}
              </button>
            </div>
            {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
          </div>

          {/* Employee list */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-800">Employees</h2>
            </div>
            {loadingEmp ? (
              <p className="text-sm text-gray-400 px-6 py-4">Loading…</p>
            ) : employees.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-4">No employees yet. Add one above.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {employees.map(emp => (
                  <li key={emp.id} className="px-6 py-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{emp.name}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      emp.status === 'In'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {emp.status === 'In' ? 'Clocked In' : 'Clocked Out'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 2: Time Log ── */}
      {tab === 'timelog' && (() => {
        const today        = todayStr()
        const clockedInNow = employees.filter(e => e.status !== 'not_clocked_in' && e.status !== 'clocked_out').length
        const hoursToday   = entries
          .filter(e => e.date === today)
          .reduce((sum, e) => sum + (e.work_hours ?? e.hours ?? 0), 0)
        const hoursTodayFmt = (() => {
          const h = Math.floor(hoursToday)
          const m = Math.round((hoursToday - h) * 60)
          return m ? `${h}h ${m}m` : `${h}h`
        })()

        return (
          <div className="space-y-4">

            {/* Summary bar */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 flex flex-col gap-1">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Clocked In Now</span>
                <span className="text-3xl font-bold text-green-600">{clockedInNow}</span>
                <span className="text-xs text-gray-400">
                  {clockedInNow === 1 ? 'employee currently working' : 'employees currently working'}
                </span>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 flex flex-col gap-1">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Total Hours Today</span>
                <span className="text-3xl font-bold text-blue-600">{hoursTodayFmt}</span>
                <span className="text-xs text-gray-400">across all employees (completed shifts)</span>
              </div>
            </div>

            {/* Filters + export + refresh */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">From</label>
                <input
                  type="date" value={filterFrom}
                  onChange={e => setFilterFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">To</label>
                <input
                  type="date" value={filterTo}
                  onChange={e => setFilterTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Employee</label>
                <select
                  value={filterEmp} onChange={e => setFilterEmp(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">All employees</option>
                  {empNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {hasFilters && (
                <button
                  onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterEmp('') }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors self-end pb-2"
                >
                  Clear filters
                </button>
              )}
              <div className="ml-auto self-end flex gap-2">
                <button
                  onClick={() => { fetchTimesheet(); fetchEmployees() }}
                  disabled={loadingTs}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                >
                  {loadingTs ? 'Refreshing…' : 'Refresh'}
                </button>
                <a
                  href={`${API}/timesheet/export`} download
                  className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors inline-block whitespace-nowrap"
                >
                  ↓ Export to Excel
                </a>
              </div>
            </div>

            {/* Table */}
            {loadingTs ? (
              <p className="text-sm text-gray-400">Loading time log…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                {entries.length === 0 ? 'No time entries yet.' : 'No entries match the current filters.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 font-medium">Employee</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Clock In</th>
                      <th className="px-4 py-3 font-medium">Lunch Out</th>
                      <th className="px-4 py-3 font-medium">Lunch In</th>
                      <th className="px-4 py-3 font-medium">Lunch Time</th>
                      <th className="px-4 py-3 font-medium">Clock Out</th>
                      <th className="px-4 py-3 font-medium">Hours Worked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(entry => {
                      const missing = !entry.clock_out
                      return (
                        <tr key={entry.id} className={`transition-colors ${
                          missing ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50'
                        }`}>
                          <td className="px-4 py-3 font-medium text-gray-800">{entry.employee_name}</td>
                          <td className="px-4 py-3 text-gray-600">{entry.date}</td>
                          <td className="px-4 py-3 text-gray-600">{fmtTime(entry.clock_in)}</td>
                          <td className="px-4 py-3 text-gray-600">{entry.lunch_out ? fmtTime(entry.lunch_out) : '—'}</td>
                          <td className="px-4 py-3 text-gray-600">{entry.lunch_in  ? fmtTime(entry.lunch_in)  : '—'}</td>
                          <td className="px-4 py-3 text-gray-600">{fmtMinutes(entry.lunch_minutes)}</td>
                          <td className="px-4 py-3 text-gray-600">{missing ? '—' : fmtTime(entry.clock_out)}</td>
                          <td className="px-4 py-3">
                            {missing ? (
                              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                Still working
                              </span>
                            ) : (
                              <span className="text-gray-600">
                                {fmtHours(entry.work_hours ?? entry.hours, false)}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                  <span className="text-xs text-gray-400">
                    {filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}
                    {hasFilters && ` (filtered from ${entries.length} total)`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
