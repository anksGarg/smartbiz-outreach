import { useRef, useState, useEffect } from 'react'

const API = 'https://smartbiz-outreach.onrender.com'
const PREVIEW_COLS = ['name', 'company', 'phone', 'email', 'address']
const PREVIEW_LABELS = { name: 'Name', company: 'Company', phone: 'Phone', email: 'Email', address: 'Address' }

function PropertyBadge({ value }) {
  if (!value) return <span className="text-gray-300">—</span>
  const lower = value.toLowerCase()
  const cls = lower === 'residential'
    ? 'bg-green-100 text-green-700'
    : 'bg-blue-100 text-blue-700'
  const label = lower === 'residential' ? 'Residential' : 'Commercial'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
}

function PriorityBadge({ value }) {
  if (!value) return <span className="text-gray-300">—</span>
  const cls = value === 'Tier 1' ? 'bg-red-100 text-red-700'
    : value === 'Tier 2' ? 'bg-yellow-100 text-yellow-800'
    : value === 'Tier 3' ? 'bg-gray-100 text-gray-500'
    : 'bg-gray-100 text-gray-500'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{value}</span>
}

const TEMPLATES = {
  'Storm Damage': (c) =>
    `Hi ${c.name || 'there'},\n\nWe noticed your ${c.property_type?.toLowerCase() || 'property'} at ${c.address || 'your location'} may have been impacted by recent storm activity. Our team specializes in fast, reliable roof and gutter repairs in Portland. We'd love to offer you a free damage assessment — no obligation.\n\nBest,\nWillamette Power Roofing`,

  'Gutter Cleaning': (c) =>
    `Hi ${c.name || 'there'},\n\nFall is right around the corner, and clogged gutters can cause serious water damage. We're scheduling gutter cleanings in your area and would love to help you get ahead of it.\n\nWould you be open to a quick quote? We're fast, tidy, and locally owned.\n\nBest,\nWillamette Power Roofing`,

  'Free Inspection': (c) =>
    `Hi ${c.name || 'there'},\n\nWe're offering free roof inspections for ${c.property_type?.toLowerCase() || 'property'} owners in the Portland area this month. It takes about 20 minutes and we'll give you a honest assessment — no pressure.\n\nWould you like to schedule a time?\n\nBest,\nWillamette Power Roofing`,

  'Check-In': (c) =>
    `Hi ${c.name || 'there'},\n\nJust checking in to see how things are going at ${c.company || c.address || 'your property'}. If you ever need roofing or gutter work, we're always happy to stop by for a look.\n\nHope all is well!\n\nBest,\nWillamette Power Roofing`,

  'Referral Ask': (c) =>
    `Hi ${c.name || 'there'},\n\nThank you for your continued trust in us! If you know anyone who needs roofing or gutter service in Portland, we'd really appreciate the referral. We take great care of everyone you send our way.\n\nThanks so much!\n\nWillamette Power Roofing`,
}

