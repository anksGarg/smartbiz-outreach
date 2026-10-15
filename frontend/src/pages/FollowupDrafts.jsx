import { useState, useEffect } from 'react'
import { API_URL as API } from '../config'

const TIMEOUT_MSG = 'Something went wrong. Please try again.'
const CATEGORIES = ['Re-Roofing', 'Gutter Cleaning', 'Pressure Washing']
const SAMPLE_SLOTS = [
  { key: 'with_reroofing',    label: 'Has previous re-roofing', hasReroofing: true },
  { key: 'without_reroofing', label: 'No previous re-roofing',  hasReroofing: false },
]
const TEMPLATE_OPTIONS = [
  { value: 'with_reroofing',    label: 'Re-roofing customer (no replacement section)' },
  { value: 'without_reroofing', label: 'No re-roofing (adds roof-life and warranty section)' },
]
const SEND_CAP = 50
const CHUNK_SIZE = 5

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

function defaultTemplate(row) {
  return row.has_reroofing ? 'with_reroofing' : 'without_reroofing'
}

// Splits items into fixed-size chunks, preserving order.
function chunkItems(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// De-dupes by email (case-insensitive), keeping the first occurrence. Returns
// the kept items plus a skipped-reason entry for every later duplicate.
function dedupeByEmail(items) {
  const seen = new Set()
  const kept = []
  const dupSkipped = []
  for (const it of items) {
    const key = (it.email || '').trim().toLowerCase()
    if (key && seen.has(key)) {
      dupSkipped.push({ name: (it.name || '').trim() || '(no name)', reason: 'duplicate email in this request' })
      continue
    }
    if (key) seen.add(key)
    kept.push(it)
  }
  return { kept, dupSkipped }
}

export default function FollowupDrafts() {
  // Uploaded list — lives only in this component's state, never saved anywhere.
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [filterCategory, setFilterCategory] = useState('')

  // Generated samples — { [slotKey]: {subject, body_text, body_html, customerName} }. Edits here are local only.
  const [drafts, setDrafts] = useState({})
  const [draftErrors, setDraftErrors] = useState({})
  const [generating, setGenerating] = useState(false)

  // Per-row selection + template choice, keyed by row._idx. Template defaults
  // from has_reroofing but the owner can override it per customer.
  const [selected, setSelected] = useState(new Set())
  const [rowTemplates, setRowTemplates] = useState({})

  // Send mode, fetched once so the confirm dialog shows the real test
  // recipient instead of a hardcoded address.
  const [sendMode, setSendMode] = useState(null)
  const [sendModeError, setSendModeError] = useState(null)

  // Send result — in memory only, cleared on next upload.
  const [sending, setSending] = useState(false)
  const [sendProgress, setSendProgress] = useState(null) // {done, total}
  const [sendError, setSendError] = useState(null)
  const [sendResult, setSendResult] = useState(null)

  // The raw File from the last upload — kept so "Save to Sheet" can re-send
  // it to /customers/save. Cleared when loading the saved list instead.
  const [uploadedFile, setUploadedFile] = useState(null)
  const [customersStatus, setCustomersStatus] = useState(null) // {label, saved_rows, imported_at}
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [loadSavedError, setLoadSavedError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveMessage, setSaveMessage] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchTimeout(`${API}/followup/send-mode`)
        if (!res.ok) throw new Error()
        setSendMode(await res.json())
      } catch {
        setSendModeError('Could not check send mode')
      }
    })()
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchTimeout(`${API}/customers/status`)
        if (!res.ok) throw new Error()
        setCustomersStatus(await res.json())
      } catch {
        // Badge/"Load saved list" just won't show — not a blocking error.
      }
    })()
  }, [])

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
      setRows((data.rows || []).map((r, i) => ({ ...r, _idx: i })))
      setFileName(file.name)
      setUploadedFile(file)
      setDrafts({})
      setDraftErrors({})
      setSelected(new Set())
      setRowTemplates({})
      setSendResult(null)
      setSendError(null)
      setSendProgress(null)
      setSaveMessage(null)
      setSaveError(null)
    } catch (e) {
      setUploadError(errMsg(e))
    } finally {
      setUploading(false)
    }
  }

  async function loadSavedList() {
    setLoadingSaved(true)
    setLoadSavedError(null)
    try {
      const res = await fetchTimeout(`${API}/followup/preview-saved`, {}, 20000)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not load saved list.')
      }
      const data = await res.json()
      setRows((data.rows || []).map((r, i) => ({ ...r, _idx: i })))
      setFileName('(saved list)')
      setUploadedFile(null)
      setDrafts({})
      setDraftErrors({})
      setSelected(new Set())
      setRowTemplates({})
      setSendResult(null)
      setSendError(null)
      setSendProgress(null)
      setSaveMessage(null)
      setSaveError(null)
    } catch (e) {
      setLoadSavedError(errMsg(e))
    } finally {
      setLoadingSaved(false)
    }
  }

  async function saveToSheet() {
    if (!uploadedFile) return
    const currentRows = customersStatus?.saved_rows ?? 0
    const label = customersStatus?.label || 'the'
    const confirmMsg = currentRows
      ? `This replaces the saved list (${currentRows} rows) in the ${label} sheet. Continue?`
      : `Save ${rows.length} rows to the ${label} sheet?`
    const ok = window.confirm(confirmMsg)
    if (!ok) return

    setSaving(true)
    setSaveError(null)
    setSaveMessage(null)
    try {
      const form = new FormData()
      form.append('file', uploadedFile)
      const res = await fetchTimeout(`${API}/customers/save`, { method: 'POST', body: form }, 30000)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not save to Sheet.')
      }
      const data = await res.json()
      setSaveMessage(`Saved ${data.saved_rows} rows`)
      setCustomersStatus(prev => ({
        ...(prev || {}),
        label: data.label,
        saved_rows: data.saved_rows,
        imported_at: new Date().toISOString(),
      }))
    } catch (e) {
      setSaveError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const filtered = filterCategory
    ? rows.filter(r => (r.last_service || '').trim() === filterCategory)
    : rows

  // Rows sharing an email with another row (case-insensitive) — flagged in the table.
  const emailCounts = {}
  rows.forEach(r => {
    const key = (r.email || '').trim().toLowerCase()
    if (key) emailCounts[key] = (emailCounts[key] || 0) + 1
  })
  function isDuplicateEmail(row) {
    const key = (row.email || '').trim().toLowerCase()
    return Boolean(key) && emailCounts[key] > 1
  }

  function getTemplate(row) {
    return rowTemplates[row._idx] ?? defaultTemplate(row)
  }
  function setTemplate(idx, value) {
    setRowTemplates(prev => ({ ...prev, [idx]: value }))
  }

  function toggleRow(idx) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(r => selected.has(r._idx))
  function toggleSelectAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        filtered.forEach(r => next.delete(r._idx))
      } else {
        filtered.forEach(r => next.add(r._idx))
      }
      return next
    })
  }

  const selectedCount = selected.size
  const overCap = selectedCount > SEND_CAP

  async function generateSamples() {
    setGenerating(true)
    const nextDrafts = {}
    const nextErrors = {}
    await Promise.all(SAMPLE_SLOTS.map(async (slot) => {
      const customer = rows.find(r => Boolean(r.has_reroofing) === slot.hasReroofing)
      if (!customer) {
        nextErrors[slot.key] = 'No matching customer found in the uploaded file.'
        return
      }
      try {
        const res = await fetchTimeout(`${API}/followup/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: customer.name,
            last_service: customer.last_service,
            last_service_date: customer.last_service_date,
            has_reroofing: customer.has_reroofing,
            reroofing_last_date: customer.reroofing_last_date,
            business_signal: customer.business_signal,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || 'Could not generate draft.')
        }
        const data = await res.json()
        nextDrafts[slot.key] = { ...data, customerName: customer.name }
      } catch (e) {
        nextErrors[slot.key] = errMsg(e)
      }
    }))
    setDrafts(prev => ({ ...prev, ...nextDrafts }))
    setDraftErrors(nextErrors)
    setGenerating(false)
  }

  function updateDraftField(cat, field, value) {
    setDrafts(prev => ({ ...prev, [cat]: { ...prev[cat], [field]: value } }))
  }

  async function sendEmails() {
    const rawItems = rows
      .filter(r => selected.has(r._idx))
      .map(r => ({
        name: r.name,
        email: r.email,
        last_service: r.last_service,
        last_service_date: r.last_service_date,
        has_reroofing: r.has_reroofing,
        reroofing_last_date: r.reroofing_last_date,
        business_signal: r.business_signal,
        template: getTemplate(r),
      }))
    if (rawItems.length === 0 || rawItems.length > SEND_CAP) return

    const confirmMsg = sendMode?.mode === 'test'
      ? `Send ${rawItems.length} email${rawItems.length !== 1 ? 's' : ''}? In DEV all will be sent to ${sendMode.test_recipient}, not to the customers.`
      : `Send ${rawItems.length} email${rawItems.length !== 1 ? 's' : ''}?`
    if (!window.confirm(confirmMsg)) return

    const { kept, dupSkipped } = dedupeByEmail(rawItems)
    const chunks = chunkItems(kept, CHUNK_SIZE)
    const merged = { mode: sendMode?.mode || 'test', sent: [], skipped: [...dupSkipped], failed: [] }

    setSending(true)
    setSendError(null)
    setSendResult(null)
    setSendProgress({ done: 0, total: kept.length })

    try {
      for (const chunk of chunks) {
        try {
          const res = await fetchTimeout(`${API}/followup/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: chunk }),
          }, 60000)
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.detail || 'Could not send emails.')
          }
          const data = await res.json()
          merged.mode = data.mode
          merged.sent.push(...data.sent)
          merged.skipped.push(...data.skipped)
          merged.failed.push(...data.failed)
        } catch (e) {
          setSendError(errMsg(e))
          break // stop sending further chunks on a hard failure
        }
        setSendProgress(prev => ({ done: (prev?.done || 0) + chunk.length, total: kept.length }))
      }
    } finally {
      setSendResult(merged)
      setSending(false)
    }
  }

  function rowSendStatus(row) {
    if (!sendResult) return null
    const name = (row.name || '').trim() || '(no name)'
    if (sendResult.sent.includes(name)) return { status: 'sent' }
    const sk = sendResult.skipped.find(s => s.name === name)
    if (sk) return { status: 'skipped', reason: sk.reason }
    const fl = sendResult.failed.find(f => f.name === name)
    if (fl) return { status: 'failed', reason: fl.error }
    return null
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold text-gray-800">Follow-up Drafts</h1>
          {customersStatus && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              (customersStatus.label || '').toUpperCase() === 'PROD'
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}>
              Data: {customersStatus.label}
            </span>
          )}
        </div>
        <p className="text-gray-500 text-sm mt-0.5">
          Upload a past-customer list and generate sample follow-up email drafts. Uploads are saved only when you click Save to Sheet. Drafts are never saved.
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

        {customersStatus && customersStatus.saved_rows > 0 && (
          <div className="mt-3">
            <button
              onClick={loadSavedList}
              disabled={loadingSaved}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              {loadingSaved
                ? 'Loading…'
                : `Load saved list (${customersStatus.saved_rows} customers, saved ${
                    customersStatus.imported_at ? new Date(customersStatus.imported_at).toLocaleString() : 'unknown'
                  })`}
            </button>
            {loadSavedError && <p className="mt-2 text-sm text-red-600">{loadSavedError}</p>}
          </div>
        )}

        {uploadedFile && (
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveToSheet}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save to Sheet'}
            </button>
            {saveMessage && <p className="text-sm text-green-700">{saveMessage}</p>}
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <>
          {/* Generate samples — above the customer list */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-gray-800">Sample Drafts</h2>
            <button
              onClick={generateSamples}
              disabled={generating}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {generating ? 'Generating…' : 'Generate samples'}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {SAMPLE_SLOTS.map(slot => (
              <div key={slot.key} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-gray-800">{slot.label}</h3>
                {draftErrors[slot.key] && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{draftErrors[slot.key]}</p>
                )}
                {drafts[slot.key] ? (
                  <>
                    <p className="text-xs text-gray-400">For {drafts[slot.key].customerName}</p>
                    <label className="text-xs text-gray-500 font-medium">Subject</label>
                    <input
                      value={drafts[slot.key].subject}
                      onChange={e => updateDraftField(slot.key, 'subject', e.target.value)}
                      className="w-full text-sm font-medium text-gray-800 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <label className="text-xs text-gray-500 font-medium mt-1">Plain text</label>
                    <textarea
                      value={drafts[slot.key].body_text}
                      onChange={e => updateDraftField(slot.key, 'body_text', e.target.value)}
                      rows={14}
                      className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <label className="text-xs text-gray-500 font-medium mt-1">HTML preview</label>
                    <div
                      className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-80 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: drafts[slot.key].body_html }}
                    />
                  </>
                ) : !draftErrors[slot.key] && (
                  <p className="text-xs text-gray-400">Click "Generate samples" to draft a message for this case.</p>
                )}
              </div>
            ))}
          </div>

          {/* Filter */}
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
            <div className="text-sm text-gray-500">
              {selectedCount} selected
              {overCap && (
                <span className="ml-2 text-red-600 font-medium">
                  — max {SEND_CAP} per send, deselect {selectedCount - SEND_CAP}
                </span>
              )}
            </div>
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
                  <th className="px-4 py-3 font-medium">Template</th>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((r) => {
                  const dup = isDuplicateEmail(r)
                  const status = rowSendStatus(r)
                  return (
                    <tr key={r._idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800 font-medium">
                        {r.name || '—'}
                        {status && (
                          <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${
                            status.status === 'sent' ? 'bg-green-100 text-green-700' :
                            status.status === 'skipped' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`} title={status.reason || ''}>
                            {status.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {r.email || '—'}
                        {dup && (
                          <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                            duplicate email
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.address || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{r.property_type || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{r.last_service || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{r.last_service_date || '—'}</td>
                      <td className="px-4 py-3">
                        <select
                          value={getTemplate(r)}
                          onChange={e => setTemplate(r._idx, e.target.value)}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                          {TEMPLATE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(r._idx)}
                          onChange={() => toggleRow(r._idx)}
                          className="rounded border-gray-300 text-blue-600 cursor-pointer"
                        />
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">No customers match this filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Send */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={sendEmails}
              disabled={selectedCount === 0 || overCap || sending || !!sendModeError || !sendMode}
              className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {sending ? 'Sending…' : 'Send Email'}
            </button>
            {sending && sendProgress && (
              <p className="text-sm text-gray-500">Sent {sendProgress.done} of {sendProgress.total}</p>
            )}
            {sendModeError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{sendModeError}</p>
            )}
            {sendError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{sendError}</p>
            )}
          </div>

          {sendResult && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-700">
              <p className="font-medium mb-1">
                Mode: {sendResult.mode} — {sendResult.sent.length} sent, {sendResult.skipped.length} skipped, {sendResult.failed.length} failed.
              </p>
              {sendResult.skipped.length > 0 && (
                <p className="text-amber-700 text-xs mt-1">
                  Skipped: {sendResult.skipped.map(s => `${s.name} (${s.reason})`).join(', ')}
                </p>
              )}
              {sendResult.failed.length > 0 && (
                <p className="text-red-700 text-xs mt-1">
                  Failed: {sendResult.failed.map(f => `${f.name} (${f.error})`).join(', ')}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
