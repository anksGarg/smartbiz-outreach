import { useState, useEffect, useRef } from 'react'

const API = 'https://smartbiz-outreach.onrender.com'

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

function ScoreBadge({ value }) {
  if (!value) return null
  const cls =
    value === 'High'   ? 'bg-red-100 text-red-700' :
    value === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                         'bg-gray-100 text-gray-500'
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{value}</span>
}

function PropertyBadge({ value }) {
  if (!value) return null
  const cls = value === 'Commercial' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>{value}</span>
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export default function Leads() {
  // ── Single address lookup ──
  const [address, setAddress] = useState('')
  const [scoring, setScoring] = useState(false)
  const [scoreResult, setScoreResult] = useState(null)
  const [scoreError, setScoreError] = useState(null)

  // ── Bulk address scoring ──
  const [bulkText, setBulkText] = useState(() => load('leads_bulkText', ''))
  const [bulkScoring, setBulkScoring] = useState(false)
  const [bulkResults, setBulkResults] = useState(() => load('leads_bulkResults', null))
  const [bulkError, setBulkError] = useState(null)
  const [bulkAdded, setBulkAdded] = useState(() => new Set(load('leads_bulkAdded', [])))
  const [bulkEnriching, setBulkEnriching] = useState(new Set())
  const [bulkEmailFound, setBulkEmailFound] = useState(new Set())
  const [bulkPhoneFound, setBulkPhoneFound] = useState(new Set())
  const [bulkEnriched, setBulkEnriched] = useState(new Set())

  useEffect(() => { save('leads_bulkText', bulkText) }, [bulkText])
  useEffect(() => { save('leads_bulkResults', bulkResults) }, [bulkResults])
  useEffect(() => { save('leads_bulkAdded', [...bulkAdded]) }, [bulkAdded])

  // ── Generate leads ──
  const [zip, setZip] = useState(() => load('leads_zip', ''))
  const [county, setCounty] = useState(() => load('leads_county', ''))
  const [propFilter, setPropFilter] = useState(() => load('leads_propFilter', 'both'))
  const [generating, setGenerating] = useState(false)
  const [leads, setLeads] = useState(() => load('leads_data', null))
  const [genError, setGenError] = useState(null)
  // addedRows: Set of address strings
  const [addedRows, setAddedRows] = useState(() => new Set(load('leads_addedRows', [])))
  // enrichingIdx: Set of address strings currently being enriched on-demand (not persisted)
  const [enrichingIdx, setEnrichingIdx] = useState(new Set())
  const [sortCol, setSortCol] = useState(() => load('leads_sortCol', 'score'))
  const [sortDir, setSortDir] = useState(() => load('leads_sortDir', 'asc'))
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100

  useEffect(() => { save('leads_data', leads) }, [leads])
  useEffect(() => { save('leads_addedRows', [...addedRows]) }, [addedRows])
  useEffect(() => { save('leads_zip', zip) }, [zip])
  useEffect(() => { save('leads_county', county) }, [county])
  useEffect(() => { save('leads_propFilter', propFilter) }, [propFilter])
  useEffect(() => { save('leads_sortCol', sortCol) }, [sortCol])
  useEffect(() => { save('leads_sortDir', sortDir) }, [sortDir])

  async function scoreRoof() {
    if (!address.trim()) return
    setScoring(true)
    setScoreResult(null)
    setScoreError(null)
    try {
      const res = await fetch(`${API}/roof-score?address=${encodeURIComponent(address)}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not score this address.')
      }
      setScoreResult(await res.json())
    } catch (e) {
      setScoreError(e.message)
    } finally {
      setScoring(false)
    }
  }

  async function scoreBulk() {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) return
    setBulkScoring(true)
    setBulkResults(null)
    setBulkError(null)
    setBulkAdded(new Set())
    try {
      const res = await fetch(`${API}/score-addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: lines }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not score addresses.')
      }
      const data = await res.json()
      setBulkResults(data.results)
    } catch (e) {
      setBulkError(e.message)
    } finally {
      setBulkScoring(false)
    }
  }

  async function addBulkToContacts(result, idx) {
    const priorityMap = { High: 'Tier 1', Medium: 'Tier 2', Low: 'Tier 3' }
    setBulkEnriching(prev => new Set([...prev, idx]))
    try {
      const enrichRes = await fetch(`${API}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: result.address, property_type: '' }),
      })
      const enriched = enrichRes.ok ? await enrichRes.json() : {}

      const res = await fetch(`${API}/contacts/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: enriched.name || '',
          company: enriched.company || '',
          address: result.address,
          email: enriched.email || '',
          phone: enriched.phone || '',
          priority_tier: priorityMap[result.score] || '',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not add contact.')
      }
      if (enriched.enrichment_run) setBulkEnriched(prev => new Set([...prev, idx]))
      if (enriched.email_found)    setBulkEmailFound(prev => new Set([...prev, idx]))
      if (enriched.phone_found)    setBulkPhoneFound(prev => new Set([...prev, idx]))
      setBulkAdded(prev => new Set([...prev, idx]))
    } catch (e) {
      alert(e.message)
    } finally {
      setBulkEnriching(prev => { const s = new Set(prev); s.delete(idx); return s })
    }
  }

  async function generateLeads() {
    if (!zip.trim() && !county.trim()) return
    setGenerating(true)
    setLeads(null)
    setGenError(null)
    setAddedRows(new Set())
    setEnrichingIdx(new Set())
    setPage(1)
    try {
      const res = await fetch(`${API}/generate-leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zip, county, property_type: propFilter }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Could not generate leads.')
      }
      const data = await res.json()
      if (data.leads?.length) console.log('[generate-leads] first lead:', JSON.stringify(data.leads[0]))
      setLeads(data.leads)
    } catch (e) {
      setGenError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  // Fetch enrichment for a single lead and merge results into leads state.
  // Returns the raw enrichment response so callers can use it immediately.
  async function enrichLead(lead) {
    const res = await fetch(`${API}/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: lead.address, property_type: lead.property_type }),
    })
    const data = res.ok ? await res.json() : {}
    setLeads(prev => prev
      ? prev.map(l => l.address === lead.address
          ? { ...l, enriched: true,
              business_name: data.company || l.business_name || '',
              phone:         data.phone   || l.phone         || '',
              email:         data.email   || l.email         || '',
              contact_name:  data.name    || l.contact_name  || '' }
          : l)
      : prev
    )
    return data
  }

  // "Get Contact Info" button — enriches row in place, no add-to-contacts
  async function enrichRowOnly(lead) {
    setEnrichingIdx(prev => new Set([...prev, lead.address]))
    try {
      await enrichLead(lead)
    } catch {
      setLeads(prev => prev
        ? prev.map(l => l.address === lead.address ? { ...l, enriched: true } : l)
        : prev
      )
    } finally {
      setEnrichingIdx(prev => { const s = new Set(prev); s.delete(lead.address); return s })
    }
  }

  async function addToContacts(lead) {
    const priorityMap = { High: 'Tier 1', Medium: 'Tier 2', Low: 'Tier 3' }
    let contactData = {
      name:    lead.contact_name  || '',
      company: lead.business_name || '',
      phone:   lead.phone         || '',
      email:   lead.email         || '',
    }

    if (!lead.enriched) {
      setEnrichingIdx(prev => new Set([...prev, lead.address]))
      try {
        const data = await enrichLead(lead)
        contactData = {
          name:    data.name    || '',
          company: data.company || '',
          phone:   data.phone   || '',
          email:   data.email   || '',
        }
      } catch {
        // proceed with empty contact data
      } finally {
        setEnrichingIdx(prev => { const s = new Set(prev); s.delete(lead.address); return s })
      }
    }

    try {
      const res = await fetch(`${API}/contacts/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...contactData,
          address:       lead.address,
          property_type: lead.property_type,
          priority_tier: priorityMap[lead.score] || '',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.detail || 'Could not add contact.')
        return
      }
      setAddedRows(prev => new Set([...prev, lead.address]))
    } catch (e) {
      alert(e.message)
    }
  }

  const SCORE_ORDER = { High: 0, Medium: 1, Low: 2 }

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  const totalPages = leads ? Math.ceil(leads.length / PAGE_SIZE) : 0

  const sortedLeads = leads ? [...leads].sort((a, b) => {
    let av, bv
    if (sortCol === 'score') {
      av = SCORE_ORDER[a.score] ?? 3
      bv = SCORE_ORDER[b.score] ?? 3
    } else if (sortCol === 'year_built') {
      av = parseInt(a.year_built) || 9999
      bv = parseInt(b.year_built) || 9999
    } else {
      av = a.address || ''
      bv = b.address || ''
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ?  1 : -1
    return 0
  }) : []

  const COL_DEFAULTS = { address: 220, business_name: 160, contact: 140, phone: 140, email: 180, website: 160, score: 110, year_built: 90, action: 130 }
  const [colWidths, setColWidths] = useState(COL_DEFAULTS)
  const resizingRef = useRef(null)

  function startResize(e, col) {
    e.preventDefault()
    const startX = e.clientX
    const startW = colWidths[col]
    resizingRef.current = col
    const onMove = ev => {
      setColWidths(prev => ({ ...prev, [col]: Math.max(60, startW + ev.clientX - startX) }))
    }
    const onUp = () => {
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function exportLeads() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const criteria = [
      zip.trim()    && `Zip: ${zip.trim()}`,
      county.trim() && `County: ${county.trim().charAt(0).toUpperCase() + county.trim().slice(1)}`,
      `Type: ${propFilter.charAt(0).toUpperCase() + propFilter.slice(1)}`,
    ].filter(Boolean).join(' · ')
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const rows = [
      ['Search Criteria', criteria],
      ['Generated',       today],
      ['Total Leads',     sortedLeads.length],
      [],
      ['Address', 'Property Type', 'Business Name', 'Contact Name', 'Phone', 'Email', 'Website', 'Roof Score', 'Year Built'],
      ...sortedLeads.map(l => [
        l.address, l.property_type, l.business_name || '', l.contact_name || '',
        l.phone || '', l.email || '', l.website || '', l.score, l.year_built || '',
      ]),
    ]
    const csv  = rows.map(r => r.map(esc).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `leads-${zip.trim() || county.trim() || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function resizeHandle(col) {
    return (
      <div
        onMouseDown={e => { e.stopPropagation(); startResize(e, col) }}
        onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'col-resize' }}
        className="group/rh flex items-center justify-center"
      >
        <div
          style={{ width: 1, height: '60%' }}
          className="bg-gray-200 group-hover/rh:bg-blue-400 transition-colors"
        />
      </div>
    )
  }

  function SortTh({ col, label, className = '' }) {
    return (
      <th
        onClick={() => handleSort(col)}
        style={{ position: 'relative' }}
        className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-800 whitespace-nowrap overflow-hidden ${className}`}
      >
        {label}
        <span className="ml-1 text-gray-300">{sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
        {resizeHandle(col)}
      </th>
    )
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800">Lead Generation</h1>
        <p className="text-gray-500 text-sm mt-0.5">Score roofs and discover new leads using Google Solar data.</p>
      </div>

      {/* ── Single address lookup ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Score a Single Address</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && scoreRoof()}
            placeholder="e.g. 123 NW 23rd Ave, Portland, OR"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <button
            onClick={scoreRoof}
            disabled={scoring || !address.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {scoring ? 'Scoring…' : 'Score This Roof'}
          </button>
        </div>

        {scoreError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{scoreError}</p>
        )}

        {scoreResult && (
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4 flex flex-col gap-2">
            <p className="text-sm text-gray-500 truncate">{scoreResult.address}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Roof Score</span>
                <ScoreBadge value={scoreResult.score} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Imagery Age</span>
                <span className="text-sm font-medium text-gray-700">
                  {scoreResult.age_years === 0 ? 'Under 1 year' : `${scoreResult.age_years} yr${scoreResult.age_years !== 1 ? 's' : ''}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 uppercase tracking-wide">Captured</span>
                <span className="text-sm text-gray-700">{scoreResult.imagery_date}</span>
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-1">{scoreResult.summary}</p>
          </div>
        )}
      </div>

      {/* ── Bulk address scoring ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Score Multiple Addresses</h2>
        <p className="text-xs text-gray-400 mb-4">Paste one address per line — results sorted High priority first.</p>
        <textarea
          value={bulkText}
          onChange={e => setBulkText(e.target.value)}
          rows={5}
          placeholder={"123 NW 23rd Ave, Portland, OR\n456 SE Hawthorne Blvd, Portland, OR\n789 N Interstate Ave, Portland, OR"}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200 resize-y"
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={scoreBulk}
            disabled={bulkScoring || !bulkText.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {bulkScoring ? 'Scoring…' : 'Score All Addresses'}
          </button>
          {bulkScoring && (
            <span className="text-xs text-gray-400">This may take a moment for large lists…</span>
          )}
        </div>

        {bulkError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{bulkError}</p>
        )}

        {bulkResults !== null && !bulkScoring && (
          bulkResults.length === 0 ? (
            <p className="mt-4 text-sm text-gray-400 text-center py-4">No results.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 mt-4">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Roof Priority</th>
                    <th className="px-4 py-3 font-medium">Summary</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bulkResults.map((result, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-700 max-w-xs">
                        <p className="truncate">{result.address}</p>
                        {result.imagery_date && (
                          <p className="text-xs text-gray-400 mt-0.5">Imagery: {result.imagery_date}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBadge value={result.score} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs">{result.summary}</td>
                      <td className="px-4 py-3">
                        {bulkAdded.has(i) ? (
                          <span className="flex flex-col gap-1">
                            <span className="text-xs text-green-600 font-medium">Added ✓</span>
                            {bulkEmailFound.has(i) && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 w-fit">✉ Email found</span>
                            )}
                            {bulkPhoneFound.has(i) && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 w-fit">📞 Phone found</span>
                            )}
                            {bulkEnriched.has(i) && !bulkEmailFound.has(i) && !bulkPhoneFound.has(i) && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 w-fit">No contact found</span>
                            )}
                          </span>
                        ) : bulkEnriching.has(i) ? (
                          <span className="text-xs text-gray-400 italic">Enriching…</span>
                        ) : (
                          <button
                            onClick={() => addBulkToContacts(result, i)}
                            className="px-3 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors border border-blue-200"
                          >
                            + Add to Contacts
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                <span className="text-xs text-gray-400">{bulkResults.length} address{bulkResults.length !== 1 ? 'es' : ''} scored</span>
              </div>
            </div>
          )
        )}
      </div>

      {/* ── Generate lead list ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Generate Lead List</h2>
            <p className="text-xs text-gray-400 mt-0.5">Top 20 High Priority commercial leads are auto-enriched with contact info.</p>
          </div>
          {leads !== null && (
            <div className="flex items-center gap-4">
              <button
                onClick={exportLeads}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                ↓ Export CSV
              </button>
              <button
                onClick={() => {
                  setLeads(null)
                  setAddedRows(new Set())
                  setEnrichingIdx(new Set())
                  setPage(1)
                  save('leads_data', null)
                  save('leads_addedRows', [])
                }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Clear results
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            value={zip}
            onChange={e => setZip(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generateLeads()}
            placeholder="Zip code (e.g. 97201)"
            className="w-36 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <select
            value={county}
            onChange={e => setCounty(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">Any County</option>
            <option value="multnomah">Multnomah</option>
            <option value="washington">Washington</option>
            <option value="clackamas">Clackamas</option>
          </select>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[['both', 'Both'], ['commercial', 'Commercial'], ['residential', 'Residential']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPropFilter(val)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${propFilter === val ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={generateLeads}
            disabled={generating || (!zip.trim() && !county.trim())}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {generating ? 'Generating…' : 'Generate Leads'}
          </button>
        </div>

        {generating && (
          <p className="text-sm text-gray-500 py-4 text-center">
            Loading addresses from RLIS and enriching top commercial leads… (may take 20–60 seconds)
          </p>
        )}

        {genError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{genError}</p>
        )}

        {leads !== null && !generating && (
          leads.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No leads found for this area. Try a different zip code or county.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 mt-2">
              <table
                className="text-sm text-left"
                style={{ tableLayout: 'fixed', width: Object.values(colWidths).reduce((a, b) => a + b, 0) }}
              >
                <colgroup>
                  {['address','business_name','contact','phone','email','website','score','year_built','action'].map(col => (
                    <col key={col} style={{ width: colWidths[col] }} />
                  ))}
                </colgroup>
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs border-b border-gray-200">
                  <tr>
                    <SortTh col="address" label="Address" />
                    {[['business_name','Business Name'],['contact','Contact'],['phone','Phone'],['email','Email'],['website','Website']].map(([col, label]) => (
                      <th key={col} style={{ position: 'relative' }} className="px-4 py-3 font-medium whitespace-nowrap overflow-hidden">
                        {label}
                        {resizeHandle(col)}
                      </th>
                    ))}
                    <SortTh col="score" label="Roof Score" />
                    <SortTh col="year_built" label="Year Built" />
                    <th style={{ position: 'relative' }} className="px-4 py-3 font-medium overflow-hidden">
                      Action
                      {resizeHandle('action')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((lead) => {
                    const isEnriching = enrichingIdx.has(lead.address)
                    const isAdded = addedRows.has(lead.address)
                    return (
                      <tr key={lead.address} className="hover:bg-gray-50 transition-colors">

                        {/* Address + property badge + summary */}
                        <td className="px-4 py-3 max-w-[220px]">
                          <p className="truncate text-gray-700">{lead.address}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <PropertyBadge value={lead.property_type} />
                            <p className="text-xs text-gray-400">{lead.summary}</p>
                          </div>
                        </td>

                        {/* Business Name */}
                        <td className="px-4 py-3 max-w-[160px]">
                          {lead.enriched
                            ? lead.business_name
                              ? <span className="text-sm font-medium text-gray-800 block truncate">{lead.business_name}</span>
                              : <span className="text-gray-300">—</span>
                            : <span className="text-gray-200">—</span>}
                        </td>

                        {/* Contact Name */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {lead.enriched
                            ? lead.contact_name
                              ? <span className="text-sm text-green-700">👤 {lead.contact_name}</span>
                              : <span className="text-gray-300">—</span>
                            : <span className="text-gray-200">—</span>}
                        </td>

                        {/* Phone */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {lead.enriched
                            ? lead.phone
                              ? <span className="text-sm text-green-700">📞 {lead.phone}</span>
                              : <span className="text-gray-300">—</span>
                            : <span className="text-gray-200">—</span>}
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3 max-w-[200px]">
                          {lead.enriched
                            ? lead.email
                              ? <span className="text-sm text-green-700 block truncate">✉ {lead.email}</span>
                              : <span className="text-gray-300">—</span>
                            : <span className="text-gray-200">—</span>}
                        </td>

                        {/* Website */}
                        <td className="px-4 py-3 overflow-hidden">
                          {lead.website
                            ? <a href={lead.website} target="_blank" rel="noopener noreferrer"
                                 className="text-sm text-blue-600 hover:underline block truncate">
                                {extractDomain(lead.website)}
                              </a>
                            : <span className="text-gray-300">—</span>}
                        </td>

                        {/* Roof Score */}
                        <td className="px-4 py-3">
                          <ScoreBadge value={lead.score} />
                        </td>

                        {/* Year Built */}
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {lead.year_built || '—'}
                        </td>

                        {/* Action */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isAdded ? (
                            <span className="text-xs text-green-600 font-medium">Added ✓</span>
                          ) : isEnriching ? (
                            <span className="text-xs text-gray-400 italic">Loading…</span>
                          ) : !lead.enriched ? (
                            <button
                              onClick={() => enrichRowOnly(lead)}
                              className="px-3 py-1 rounded-lg bg-gray-50 text-gray-700 text-xs font-medium hover:bg-gray-100 transition-colors border border-gray-200 whitespace-nowrap"
                            >
                              Get Contact Info
                            </button>
                          ) : (
                            <button
                              onClick={() => addToContacts(lead)}
                              className="px-3 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors border border-blue-200 whitespace-nowrap"
                            >
                              + Add to Contacts
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                <span className="text-xs text-gray-500">
                  {leads.length} total
                  {totalPages > 1 && ` · page ${page} of ${totalPages}`}
                </span>
                {totalPages > 1 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ← Prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                      <button
                        key={n}
                        onClick={() => setPage(n)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                          ${page === n
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