export default function Contacts() {
  const inputRef = useRef(null)
  const headerCheckRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [contacts, setContacts] = useState(null)  // null = still loading
  const [selected, setSelected] = useState(new Set())
  const [filter, setFilter] = useState('all')
  const [activeContact, setActiveContact] = useState(null)
  const [draft, setDraft] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)

  async function loadContacts() {
    try {
      const res = await fetch(`${API}/contacts`)
      if (res.ok) setContacts(await res.json())
    } catch {
      setContacts([])
    }
  }

  useEffect(() => { loadContacts() }, [])

  // Show upload automatically when there are no contacts yet
  useEffect(() => {
    if (contacts && contacts.length === 0) setShowUpload(true)
  }, [contacts])

  const filtered = contacts
    ? contacts
        .map((c, i) => ({ ...c, _idx: i }))
        .filter(c => filter === 'all' || (c.property_type || '').toLowerCase() === filter)
        .sort((a, b) => {
          const score = c => (c.phone ? 2 : 0) + (c.email ? 2 : 0) + (c.name ? 1 : 0)
          return score(b) - score(a)
        })
    : []

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c._idx))
  const someSelected = filtered.length > 0 && filtered.some(c => selected.has(c._idx))

  // Drive the indeterminate state on the header checkbox
  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = someSelected && !allSelected
    }
  }, [someSelected, allSelected])

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) {
        filtered.forEach(c => next.delete(c._idx))
      } else {
        filtered.forEach(c => next.add(c._idx))
      }
      return next
    })
  }

  function toggleRow(idx) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function openPanel(contact) {
    setActiveContact(contact)
    setDraft('')
    setDraftError(null)
    setSendResult(null)
  }

  function closePanel() {
    setActiveContact(null)
    setDraft('')
    setDraftError(null)
    setSendResult(null)
  }

  async function draftMessage() {
    if (!activeContact) return
    setDrafting(true)
    setDraftError(null)
    try {
      const res = await fetch(`${API}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: activeContact.name || '',
          company: activeContact.company || '',
          phone: activeContact.phone || '',
          email: activeContact.email || '',
          address: activeContact.address || '',
          property_type: activeContact.property_type || '',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not generate draft.')
      }
      const data = await res.json()
      setDraft(data.message)
    } catch (e) {
      setDraftError(e.message)
    } finally {
      setDrafting(false)
    }
  }

  async function sendEmail() {
    if (!activeContact || !draft.trim()) return
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch(`${API}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: activeContact.name || '',
          company: activeContact.company || '',
          email: activeContact.email || '',
          message: draft,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Send failed.')
      }
      const data = await res.json()
      setSendResult({ type: 'success', message: `Sent to ${data.sent_to}` })
    } catch (e) {
      setSendResult({ type: 'error', message: e.message })
    } finally {
      setSending(false)
    }
  }

  async function handleFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['csv', 'xlsx'].includes(ext)) {
      setStatus({ type: 'error', message: 'Please upload a .csv or .xlsx file.' })
      return
    }
    setStatus(null)
    setLoading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/contacts/preview`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not read file.')
      }
      setPreview({ ...await res.json(), file })
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!preview?.file) return
    setLoading(true)
    setStatus(null)
    try {
      const form = new FormData()
      form.append('file', preview.file)
      const res = await fetch(`${API}/contacts/import`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Import failed.')
      }
      const data = await res.json()
      setStatus({
        type: 'success',
        message: `Done! ${data.imported} contact${data.imported !== 1 ? 's' : ''} imported, ${data.skipped} skipped (duplicate email).`,
      })
      setPreview(null)
      setShowUpload(false)
      if (inputRef.current) inputRef.current.value = ''
      loadContacts()
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
    }
  }

  function handleCancelUpload() {
    setPreview(null)
    setStatus(null)
    if (inputRef.current) inputRef.current.value = ''
    if (contacts && contacts.length > 0) setShowUpload(false)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  // ── Upload / preview view ─────────────────────────────────────────────────
  if (showUpload || preview) {
    return (
      <div className="max-w-5xl">
        <div className="flex items-center gap-4 mb-6">
          {contacts && contacts.length > 0 && (
            <button
              onClick={handleCancelUpload}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          )}
          <h1 className="text-2xl font-semibold text-gray-800">
            {contacts && contacts.length > 0 ? 'Import More Contacts' : 'Import Contacts'}
          </h1>
        </div>

        {!preview && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
              ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50'}`}
          >
            <div className="text-4xl mb-3">📂</div>
            <p className="text-gray-700 font-medium">
              {loading ? 'Reading file…' : 'Click to choose a file, or drag it here'}
            </p>
            <p className="text-gray-400 text-sm mt-1">Accepts .csv and .xlsx</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => handleFile(e.target.files[0])}
            />
          </div>
        )}

        {status && (
          <div className={`mt-4 px-4 py-3 rounded-lg text-sm font-medium
            ${status.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {status.message}
          </div>
        )}

        {preview && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-700 font-medium">
                Preview — {preview.total} contact{preview.total !== 1 ? 's' : ''} found
                {preview.total > 100 && ' (showing first 100)'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleCancelUpload}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Importing…' : 'Import Contacts'}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    {PREVIEW_COLS.map(col => (
                      <th key={col} className="px-4 py-3 font-medium">{PREVIEW_LABELS[col]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      {PREVIEW_COLS.map(col => (
                        <td key={col} className="px-4 py-2 text-gray-700 max-w-xs truncate">
                          {row[col] || <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Main contacts list ────────────────────────────────────────────────────
  return (
    <div className="flex gap-6 items-start max-w-full">
    <div className="flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Contacts</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {contacts === null ? 'Loading…' : `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => { setShowUpload(true); setStatus(null) }}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
        >
          + Import More
        </button>
      </div>

      {/* Status banner */}
      {status && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium
          ${status.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {status.message}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[['all', 'All'], ['commercial', 'Commercial'], ['residential', 'Residential']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => { setFilter(val); setSelected(new Set()) }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${filter === val ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <span className="text-sm text-gray-500">{selected.size} selected</span>
          )}
          <button
            disabled={selected.size === 0}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send Campaign
          </button>
        </div>
      </div>

      {/* Table */}
      {contacts === null ? (
        <p className="text-gray-400 text-sm py-8">Loading contacts…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg font-medium mb-1">No contacts yet</p>
          <p className="text-sm">Import a spreadsheet to get started.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    ref={headerCheckRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Name / Address</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Property Type</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Last Contacted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((row) => (
                <tr
                  key={row._idx}
                  onClick={() => openPanel(row)}
                  className={`cursor-pointer transition-colors
                    ${activeContact?._idx === row._idx ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : selected.has(row._idx) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(row._idx)}
                      onChange={() => toggleRow(row._idx)}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <p className="font-medium text-gray-800 truncate">
                      {row.name || <span className="font-normal text-gray-300">—</span>}
                    </p>
                    {row.address && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{row.address}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate">
                    {row.company || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {row.phone || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">
                    {row.email || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <PropertyBadge value={row.property_type} />
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge value={row.priority_tier} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.last_contacted
                      ? <span className="text-gray-700">{row.last_contacted}</span>
                      : <span className="text-gray-400">Never</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    {/* ── Side panel ─────────────────────────────────────────────────────── */}
    {activeContact && (
      <div className="w-80 shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
        {/* Panel header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-100">
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 truncate">{activeContact.name || '—'}</p>
            <p className="text-sm text-gray-500 truncate">{activeContact.company || '—'}</p>
          </div>
          <button
            onClick={closePanel}
            className="ml-2 text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Contact details */}
        <div className="p-4 border-b border-gray-100 space-y-1.5 text-sm text-gray-600">
          {activeContact.phone && <p><span className="text-gray-400">Phone</span> {activeContact.phone}</p>}
          {activeContact.email && <p><span className="text-gray-400">Email</span> {activeContact.email}</p>}
          {activeContact.address && <p><span className="text-gray-400">Address</span> {activeContact.address}</p>}
          <div className="flex gap-2 pt-1">
            {activeContact.property_type && <PropertyBadge value={activeContact.property_type} />}
            {activeContact.priority_tier && <PriorityBadge value={activeContact.priority_tier} />}
          </div>
        </div>

        {/* Draft area */}
        <div className="p-4 flex flex-col gap-3 flex-1">
          <button
            onClick={draftMessage}
            disabled={drafting}
            className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {drafting ? 'Drafting…' : '✦ Draft Message'}
          </button>

          {/* Template buttons */}
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(TEMPLATES).map(label => (
              <button
                key={label}
                onClick={() => setDraft(TEMPLATES[label](activeContact))}
                className="px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {draftError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{draftError}</p>
          )}

          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Click 'Draft Message' to generate an AI draft, or pick a template above…"
            rows={10}
            className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 placeholder-gray-300"
          />

          {sendResult && (
            <p className={`text-xs rounded px-3 py-2 border ${sendResult.type === 'success' ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-600 bg-red-50 border-red-200'}`}>
              {sendResult.message}
            </p>
          )}

          <button
            onClick={sendEmail}
            disabled={sending || !draft.trim()}
            className="w-full py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    )}
    </div>
  )
}
