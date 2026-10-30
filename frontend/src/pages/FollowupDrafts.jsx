import { useState, useEffect, useRef } from 'react'
import { API_URL as API } from '../config'
import { sendConfirmText, useBannerSendMode } from '../envInfo'
import SendBar from '../components/SendBar'

const FOLLOWUP_PLACEHOLDERS = [
  { token: '{{first_name}}', note: null },
  { token: '{{full_name}}', note: null },
  { token: '{{service_phrase}}', note: '"gutter cleaning in 2024", or just "gutter cleaning" if no year — use this if unsure' },
  { token: '{{service}}', note: 'can be empty for some customers' },
  { token: '{{year}}', note: 'can be empty for some customers' },
  { token: '{{reroofing_year}}', note: 'always re-roofing\'s own year, even on the with-re-roofing template; can be empty' },
]

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
// Same rule as the backend's _FOLLOWUP_EMAIL_RE (main.py).
const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/

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

// The customer fields /followup/draft and /followup/send both need.
function customerFollowupFields(customer) {
  return {
    name: customer.name,
    last_service: customer.last_service,
    last_service_date: customer.last_service_date,
    has_reroofing: customer.has_reroofing,
    reroofing_last_date: customer.reroofing_last_date,
    business_signal: customer.business_signal,
  }
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

  // Generated samples — { [slotKey]: {subject, template_subject, template_text, body_text, body_html, customerName} }.
  const [drafts, setDrafts] = useState({})
  const [draftErrors, setDraftErrors] = useState({})
  const [generating, setGenerating] = useState(false)

  // The owner's current edited Subject / whole-body template per template —
  // raw placeholder text, e.g. "...trusting us with your {{service_phrase}}..."
  // — these are what actually get sent (see sendEmails()). Edits apply to
  // EVERY customer who gets that template, not just the one being previewed.
  // Lives only in this component's state — lost on refresh, never saved.
  const [editedSubject, setEditedSubject] = useState({})
  const [editedText, setEditedText] = useState({})
  // The server's own defaults, captured once per slot (on first generate or
  // "Reset to default"), so we can tell whether a slot is actually edited
  // right now vs. still showing the untouched default.
  const [defaultSubject, setDefaultSubject] = useState({})
  const [defaultText, setDefaultText] = useState({})
  // Which row (by _idx) is chosen in each slot's "Preview for" selector —
  // falls back to the first matching candidate (see previewCandidates) when
  // unset or no longer a valid candidate.
  const [previewRowIdx, setPreviewRowIdx] = useState({})
  const [resettingSlot, setResettingSlot] = useState(null)
  // Which field (subject/text) last had focus per slot — placeholder insert
  // buttons type into whichever one that is.
  const [focusedField, setFocusedField] = useState({})
  const fieldRefs = useRef({})

  // Per-row selection + template choice, keyed by row._idx. Template defaults
  // from has_reroofing but the owner can override it per customer.
  const [selected, setSelected] = useState(new Set())
  const [rowTemplates, setRowTemplates] = useState({})

  // Send mode, fetched once so the confirm dialog shows the real test
  // recipient instead of a hardcoded address.
  const [sendMode, setSendMode] = useState(null)
  const [sendModeError, setSendModeError] = useState(null)
  useBannerSendMode(sendMode, sendModeError)

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
      setEditedSubject({})
      setEditedText({})
      setDefaultSubject({})
      setDefaultText({})
      setPreviewRowIdx({})
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
      setEditedSubject({})
      setEditedText({})
      setDefaultSubject({})
      setDefaultText({})
      setPreviewRowIdx({})
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

  // "Select all" targets: rows in the current filter that would actually be
  // sent — a valid email, and only the first row per email (later rows with
  // the same email are skipped at send time anyway, see dedupeByEmail).
  const eligibleFiltered = []
  const eligibleEmails = new Set()
  filtered.forEach(r => {
    const email = (r.email || '').trim()
    const key = email.toLowerCase()
    if (!EMAIL_RE.test(email) || eligibleEmails.has(key)) return
    eligibleEmails.add(key)
    eligibleFiltered.push(r)
  })
  function selectAllEligible() {
    setSelected(new Set(eligibleFiltered.map(r => r._idx)))
  }
  function clearSelection() {
    setSelected(new Set())
  }

  const selectedCount = selected.size
  const overCap = selectedCount > SEND_CAP
  const filteredIdx = new Set(filtered.map(r => r._idx))
  const hiddenSelectedCount = [...selected].filter(idx => !filteredIdx.has(idx)).length
  const selectedDuplicateCount = dedupeByEmail(rows.filter(r => selected.has(r._idx))).dupSkipped.length

  // Candidates for a slot's "Preview for" selector: selected rows resolving
  // to this slot's template, or — when none are selected yet — any row
  // matching the old sample-picking rule (has_reroofing).
  function previewCandidates(slot) {
    const selectedForSlot = rows.filter(r => selected.has(r._idx) && getTemplate(r) === slot.key)
    if (selectedForSlot.length > 0) return selectedForSlot
    return rows.filter(r => Boolean(r.has_reroofing) === slot.hasReroofing)
  }

  // The customer currently chosen for a slot's preview: the selector's
  // choice if it's still a valid candidate, else the first candidate.
  function currentPreviewCustomer(slot) {
    const candidates = previewCandidates(slot)
    if (candidates.length === 0) return null
    const chosen = candidates.find(r => r._idx === previewRowIdx[slot.key])
    return chosen || candidates[0]
  }

  // Fetches a preview for one slot. When includeCustom is true and the slot
  // already has edited text/subject, those are sent so the preview reflects
  // the edit; otherwise the server's own default is requested (used for the
  // very first preview of a slot, and by "Reset to default").
  async function fetchDraftPreview(slot, customer, { includeCustom }) {
    const body = { ...customerFollowupFields(customer), template: slot.key }
    if (includeCustom) {
      if (editedText[slot.key] !== undefined) body.custom_text = editedText[slot.key]
      if (editedSubject[slot.key] !== undefined) body.custom_subject = editedSubject[slot.key]
    }
    const res = await fetchTimeout(`${API}/followup/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Could not generate draft.')
    }
    return res.json()
  }

  async function generateSamples() {
    setGenerating(true)
    const nextDrafts = {}
    const nextErrors = {}
    const nextDefaultSubject = {}
    const nextDefaultText = {}
    const nextEditedSubject = {}
    const nextEditedText = {}
    await Promise.all(SAMPLE_SLOTS.map(async (slot) => {
      const customer = currentPreviewCustomer(slot)
      if (!customer) {
        nextErrors[slot.key] = 'No matching customer found in the uploaded file.'
        return
      }
      try {
        // First time this slot is generated, fetch the server's default
        // (no custom_text/custom_subject) so the owner sees — and can
        // edit — the real placeholder template, not an empty box. Later
        // re-generates (e.g. after re-uploading a different file) preserve edits.
        const isFirstGenerate = editedText[slot.key] === undefined
        const data = await fetchDraftPreview(slot, customer, { includeCustom: !isFirstGenerate })
        nextDrafts[slot.key] = { ...data, customerName: customer.name }
        if (isFirstGenerate) {
          nextDefaultSubject[slot.key] = data.template_subject
          nextDefaultText[slot.key] = data.template_text
          nextEditedSubject[slot.key] = data.template_subject
          nextEditedText[slot.key] = data.template_text
        }
      } catch (e) {
        nextErrors[slot.key] = errMsg(e)
      }
    }))
    setDrafts(prev => ({ ...prev, ...nextDrafts }))
    setDraftErrors(nextErrors)
    setDefaultSubject(prev => ({ ...prev, ...nextDefaultSubject }))
    setDefaultText(prev => ({ ...prev, ...nextDefaultText }))
    setEditedSubject(prev => ({ ...prev, ...nextEditedSubject }))
    setEditedText(prev => ({ ...prev, ...nextEditedText }))
    setGenerating(false)
  }

  async function resetToDefault(slotKey) {
    const slot = SAMPLE_SLOTS.find(s => s.key === slotKey)
    const customer = slot && currentPreviewCustomer(slot)
    if (!slot || !customer) return
    setResettingSlot(slotKey)
    try {
      const data = await fetchDraftPreview(slot, customer, { includeCustom: false })
      setDrafts(prev => ({ ...prev, [slotKey]: { ...data, customerName: customer.name } }))
      setDefaultSubject(prev => ({ ...prev, [slotKey]: data.template_subject }))
      setDefaultText(prev => ({ ...prev, [slotKey]: data.template_text }))
      setEditedSubject(prev => ({ ...prev, [slotKey]: data.template_subject }))
      setEditedText(prev => ({ ...prev, [slotKey]: data.template_text }))
      setDraftErrors(prev => ({ ...prev, [slotKey]: undefined }))
    } catch (e) {
      setDraftErrors(prev => ({ ...prev, [slotKey]: errMsg(e) }))
    } finally {
      setResettingSlot(null)
    }
  }

  // Debounced (~500ms) re-preview whenever the owner edits Subject/the body
  // template, or changes which customer a slot is previewing, for any slot
  // that's already been generated at least once.
  useEffect(() => {
    const slotsToRefresh = SAMPLE_SLOTS
      .map(slot => ({ slot, customer: currentPreviewCustomer(slot) }))
      .filter(({ slot, customer }) => customer && drafts[slot.key])
    if (slotsToRefresh.length === 0) return
    const tid = setTimeout(() => {
      slotsToRefresh.forEach(async ({ slot, customer }) => {
        try {
          const data = await fetchDraftPreview(slot, customer, { includeCustom: true })
          setDrafts(prev => ({ ...prev, [slot.key]: { ...data, customerName: customer.name } }))
          setDraftErrors(prev => ({ ...prev, [slot.key]: undefined }))
        } catch (e) {
          setDraftErrors(prev => ({ ...prev, [slot.key]: errMsg(e) }))
        }
      })
    }, 500)
    return () => clearTimeout(tid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedText, editedSubject, previewRowIdx, selected, rows])

  function insertPlaceholder(slotKey, token) {
    const field = focusedField[slotKey] || 'text'
    const setter = field === 'subject' ? setEditedSubject : setEditedText
    const current = (field === 'subject' ? editedSubject[slotKey] : editedText[slotKey]) ?? ''
    const el = fieldRefs.current[`${slotKey}_${field}`]
    if (!el) {
      setter(prev => ({ ...prev, [slotKey]: current + token }))
      return
    }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    setter(prev => ({ ...prev, [slotKey]: next }))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  function isSlotEdited(slotKey) {
    return editedSubject[slotKey] !== undefined && (
      editedSubject[slotKey] !== defaultSubject[slotKey] || editedText[slotKey] !== defaultText[slotKey]
    )
  }

  async function sendEmails() {
    const selectedRows = rows.filter(r => selected.has(r._idx))
    const rawItems = selectedRows.map(r => ({
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

    // Only slots that have actually been generated/edited at all are sent
    // as overrides — an untouched slot just uses the server's built-in
    // default, same as before this feature existed.
    const customTextByTemplate = {}
    const customSubjectByTemplate = {}
    SAMPLE_SLOTS.forEach(slot => {
      if (editedText[slot.key] !== undefined) customTextByTemplate[slot.key] = editedText[slot.key]
      if (editedSubject[slot.key] !== undefined) customSubjectByTemplate[slot.key] = editedSubject[slot.key]
    })

    // Which templates this specific send will actually use, AND are
    // genuinely edited (not just generated-but-untouched) — for the
    // confirm-dialog wording.
    const usedTemplates = new Set(selectedRows.map(getTemplate))
    const editedUsedLabels = SAMPLE_SLOTS
      .filter(slot => usedTemplates.has(slot.key) && isSlotEdited(slot.key))
      .map(slot => slot.label)

    const parts = [sendConfirmText(rawItems.length, sendMode)]
    if (editedUsedLabels.length > 0) {
      parts.push(`Using edited wording for: ${editedUsedLabels.join(', ')}.`)
    }
    if (!window.confirm(parts.join(' '))) return

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
            body: JSON.stringify({
              items: chunk,
              custom_text_by_template: customTextByTemplate,
              custom_subject_by_template: customSubjectByTemplate,
            }),
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
          Upload a past-customer list and generate sample follow-up email drafts. Uploads are saved only when you click Save to Sheet. Edited wording lives in this browser tab only — it is never saved, and is lost on refresh.
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
            <div>
              <h2 className="text-base font-semibold text-gray-800">Sample Drafts</h2>
              <p className="text-xs text-gray-400">
                Editing Subject or the email body applies to every customer sent that template — not just the one previewed below.
              </p>
            </div>
            <button
              onClick={generateSamples}
              disabled={generating}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {generating ? 'Generating…' : 'Generate samples'}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {SAMPLE_SLOTS.map(slot => {
              const candidates = previewCandidates(slot)
              const previewCustomer = currentPreviewCustomer(slot)
              return (
              <div key={slot.key} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-gray-800">{slot.label}</h3>
                {draftErrors[slot.key] && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{draftErrors[slot.key]}</p>
                )}
                {drafts[slot.key] ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-gray-500 font-medium">Preview for</label>
                      <button
                        onClick={() => resetToDefault(slot.key)}
                        disabled={resettingSlot === slot.key || !isSlotEdited(slot.key)}
                        className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-40 disabled:no-underline"
                      >
                        {resettingSlot === slot.key ? 'Resetting…' : 'Reset to default'}
                      </button>
                    </div>
                    <select
                      value={previewCustomer?._idx ?? ''}
                      onChange={e => setPreviewRowIdx(prev => ({ ...prev, [slot.key]: Number(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {candidates.map(r => (
                        <option key={r._idx} value={r._idx}>{r.name || '(no name)'} — {r.email || 'no email'}</option>
                      ))}
                    </select>

                    <label className="text-xs text-gray-500 font-medium mt-1">Placeholders (click to insert)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {FOLLOWUP_PLACEHOLDERS.map(p => (
                        <button
                          key={p.token}
                          type="button"
                          onClick={() => insertPlaceholder(slot.key, p.token)}
                          title={p.note || undefined}
                          className="px-2 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
                        >
                          {p.token}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">
                      {'{{year}}'}, {'{{service}}'} and {'{{reroofing_year}}'} can be empty for some customers — use {'{{service_phrase}}'} if unsure.
                    </p>

                    <label className="text-xs text-gray-500 font-medium mt-1">Subject</label>
                    <input
                      ref={el => { fieldRefs.current[`${slot.key}_subject`] = el }}
                      value={editedSubject[slot.key] ?? ''}
                      onChange={e => setEditedSubject(prev => ({ ...prev, [slot.key]: e.target.value }))}
                      onFocus={() => setFocusedField(prev => ({ ...prev, [slot.key]: 'subject' }))}
                      className="w-full text-sm font-medium text-gray-800 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <label className="text-xs text-gray-500 font-medium mt-1">Email body (editable)</label>
                    <textarea
                      ref={el => { fieldRefs.current[`${slot.key}_text`] = el }}
                      value={editedText[slot.key] ?? ''}
                      onChange={e => setEditedText(prev => ({ ...prev, [slot.key]: e.target.value }))}
                      onFocus={() => setFocusedField(prev => ({ ...prev, [slot.key]: 'text' }))}
                      rows={12}
                      className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <label className="text-xs text-gray-500 font-medium mt-1">
                      Full preview for {previewCustomer?.name || '(no name)'} (body + signature — signature and the opt-out line are never editable)
                    </label>
                    <div
                      className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-80 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: drafts[slot.key].body_html }}
                    />
                  </>
                ) : !draftErrors[slot.key] && (
                  <p className="text-xs text-gray-400">Click "Generate samples" to draft a message for this case.</p>
                )}
              </div>
              )
            })}
          </div>

          {/* Filter */}
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

          {/* Send bar — sticky while the table below scrolls (the table is
              the last thing on the page, so it stays stuck through the end) */}
          <SendBar
            selectedCount={selectedCount}
            eligibleCount={eligibleFiltered.length}
            hiddenCount={hiddenSelectedCount}
            duplicateCount={selectedDuplicateCount}
            sendCap={SEND_CAP}
            onSelectAll={selectAllEligible}
            onClear={clearSelection}
            onSend={sendEmails}
            sendDisabled={selectedCount === 0 || overCap || sending || !!sendModeError || !sendMode}
            sendMode={sendMode}
            sendModeError={sendModeError}
            sending={sending}
            sendProgress={sendProgress}
            sendError={sendError}
            sendResult={sendResult}
          />

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
        </>
      )}
    </div>
  )
}
