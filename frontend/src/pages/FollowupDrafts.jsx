import { useState } from 'react'
import { API_URL as API } from '../config'

const TIMEOUT_MSG = 'Something went wrong. Please try again.'
const CATEGORIES = ['Re-Roofing', 'Gutter Cleaning', 'Pressure Washing']

// Wraps fetch with a timeout so a hung backend can't leave the UI stuck loading forever.
async function fetchTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(tid)
  }
}

function errMsg(e) {
  return e.name === 'AbortError' ? TIMEOUT_MSG : e.message
}

export default function FollowupDrafts() {
  // Uploaded list — lives only in this component's state, never saved anywhere.
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [filterCategory, setFilterCategory] = useState('')

  // Generated drafts — { [category]: {subject, body, customerName} }. Edits here are local only.
  const [drafts, setDrafts] = useState({})
  const [draftErrors, setDraftErrors] = useState({})
  const [generating, setGenerating] = useState(false)

  async function handleFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx'].includes(ext)) {
      setUploadError('Please upload a .csv or .xlsx file.')
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetchTimeout(`${API}/followup/preview`, { method: 'POST', body: form }, 20000)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not read file.')
      }
      const data = await res.json()
      setRows(data.rows || [])
      setFileName(file.name)
      setDrafts({})
      setDraftErrors({})
    } catch (e) {
      setUploadError(errMsg(e))
    } finally {
      setUploading(false)
    }
  }

  const filtered = filterCategory
    ? rows.filter(r => (r.last_service || '').trim() === filterCategory)
    : rows

  async function generateSamples() {
    setGenerating(true)
    const nextDrafts = {}
    const nextErrors = {}
    await Promise.all(CATEGORIES.map(async (cat) => {
      const customer = rows.find(r => (r.last_service || '').trim() === cat)
      if (!customer) {
        nextErrors[cat] = 'No customer found for this category in the uploaded file.'
        return
      }
      try {
        const res = await fetchTimeout(`${API}/followup/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: customer.name,
            last_service: cat,
            last_service_date: customer.last_service_date,
            address: customer.address,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || 'Could not generate draft.')
        }
        const data = await res.json()
        nextDrafts[cat] = { ...data, customerName: customer.name }
      } catch (e) {
        nextErrors[cat] = errMsg(e)
      }
    }))
    setDrafts(prev => ({ ...prev, ...nextDrafts }))
    setDraftErrors(nextErrors)
    setGenerating(false)
  }

  function updateDraftField(cat, field, value) {
    setDrafts(prev => ({ ...prev, [cat]: { ...prev[cat], [field]: value } }))
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Follow-up Drafts</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Upload a past-customer list and generate sample follow-up email drafts. Nothing on this page is saved or sent.
        </p>
      </div>

      {/* Upload */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Upload Customer List</h2>
        <p className="text-xs text-gray-400 mb-4">
          Columns expected: Name, Email, Address, Property Type, Last Service (of 3), Last Service Date.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={e => handleFile(e.target.files[0])}
          className="text-sm"
        />
        {uploading && <p className="mt-2 text-sm text-gray-400">Reading file…</p>}
        {uploadError && <p className="mt-2 text-sm text-red-600">{uploadError}</p>}
        {fileName && !uploading && !uploadError && (
          <p className="mt-2 text-sm text-gray-500">{fileName} — {rows.length} customer{rows.length !== 1 ? 's' : ''} loaded</p>
        )}
      </div>

      {rows.length > 0 && (
        <>
          {/* Filter + generate */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              {['', ...CATEGORIES].map(cat => (
                <button
                  key={cat || 'all'}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    filterCategory === cat ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {cat || 'All'}
                </button>
              ))}
            </div>
            <button
              onClick={generateSamples}
              disabled={generating}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {generating ? 'Generating…' : 'Generate sample'}
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Property Type</th>
                  <th className="px-4 py-3 font-medium">Last Service</th>
                  <th className="px-4 py-3 font-medium">Last Service Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800 font-medium">{r.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.address || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.property_type || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.last_service || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.last_service_date || '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No customers match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Drafts */}
          <div className="grid gap-4 md:grid-cols-3">
            {CATEGORIES.map(cat => (
              <div key={cat} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-gray-800">{cat}</h3>
                {draftErrors[cat] && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{draftErrors[cat]}</p>
                )}
                {drafts[cat] ? (
                  <>
                    <p className="text-xs text-gray-400">For {drafts[cat].customerName}</p>
                    <input
                      value={drafts[cat].subject}
                      onChange={e => updateDraftField(cat, 'subject', e.target.value)}
                      className="w-full text-sm font-medium text-gray-800 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <textarea
                      value={drafts[cat].body}
                      onChange={e => updateDraftField(cat, 'body', e.target.value)}
                      rows={10}
                      className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </>
                ) : !draftErrors[cat] && (
                  <p className="text-xs text-gray-400">Click "Generate sample" to draft a message for this category.</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
