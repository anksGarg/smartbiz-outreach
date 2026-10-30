import { sendModeText } from '../envInfo'

const GMAIL_DAILY_LIMIT = 500

const TONE_STYLES = {
  info: 'text-gray-600',
  success: 'text-green-700',
  warn: 'text-amber-700',
  error: 'text-red-600',
}

// Selection count + Select all / Clear + Send Email, with every send-related
// message in one area underneath. Sticky at the top of its container (the
// wrapper around this bar and the table), so it stays visible while the
// table scrolls. Display only — the page owns all selection and send logic.
export default function SendBar({
  selectedCount, eligibleCount, hiddenCount, duplicateCount, sendCap,
  onSelectAll, onClear, onSend, sendDisabled,
  sendMode, sendModeError, sending, sendProgress, sendError, sendResult,
}) {
  const messages = []
  messages.push({
    tone: sendModeError ? 'error' : sendMode && sendMode.mode !== 'test' ? 'warn' : 'info',
    text: sendModeText(sendMode, sendModeError),
  })
  if (sending && sendProgress) {
    messages.push({ tone: 'info', text: `Sent ${sendProgress.done} of ${sendProgress.total}` })
  }
  if (selectedCount > sendCap) {
    messages.push({ tone: 'error', text: `Max ${sendCap} per send, deselect ${selectedCount - sendCap}.` })
  }
  if (selectedCount > GMAIL_DAILY_LIMIT) {
    messages.push({ tone: 'warn', text: 'Gmail allows about 500 emails per day; the app does not count sends yet.' })
  }
  if (duplicateCount > 0 && !sending) {
    messages.push({
      tone: 'info',
      text: `${duplicateCount} selected row${duplicateCount !== 1 ? 's share' : ' shares'} an email with an earlier selected row and will be skipped.`,
    })
  }
  if (sendError) messages.push({ tone: 'error', text: sendError })
  if (sendResult) {
    const { mode, sent, skipped, failed } = sendResult
    messages.push({
      tone: failed.length > 0 ? 'warn' : 'success',
      text: `Mode: ${mode} — ${sent.length} sent, ${skipped.length} skipped, ${failed.length} failed.`,
    })
    if (skipped.length > 0) {
      messages.push({ tone: 'warn', text: `Skipped: ${skipped.map(s => `${s.name} (${s.reason})`).join(', ')}` })
    }
    if (failed.length > 0) {
      messages.push({ tone: 'error', text: `Failed: ${failed.map(f => `${f.name} (${f.error})`).join(', ')}` })
    }
  }

  return (
    <div className="sticky top-0 z-10 bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-700 font-medium">
          {selectedCount} of {eligibleCount} selected
          {hiddenCount > 0 && (
            <span className="ml-1 text-gray-500 font-normal">({hiddenCount} not shown in this filter)</span>
          )}
        </span>
        <button
          onClick={onSelectAll}
          disabled={eligibleCount === 0 || sending}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          Select all ({eligibleCount})
        </button>
        <button
          onClick={onClear}
          disabled={selectedCount === 0 || sending}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={onSend}
          disabled={sendDisabled}
          className="ml-auto px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {sending ? 'Sending…' : 'Send Email'}
        </button>
      </div>
      <div className="max-h-32 overflow-y-auto space-y-0.5 text-sm" aria-live="polite">
        {messages.map((m, i) => (
          <p key={i} className={TONE_STYLES[m.tone]}>{m.text}</p>
        ))}
      </div>
    </div>
  )
}
