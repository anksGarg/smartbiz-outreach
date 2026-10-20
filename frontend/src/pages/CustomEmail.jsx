import { useState, useEffect, useRef, useMemo } from 'react'
import { API_URL as API } from '../config'

const TIMEOUT_MSG = 'Something went wrong. Please try again.'
const TONES = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'short', label: 'Short' },
]
const INSTRUCTION_MAX = 1000
const SUBJECT_MAX = 150
const BODY_MAX = 5000
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

// Splits items into fixed-size chunks, preserving order.
export function chunkItems(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// De-dupes by email (case-insensitive), keeping the first occurrence. Returns
// the kept items plus a skipped-reason entry for every later duplicate.
export function dedupeByEmail(items) {
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

const KNOWN_PLACEHOLDERS = new Set(['first_name', 'full_name'])

// Mirrors custom_email.unknown_placeholders() on the backend — same {{...}}
// token shape, same case-insensitive known set, same de-dupe-by-first-seen.
export function findUnknownPlaceholders(text) {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  const seen = new Set()
  const found = []
  let m
  while ((m = re.exec(text || '')) !== null) {
    const token = m[1].trim()
    const key = token.toLowerCase()
    if (!KNOWN_PLACEHOLDERS.has(key) && !seen.has(key)) {
      seen.add(key)
      found.push(`{{${token}}}`)
    }
  }
  return found
}

export default function CustomEmail() {
  // Uploaded list — lives only in this component's state, never saved anywhere.
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  // AI drafting
  const [instruction, setInstruction] = useState('')
  const [tone, setTone] = useState('friendly')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState(null)
  const [generateWarnings, setGenerateWarnings] = useState([])
  const [lastGenParams, setLastGenParams] = useState(null) // {instruction, tone}
  const [isAiDraft, setIsAiDraft] = useState(false)

  // Subject/message — always editable, typed or AI-generated
  const [subject, setSubjectRaw] = useState('')
  const [body, setBodyRaw] = useState('')
  const [focusedField, setFocusedField] = useState('body') // 'subject' | 'body' — where {{...}} buttons insert
  const subjectRef = useRef(null)
  const bodyRef = useRef(null)

  function setSubject(value) {
    setSubjectRaw(value)
    setIsAiDraft(false)
  }
  function setBody(value) {
    setBodyRaw(value)
    setIsAiDraft(false)
  }

  // Preview
  const [previewIdx, setPreviewIdx] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Recipient selection
  const [selected, setSelected] = useState(new Set())

  // Send mode, reused from the follow-up page's endpoint so the confirm
  // dialog shows the real test recipient instead of a hardcoded address.
  const [sendMode, setSendMode] = useState(null)
  const [sendModeError, setSendModeError] = useState(null)

  const [sending, setSending] = useState(false)
  const [sendProgress, setSendProgress] = useState(null)
  const [sendError, setSendError] = useState(null)
  const [sendResult, setSendResult] = useState(null)

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
      const res = await fetchTimeout(`${API}/custom-email/preview-list`, { method: 'POST', body: form }, 20000)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not read file.')
      }
      const data = await res.json()
      const withIdx = (data.rows || []).map((r, i) => ({ ...r, _idx: i }))
      setRows(withIdx)
      setFileName(file.name)
      setSelected(new Set())
      setPreviewIdx(withIdx.length > 0 ? withIdx[0]._idx : null)
      setSendResult(null)
      setSendError(null)
      setSendProgress(null)
    } catch (e) {
      setUploadError(errMsg(e))
    } finally {
      setUploading(false)
    }
  }

  function insertAtCursor(ref, setter, token) {
    const el = ref.current
    if (!el) {
      setter(prev => prev + token)
      return
    }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const current = el.value
    setter(current.slice(0, start) + token + current.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  function insertPlaceholder(token) {
    if (focusedField === 'subject') insertAtCursor(subjectRef, setSubject, token)
    else insertAtCursor(bodyRef, setBody, token)
  }

  async function performGenerate(regenerate) {
    const useInstruction = (regenerate ? lastGenParams?.instruction : instruction) || ''
    const useTone = (regenerate ? lastGenParams?.tone : tone) || 'friendly'
    if (!useInstruction.trim()) return

    const hasText = Boolean(subject.trim() || body.trim())
    const needsConfirm = regenerate ? (hasText && !isAiDraft) : hasText
    if (needsConfirm) {
      const ok = window.confirm('This replaces your current subject and message. Continue?')
      if (!ok) return
    }

    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await fetchTimeout(`${API}/custom-email/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: useInstruction, tone: useTone }),
      }, 35000)
      if (!res.ok) {
        if (res.status === 429) throw new Error('Please wait a moment and try again.')
        if (res.status === 500) throw new Error('AI drafting is not configured.')
        if (res.status === 502) throw new Error('Could not generate a draft. Please try again.')
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not generate a draft.')
      }
      const data = await res.json()
      setSubjectRaw(data.subject)
      setBodyRaw(data.body)
      setIsAiDraft(true)
      setGenerateWarnings(data.warnings || [])
      setLastGenParams({ instruction: useInstruction, tone: useTone })
    } catch (e) {
      setGenerateError(errMsg(e))
    } finally {
      setGenerating(false)
    }
  }

  const editWarnings = useMemo(() => {
    const combined = [...findUnknownPlaceholders(subject), ...findUnknownPlaceholders(body)]
    const seen = new Set()
    const out = []
    for (const t of combined) {
      const key = t.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(t)
      }
    }
    return out
  }, [subject, body])

  // Debounced preview — re-renders ~500ms after the owner stops typing, or
  // after switching which recipient is previewed.
  useEffect(() => {
    if (rows.length === 0) {
      setPreviewResult(null)
      return
    }
    const row = rows.find(r => r._idx === previewIdx) || rows[0]
    const tid = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const res = await fetchTimeout(`${API}/custom-email/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, body, name: row?.name || '' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || 'Could not render preview.')
        }
        setPreviewResult(await res.json())
      } catch (e) {
        setPreviewError(errMsg(e))
      } finally {
        setPreviewLoading(false)
      }
    }, 500)
    return () => clearTimeout(tid)
  }, [subject, body, previewIdx, rows])

  const selectableRows = rows.filter(r => r.email_valid && !r.duplicate)
  const allSelectableSelected = selectableRows.length > 0 && selectableRows.every(r => selected.has(r._idx))

  function toggleRow(idx) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }
  function toggleSelectAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelectableSelected) selectableRows.forEach(r => next.delete(r._idx))
      else selectableRows.forEach(r => next.add(r._idx))
      return next
    })
  }

  const selectedCount = selected.size
  const overCap = selectedCount > SEND_CAP
  const sendDisabled = (
    selectedCount === 0 || overCap || sending ||
    !subject.trim() || !body.trim() ||
    editWarnings.length > 0 ||
    !!sendModeError || !sendMode
  )

  async function sendEmails() {
    const rawItems = rows
      .filter(r => selected.has(r._idx))
      .map(r => ({ name: r.name, email: r.email }))
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
          const res = await fetchTimeout(`${API}/custom-email/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, body, items: chunk }),
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
          break
        }
        setSendProgress(prev => ({ done: (prev?.done || 0) + chunk.length, total: kept.length }))
      }
    } finally {
      setSendResult(merged)
      setSending(false)
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Custom Email</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Write (or AI-draft) a one-off email, preview it per recipient, and send to an uploaded list.
          Nothing here is saved — no localStorage, no Sheets. Refreshing the page loses everything below.
        </p>
      </div>

      {/* (a) Upload */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Upload Customer List</h2>
        <p className="text-xs text-gray-400 mb-4">Columns expected: Name, Email.</p>
        <input type="file" accept=".csv,.xlsx" onChange={e => handleFile(e.target.files[0])} className="text-sm" />
        {uploading && <p className="mt-2 text-sm text-gray-400">Reading file…</p>}
        {uploadError && <p className="mt-2 text-sm text-red-600">{uploadError}</p>}
        {fileName && !uploading && !uploadError && (
          <p className="mt-2 text-sm text-gray-500">
            {fileName} — {rows.length} row{rows.length !== 1 ? 's' : ''}
            {rows.length > 0 && ` (${selectableRows.length} valid, non-duplicate)`}
          </p>
        )}
      </div>

      {/* (b) AI drafting */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Tell the AI what you want to say</h2>
        <p className="text-xs text-gray-400 mb-3">Optional — skip this and type directly into Subject/Message below.</p>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value.slice(0, INSTRUCTION_MAX))}
          maxLength={INSTRUCTION_MAX}
          rows={3}
          placeholder="e.g. Let customers know we now offer moss treatment, keep it casual"
          className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-gray-400">{instruction.length}/{INSTRUCTION_MAX}</span>
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <select
            value={tone}
            onChange={e => setTone(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button
            onClick={() => performGenerate(false)}
            disabled={generating || !instruction.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
          {lastGenParams && (
            <button
              onClick={() => performGenerate(true)}
              disabled={generating}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Regenerate
            </button>
          )}
        </div>
        {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}
        {generateWarnings.length > 0 && (
          <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {generateWarnings.join(' ')}
          </p>
        )}
      </div>

      {/* (c) Subject + Message — always editable */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold text-gray-800">Subject &amp; Message</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => insertPlaceholder('{{first_name}}')}
              className="px-2 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
            >
              Insert {'{{first_name}}'}
            </button>
            <button
              onClick={() => insertPlaceholder('{{full_name}}')}
              className="px-2 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
            >
              Insert {'{{full_name}}'}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Placeholders: {'{{first_name}}'} and {'{{full_name}}'} — personalized per recipient when sent.
        </p>
        {isAiDraft && (
          <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            AI draft. Review and edit before sending.
          </p>
        )}

        <label className="text-xs text-gray-500 font-medium block">Subject</label>
        <input
          ref={subjectRef}
          value={subject}
          onChange={e => setSubject(e.target.value.slice(0, SUBJECT_MAX))}
          onFocus={() => setFocusedField('subject')}
          maxLength={SUBJECT_MAX}
          className="w-full text-sm font-medium text-gray-800 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />

        <label className="text-xs text-gray-500 font-medium block mt-1">Message</label>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={e => setBody(e.target.value.slice(0, BODY_MAX))}
          onFocus={() => setFocusedField('body')}
          maxLength={BODY_MAX}
          rows={10}
          className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
        />

        {editWarnings.length > 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Unknown placeholder(s): {editWarnings.join(', ')}
          </p>
        )}
      </div>

      {/* (d) Preview */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold text-gray-800">Preview</h2>
            <select
              value={previewIdx ?? ''}
              onChange={e => setPreviewIdx(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {rows.map(r => (
                <option key={r._idx} value={r._idx}>{r.name || '(no name)'} — {r.email || 'no email'}</option>
              ))}
            </select>
          </div>
          {previewLoading && <p className="text-sm text-gray-400">Rendering…</p>}
          {previewError && <p className="text-sm text-red-600">{previewError}</p>}
          {previewResult && !previewLoading && (
            <>
              {previewResult.warnings?.length > 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {previewResult.warnings.join(' ')}
                </p>
              )}
              <p className="text-sm font-medium text-gray-800">{previewResult.subject}</p>
              <div
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-80 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: previewResult.body_html }}
              />
            </>
          )}
        </div>
      )}

      {/* (e) Recipient table */}
      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-gray-800">Recipients</h2>
            <div className="text-sm text-gray-500">
              {selectedCount} selected
              {overCap && (
                <span className="ml-2 text-red-600 font-medium">
                  — max {SEND_CAP} per send, deselect {selectedCount - SEND_CAP}
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Greeting</th>
                  <th className="px-4 py-3 font-medium">Flags</th>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelectableSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r._idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800 font-medium">{r.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.first_name || '—'}</td>
                    <td className="px-4 py-3">
                      {!r.email_valid && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 mr-1">
                          invalid email
                        </span>
                      )}
                      {r.duplicate && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                          duplicate
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(r._idx)}
                        disabled={!r.email_valid || r.duplicate}
                        onChange={() => toggleRow(r._idx)}
                        className="rounded border-gray-300 text-blue-600 cursor-pointer disabled:opacity-30"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* (f) Send */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={sendEmails}
              disabled={sendDisabled}
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
